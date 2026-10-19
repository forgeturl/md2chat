use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

struct State {
    view: Mutex<Value>,
    candidate: Mutex<Option<Update>>,
    downloaded: Mutex<Option<Vec<u8>>>,
    notified: Mutex<std::collections::HashSet<String>>,
    working: AtomicBool,
}

struct Operation<'a>(&'a AtomicBool);
impl Drop for Operation<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

fn acquire(state: &State) -> Result<Operation<'_>, String> {
    state
        .working
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .map_err(|_| "正在操作更新，请稍候。".to_owned())?;
    Ok(Operation(&state.working))
}

fn snapshot(app: &tauri::AppHandle) -> Value {
    app.state::<State>()
        .view
        .lock()
        .unwrap_or_else(|p| p.into_inner())
        .clone()
}

fn publish(app: &tauri::AppHandle, changes: Value) -> Value {
    let state = app.state::<State>();
    let mut view = state.view.lock().unwrap_or_else(|p| p.into_inner());
    for (key, value) in changes.as_object().into_iter().flatten() {
        view[key] = value.clone();
    }
    let value = view.clone();
    let _ = app.emit_to("main", "md2chat:update-state", &value);
    value
}

fn configured(app: &tauri::AppHandle) -> bool {
    app.config()
        .plugins
        .0
        .get("updater")
        .and_then(|v| v.get("pubkey"))
        .and_then(Value::as_str)
        .is_some_and(|key| !key.trim().is_empty())
}

pub fn setup(app: &tauri::AppHandle) {
    app.manage(State {
        view: Mutex::new(json!({"phase":"idle","currentVersion":app.package_info().version.to_string(),"version":"","notes":"","progress":0,"message":""})),
        candidate: Mutex::new(None), downloaded: Mutex::new(None), working: AtomicBool::new(false),
        notified: Mutex::new(std::collections::HashSet::new()),
    });
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(15)).await;
        loop {
            if configured(&app) {
                let _ = check(&app).await;
            }
            tokio::time::sleep(Duration::from_secs(6 * 3600)).await;
        }
    });
}

pub async fn check(app: &tauri::AppHandle) -> Result<Value, String> {
    let state = app.state::<State>();
    let _operation = acquire(&state)?;
    if matches!(
        snapshot(app)["phase"].as_str(),
        Some("downloaded" | "installing")
    ) {
        return Ok(snapshot(app));
    }
    if !configured(app) {
        return Ok(publish(
            app,
            json!({"phase":"unavailable","message":"此开发构建未配置更新签名，请从下载页面获取新版。"}),
        ));
    }
    publish(
        app,
        json!({"phase":"checking","message":"正在检查更新…","progress":0}),
    );
    let result = async {
        let updater = app
            .updater_builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|_| "更新配置不可用".to_owned())?;
        tokio::time::timeout(Duration::from_secs(30), updater.check())
            .await
            .map_err(|_| "更新检查超时，请稍后重试。".to_owned())?
            .map_err(|_| "更新检查失败，请稍后重试。".to_owned())
    }
    .await;
    match result {
        Ok(Some(update)) => {
            let version = update.version.clone();
            let notes = update
                .body
                .clone()
                .unwrap_or_default()
                .chars()
                .take(16000)
                .collect::<String>();
            let view = publish(
                app,
                json!({"phase":"available","version":update.version,"notes":notes,"message":"发现新版本，请查看更新内容。"}),
            );
            *state.candidate.lock().map_err(|_| "更新状态不可用")? = Some(update);
            if state
                .notified
                .lock()
                .map_err(|_| "更新状态不可用")?
                .insert(version.clone())
            {
                use tauri_plugin_notification::NotificationExt;
                let _ = app
                    .notification()
                    .builder()
                    .title(crate::locale::tr(app, "md2chat 有新版本"))
                    .body(crate::locale::tr(app, "{version} 已发布，可从菜单栏／托盘的「检查更新」查看。")
                        .replace("{version}", &format!("v{version}")))
                    .show();
            }
            Ok(view)
        }
        Ok(None) => {
            *state.candidate.lock().map_err(|_| "更新状态不可用")? = None;
            Ok(publish(
                app,
                json!({"phase":"current","version":"","notes":"","message":"当前已是最新版本。"}),
            ))
        }
        Err(error) => {
            publish(app, json!({"phase":"error","message":error}));
            Err(error)
        }
    }
}

