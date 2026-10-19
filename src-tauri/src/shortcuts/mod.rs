mod config;
mod registry;

pub(crate) use config::{deserialize_saved, Configuration};
use registry::{Backend, Registry};
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

const SESSION_SECONDS: u64 = 60;

#[derive(Clone)]
struct Session {
    id: u64,
    recording: bool,
    deadline: Instant,
}

#[derive(Default)]
struct Runtime {
    registry: Registry,
    changing: bool,
    session: Option<Session>,
    pressed: HashSet<u32>,
    last_trigger: Option<Instant>,
}

#[derive(Debug, PartialEq)]
enum Action {
    Convert(String),
    Test(u64, String),
}

impl Runtime {
    fn event(&mut self, id: u32, event: ShortcutState, now: Instant) -> Option<Action> {
        if event == ShortcutState::Released {
            self.pressed.remove(&id);
            return None;
        }
        if self.changing || !self.registry.configuration.enabled || !self.pressed.insert(id) {
            return None;
        }
        if self
            .last_trigger
            .is_some_and(|last| now.duration_since(last) < Duration::from_millis(350))
        {
            return None;
        }
        let target = self
            .registry
            .configuration
            .bindings
            .iter()
            .find(|(_, binding)| {
                let accelerator = binding.accelerator();
                self.registry.registered.contains(&accelerator)
                    && accelerator
                        .parse::<tauri_plugin_global_shortcut::Shortcut>()
                        .is_ok_and(|shortcut| shortcut.id() == id)
            })
            .map(|(target, _)| target.clone())?;
        self.last_trigger = Some(now);
        match &self.session {
            Some(session) if !session.recording && now < session.deadline => {
                Some(Action::Test(session.id, target))
            }
            Some(_) => None,
            None => Some(Action::Convert(target)),
        }
    }
}

#[derive(Default)]
struct State {
    operation: Mutex<()>,
    runtime: Mutex<Runtime>,
    initialized: AtomicBool,
    next_session: AtomicU64,
}

struct Native(AppHandle);

impl Backend for Native {
    fn register(&mut self, accelerator: &str) -> Result<(), String> {
        ensure_plugin(&self.0)?;
        self.0
            .global_shortcut()
            .register(accelerator)
            .map_err(|_| registry::UNAVAILABLE.to_owned())
    }

    fn unregister(&mut self, accelerator: &str) -> Result<(), String> {
        // Never initialize a native manager just to disable or edit a shortcut.
        if !self.0.state::<State>().initialized.load(Ordering::Acquire) {
            return Ok(());
        }
        self.0
            .global_shortcut()
            .unregister(accelerator)
            .map_err(|_| registry::RELEASE_FAILED.to_owned())
    }
}

fn ensure_plugin(app: &AppHandle) -> Result<(), String> {
    if app.state::<State>().initialized.load(Ordering::Acquire) {
        return Ok(());
    }
    let (send, receive) = std::sync::mpsc::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let result = handle.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    handle_event(app, shortcut.id(), event.state);
                })
                .build(),
        );
        if result.is_ok() {
            handle
                .state::<State>()
                .initialized
                .store(true, Ordering::Release);
        }
        let _ = send.send(result.map_err(|_| registry::UNAVAILABLE.to_owned()));
    })
    .map_err(|_| registry::UNAVAILABLE.to_owned())?;
    receive
        .recv()
        .map_err(|_| registry::UNAVAILABLE.to_owned())?
}

// No registry lock is held across an OS operation: the macOS backend dispatches
// to the UI thread, which can concurrently deliver hotkey events.
fn update(
    app: &AppHandle,
    operation: impl FnOnce(&mut Registry, &mut Native, &mut Option<Session>) -> Result<(), String>,
) -> Result<(), String> {
    let state = app.state::<State>();
    let _operation = state.operation.lock().map_err(|_| "快捷键状态暂不可用。")?;
    let (mut registry, mut session) = {
        let mut runtime = state.runtime.lock().map_err(|_| "快捷键状态暂不可用。")?;
        runtime.changing = true;
        runtime.pressed.clear();
        (runtime.registry.clone(), runtime.session.clone())
    };
    let result = operation(&mut registry, &mut Native(app.clone()), &mut session);
    let mut runtime = state.runtime.lock().map_err(|_| "快捷键状态暂不可用。")?;
    runtime.registry = registry;
    runtime.session = session;
    runtime.changing = false;
    drop(runtime);
    let _ = app.emit_to("preferences", "md2chat:shortcuts-state", snapshot(app));
    result
}