#[tauri::command]
pub fn update_status(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<Value, String> {
    crate::trusted(&window)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn update_check(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    crate::trusted(&window)?;
    check(&app).await
}

#[tauri::command]
pub async fn update_download(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    crate::trusted(&window)?;
    let state = app.state::<State>();
    let _operation = acquire(&state)?;
    if snapshot(&app)["phase"] != "available" {
        return Ok(snapshot(&app));
    }
    let candidate = state
        .candidate
        .lock()
        .map_err(|_| "更新状态不可用")?
        .take()
        .ok_or("请先检查更新。")?;
    publish(
        &app,
        json!({"phase":"downloading","progress":0,"message":"正在下载更新…"}),
    );
    let mut received = 0u64;
    let result = candidate
        .download(
            |chunk, total| {
                received = received.saturating_add(chunk as u64);
                let percent = total
                    .filter(|total| *total > 0)
                    .map(|total| (received as f64 / total as f64 * 100.0).min(100.0))
                    .unwrap_or(0.0);
                publish(
                    &app,
                    json!({"progress":percent,"message":format!("正在下载 {}%",percent.floor())}),
                );
            },
            || {},
        )
        .await;
    *state.candidate.lock().map_err(|_| "更新状态不可用")? = Some(candidate);
    match result {
        Ok(bytes) => {
            *state.downloaded.lock().map_err(|_| "更新状态不可用")? = Some(bytes);
            Ok(publish(
                &app,
                json!({"phase":"downloaded","progress":100,"message":"下载完成，点击重启并安装。"}),
            ))
        }
        Err(_) => {
            let message = "更新下载或签名验证失败，请重新检查更新。";
            publish(&app, json!({"phase":"error","message":message}));
            Err(message.into())
        }
    }
}

#[tauri::command]
pub async fn update_install(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    crate::trusted(&window)?;
    let state = app.state::<State>();
    let _operation = acquire(&state)?;
    if snapshot(&app)["phase"] != "downloaded" {
        return Ok(snapshot(&app));
    }
    if crate::is_busy(&app) {
        return Err("正在转换或复制，请稍候安装。".into());
    }
    let confirm_app = app.clone();
    let accepted = tauri::async_runtime::spawn_blocking(move || {
        use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
        confirm_app
            .dialog()
            .message(crate::locale::tr(&confirm_app, "应用将退出并重新打开。当前输入不会保存，请先复制或保存需要的内容。"))
            .title(crate::locale::tr(&confirm_app, "现在安装新版 md2chat？"))
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                crate::locale::tr(&confirm_app, "重启并安装"),
                crate::locale::tr(&confirm_app, "取消"),
            ))
            .blocking_show()
    })
    .await
    .map_err(|_| "无法确认安装操作")?;
    if !accepted {
        return Ok(snapshot(&app));
    }
    // A conversion may have started while the confirmation dialog was open.
    let _busy = crate::BusyGuard::acquire(&app)?;
    let candidate = state
        .candidate
        .lock()
        .map_err(|_| "更新状态不可用")?
        .take()
        .ok_or("请重新下载更新。")?;
    let bytes = state
        .downloaded
        .lock()
        .map_err(|_| "更新状态不可用")?
        .take()
        .ok_or("请重新下载更新。")?;
    publish(
        &app,
        json!({"phase":"installing","message":"正在安装更新…"}),
    );
    let result = tauri::async_runtime::spawn_blocking(move || candidate.install(bytes)).await;
    match result {
        Ok(Ok(())) => {
            app.restart();
        }
        _ => {
            let message = "更新安装失败，请从下载页面重新安装。";
            publish(&app, json!({"phase":"error","message":message}));
            Err(message.into())
        }
    }
}