fn handle_event(app: &AppHandle, id: u32, event: ShortcutState) {
    let state = app.state::<State>();
    let action = state
        .runtime
        .lock()
        .ok()
        .and_then(|mut runtime| runtime.event(id, event, Instant::now()));
    // Readiness, busy handling and clipboard protections remain in the existing
    // conversion path. Drop repeated presses instead of queuing error dialogs.
    match action {
        Some(Action::Test(session_id, target)) => {
            let _ = app.emit_to(
                "preferences",
                "md2chat:shortcut-test",
                json!({"sessionId":session_id,"target":target}),
            );
        }
        Some(Action::Convert(target)) if !crate::is_busy(app) => {
            crate::start_conversion(app.clone(), target)
        }
        _ => {}
    }
}

fn snapshot(app: &AppHandle) -> Value {
    let state = app.state::<State>();
    let Ok(runtime) = state.runtime.lock() else {
        return json!({"error":true});
    };
    let configuration = &runtime.registry.configuration;
    let statuses = configuration
        .bindings
        .iter()
        .map(|(target, binding)| {
            let status = if !configuration.enabled {
                "disabled"
            } else if runtime.changing
                || runtime
                    .session
                    .as_ref()
                    .is_some_and(|session| session.recording)
            {
                "paused"
            } else if runtime.registry.registered.contains(&binding.accelerator()) {
                "registered"
            } else {
                "unavailable"
            };
            (target.clone(), json!(status))
        })
        .collect::<serde_json::Map<_, _>>();
    let warning = runtime.registry.warning.clone().or_else(|| {
        (runtime.session.is_none()
            && !runtime.changing
            && !configuration
                .desired()
                .is_subset(&runtime.registry.registered))
        .then(|| "部分快捷键暂不可用，请重新检查或更换组合。".to_owned())
    });
    json!({"configuration":configuration,"statuses":statuses,"warning":warning,
        "platform":if cfg!(target_os="macos") { "darwin" } else { "win32" },
        "sessionId":runtime.session.as_ref().map(|session|session.id)})
}

fn trusted(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法确认快捷键窗口来源。")?;
    if window.label() == "preferences" && crate::local_url(&url, "/preferences.html") {
        Ok(())
    } else {
        Err("此窗口不能配置快捷键。".into())
    }
}

async fn worker(
    app: AppHandle,
    work: impl FnOnce(&AppHandle) -> Result<(), String> + Send + 'static,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        work(&app)?;
        Ok(snapshot(&app))
    })
    .await
    .map_err(|_| "快捷键操作未完成，请重试。".to_owned())?
}

#[tauri::command]
pub fn shortcuts_get(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    trusted(&window)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn shortcuts_set(
    app: AppHandle,
    window: WebviewWindow,
    configuration: Configuration,
) -> Result<Value, String> {
    trusted(&window)?;
    let configuration = configuration.validate(cfg!(target_os = "macos"))?;
    worker(app, move |app| {
        update(app, |registry, native, session| {
            if session.is_some() {
                return Err("请先结束快捷键录制或测试。".into());
            }
            registry.apply(configuration, native, |next| {
                crate::preferences::save_shortcuts(app, next)
            })
        })
    })
    .await
}

#[tauri::command]
pub async fn shortcuts_session(
    app: AppHandle,
    window: WebviewWindow,
    mode: String,
) -> Result<Value, String> {
    trusted(&window)?;
    if !matches!(mode.as_str(), "record" | "test") {
        return Err("无效的快捷键操作。".into());
    }
    let recording = mode == "record";
    worker(app, move |app| {
        let id = app
            .state::<State>()
            .next_session
            .fetch_add(1, Ordering::Relaxed)
            + 1;
        update(app, |registry, native, session| {
            if session.is_some() {
                return Err("请先结束快捷键录制或测试。".into());
            }
            if recording {
                registry.suspend(native)?;
            } else if !registry.configuration.enabled || registry.registered.is_empty() {
                return Err("请先启用并配置一个可用的快捷键。".into());
            }
            *session = Some(Session {
                id,
                recording,
                deadline: Instant::now() + Duration::from_secs(SESSION_SECONDS),
            });
            Ok(())
        })?;
        if !app
            .get_webview_window("preferences")
            .is_some_and(|window| window.is_focused().unwrap_or(false))
        {
            end_session(app, id)?;
            return Ok(());
        }
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_secs(SESSION_SECONDS)).await;
            let _ = tauri::async_runtime::spawn_blocking(move || end_session(&handle, id)).await;
        });
        Ok(())
    })
    .await
}

fn end_session(app: &AppHandle, id: u64) -> Result<(), String> {
    update(app, |registry, native, session| {
        if session.as_ref().is_some_and(|current| current.id == id) {
            *session = None;
            registry.restore(native);
        }
        Ok(())
    })
}

#[tauri::command]
pub async fn shortcuts_end_session(
    app: AppHandle,
    window: WebviewWindow,
    session_id: u64,
) -> Result<Value, String> {
    trusted(&window)?;
    worker(app, move |app| end_session(app, session_id)).await
}

pub(crate) fn cancel_window_session(app: &AppHandle) {
    let Some(state) = app.try_state::<State>() else {
        return;
    };
    let id = state
        .runtime
        .lock()
        .ok()
        .and_then(|runtime| runtime.session.as_ref().map(|session| session.id));
    if let Some(id) = id {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = end_session(&app, id);
        });
    }
}

pub(crate) fn setup(app: &AppHandle) {
    let configuration = crate::preferences::current(app).shortcuts;
    let enabled = configuration.enabled;
    app.manage(State {
        runtime: Mutex::new(Runtime {
            registry: Registry {
                configuration,
                ..Registry::default()
            },
            ..Runtime::default()
        }),
        ..State::default()
    });
    if enabled {
        let app = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let _ = update(&app, |registry, native, _| {
                registry.restore(native);
                Ok(())
            });
            if snapshot(&app)["warning"].is_string() {
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title(crate::locale::tr(&app, "快捷键暂不可用"))
                    .body(crate::locale::tr(
                        &app,
                        "部分快捷键暂不可用，请重新检查或更换组合。",
                    ))
                    .show();
            }
        });
    }
}

// Native registration smoke tests run only in an explicitly isolated debug app.
// Synthetic settings stay in memory and never overwrite the user's preferences.
#[cfg(debug_assertions)]
pub(crate) async fn smoke_check(app: AppHandle) -> Result<Value, String> {
    if !std::env::args().any(|arg| arg == "--smoke")
        || !app.config().identifier.ends_with(".shortcuts-qa")
    {
        return Ok(
            json!({"status":"skipped","reason":"requires isolated shortcuts QA identifier"}),
        );
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<State>();
        if state.initialized.load(Ordering::Acquire) {
            return Err("Isolated shortcuts QA must start with shortcuts disabled".to_owned());
        }
        let mut chosen = None;
        update(&app, |registry, native, _| {
            let original = registry.configuration.clone();
            let result = (|| {
                let mut configuration: Configuration = serde_json::from_value(json!({
                    "enabled":false,"bindings":{"email":{"modifiers":["Control","Alt"],"key":"Digit7"}}
                })).map_err(|error|error.to_string())?;
                registry.apply(configuration.clone(), native, |_|Ok(()))?;
                if state.initialized.load(Ordering::Acquire) || !registry.registered.is_empty() {
                    return Err("Disabled shortcut edits initialized the native manager".into());
                }
                configuration.enabled = true;
                for digit in ['7','8','9','0','1','2','3','4','5','6'] {
                    configuration.bindings.get_mut("email").unwrap().key = format!("Digit{digit}");
                    if registry.apply(configuration.clone(), native, |_|Ok(())).is_ok() {
                        chosen = Some(configuration.bindings["email"].accelerator());
                        break;
                    }
                }
                let accelerator = chosen.as_ref().ok_or("No available shortcut candidate for native QA")?;
                if !app.global_shortcut().is_registered(accelerator.as_str()) {
                    return Err("Native shortcut was not registered".into());
                }
                registry.suspend(native)?;
                if app.global_shortcut().is_registered(accelerator.as_str()) {
                    return Err("Recording did not release native shortcut".into());
                }
                registry.restore(native);
                if !app.global_shortcut().is_registered(accelerator.as_str()) {
                    return Err("Recording cancellation did not restore native shortcut".into());
                }
                configuration.enabled = false;
                registry.apply(configuration, native, |_|Ok(()))?;
                if app.global_shortcut().is_registered(accelerator.as_str()) || !registry.registered.is_empty() {
                    return Err("Disabling did not release native shortcut".into());
                }
                Ok(())
            })();
            let cleanup = registry.apply(original, native, |_|Ok(()));
            result.and(cleanup)
        })?;
        Ok(json!({"status":"passed","defaultNoNativeManager":true,"disabledEditNoRegistration":true,
            "nativeRegistration":chosen,"recordingReleasesAndRestores":true,"disableReleases":true}))
    }).await.map_err(|_| "Native shortcuts QA worker failed".to_owned())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn runtime() -> (Runtime, u32) {
        let config: Configuration = serde_json::from_value(json!({"enabled":true,"bindings":{
            "email":{"modifiers":["Control","Alt"],"key":"Digit7"}
        }}))
        .unwrap();
        let id = config.bindings["email"]
            .accelerator()
            .parse::<tauri_plugin_global_shortcut::Shortcut>()
            .unwrap()
            .id();
        let registered = config.desired();
        (
            Runtime {
                registry: Registry {
                    configuration: config,
                    registered,
                    warning: None,
                },
                ..Runtime::default()
            },
            id,
        )
    }

    #[test]
    fn disabled_unregistered_or_changing_shortcuts_cannot_dispatch_conversion() {
        let now = Instant::now();
        let (mut state, id) = runtime();
        state.registry.configuration.enabled = false;
        assert_eq!(state.event(id, ShortcutState::Pressed, now), None);
        state.registry.configuration.enabled = true;
        state.registry.registered.clear();
        assert_eq!(state.event(id, ShortcutState::Pressed, now), None);
        let (mut state, id) = runtime();
        state.changing = true;
        assert_eq!(state.event(id, ShortcutState::Pressed, now), None);
    }

    #[test]
    fn held_keys_and_bounces_dispatch_once_until_released_and_debounced() {
        let now = Instant::now();
        let (mut state, id) = runtime();
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now),
            Some(Action::Convert("email".into()))
        );
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now + Duration::from_secs(1)),
            None
        );
        state.event(id, ShortcutState::Released, now + Duration::from_secs(1));
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now + Duration::from_secs(1)),
            Some(Action::Convert("email".into()))
        );
        state.event(id, ShortcutState::Released, now + Duration::from_secs(1));
        assert_eq!(
            state.event(
                id,
                ShortcutState::Pressed,
                now + Duration::from_millis(1100)
            ),
            None
        );
    }

    #[test]
    fn testing_and_recording_never_dispatch_conversion_even_when_session_expires() {
        let now = Instant::now();
        let (mut state, id) = runtime();
        state.session = Some(Session {
            id: 7,
            recording: false,
            deadline: now + Duration::from_secs(60),
        });
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now),
            Some(Action::Test(7, "email".into()))
        );
        state.event(id, ShortcutState::Released, now);
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now + Duration::from_secs(61)),
            None
        );
        state.session.as_mut().unwrap().recording = true;
        state.event(id, ShortcutState::Released, now);
        assert_eq!(
            state.event(id, ShortcutState::Pressed, now + Duration::from_secs(62)),
            None
        );
    }
}
