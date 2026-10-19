use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs::{self, OpenOptions},
    io::{self, Read, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
};
use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_autostart::ManagerExt;

pub(crate) const TARGETS: [&str; 6] = ["image", "wechat", "dingtalk", "feishu", "wecom", "email"];
const MAX_FILE_BYTES: u64 = 64 * 1024;
static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub(crate) struct Preferences {
    pub pinned_targets: Vec<String>,
    pub show_tray_label: bool,
    pub language: String,
    #[serde(default, deserialize_with = "crate::shortcuts::deserialize_saved")]
    pub shortcuts: crate::shortcuts::Configuration,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            pinned_targets: Vec::new(),
            show_tray_label: false,
            language: "auto".into(),
            shortcuts: crate::shortcuts::Configuration::default(),
        }
    }
}

struct PreferencesState {
    value: Mutex<Preferences>,
    file: PathBuf,
}

#[derive(Default)]
struct Patch {
    pinned_targets: Option<Vec<String>>,
    show_tray_label: Option<bool>,
    open_at_login: Option<bool>,
}

fn validate_targets(value: &Value) -> Result<Vec<String>, String> {
    let items = value.as_array().ok_or("请选择不重复的有效托盘格式。")?;
    if items.len() > TARGETS.len() {
        return Err("请选择不重复的有效托盘格式。".into());
    }
    let mut targets = Vec::with_capacity(items.len());
    for item in items {
        let target = item
            .as_str()
            .filter(|target| TARGETS.contains(target))
            .ok_or("请选择不重复的有效托盘格式。")?;
        if targets.iter().any(|saved| saved == target) {
            return Err("请选择不重复的有效托盘格式。".into());
        }
        targets.push(target.to_owned());
    }
    Ok(targets)
}

fn validate_patch(value: Value) -> Result<Patch, String> {
    let object = value.as_object().ok_or("首选项必须是一个设置对象。")?;
    let mut patch = Patch::default();
    for (key, value) in object {
        match key.as_str() {
            "pinnedTargets" => patch.pinned_targets = Some(validate_targets(value)?),
            "showTrayLabel" => {
                patch.show_tray_label = Some(value.as_bool().ok_or("首选项开关必须为布尔值。")?)
            }
            "openAtLogin" => {
                patch.open_at_login = Some(value.as_bool().ok_or("首选项开关必须为布尔值。")?)
            }
            _ => return Err("包含未知的首选项。".into()),
        }
    }
    Ok(patch)
}

fn read_preferences(file: &Path) -> io::Result<Preferences> {
    let source = match fs::File::open(file) {
        Ok(source) => source,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Preferences::default()),
        Err(error) => return Err(error),
    };
    let mut content = Vec::new();
    source.take(MAX_FILE_BYTES + 1).read_to_end(&mut content)?;
    let saved = if content.len() as u64 <= MAX_FILE_BYTES {
        serde_json::from_slice::<Preferences>(&content).ok()
    } else {
        None
    };
    if let Some(saved) = saved {
        if validate_targets(&json!(saved.pinned_targets)).is_ok()
            && crate::locale::valid(&saved.language)
        {
            return Ok(saved);
        }
    }
    eprintln!("md2chat: 已保存的首选项无效，使用默认设置。");
    Ok(Preferences::default())
}

#[cfg(not(target_os = "windows"))]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(target_os = "windows")]
fn replace_file(source: &Path, destination: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, replacement: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Replace the existing file atomically; never remove it before the new file is ready.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0x1 | 0x8) } == 0 {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

fn write_preferences(file: &Path, preferences: &Preferences) -> io::Result<()> {
    let parent = file
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "配置目录无效"))?;
    let mut directory = fs::DirBuilder::new();
    directory.recursive(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        directory.mode(0o700);
    }
    directory.create(parent)?;
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    let temporary = parent.join(format!(
        ".preferences-{}-{sequence}.tmp",
        std::process::id()
    ));
    let mut created = false;
    let result = (|| {
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut output = options.open(&temporary)?;
        created = true;
        let content = serde_json::to_vec_pretty(preferences).map_err(io::Error::other)?;
        output.write_all(&content)?;
        output.write_all(b"\n")?;
        output.sync_all()?;
        drop(output);
        replace_file(&temporary, file)
    })();
    // Only a file created by this operation may be removed.
    if created {
        let _ = fs::remove_file(&temporary);
    }
    result
}

pub(crate) fn setup(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let file = app.path().app_config_dir()?.join("preferences.json");
    let value = read_preferences(&file)?;
    app.manage(PreferencesState {
        value: Mutex::new(value),
        file,
    });
    Ok(())
}

pub(crate) fn current(app: &AppHandle) -> Preferences {
    app.state::<PreferencesState>()
        .value
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default()
}

pub(crate) fn save_language(app: &AppHandle, language: &str) -> Result<(), String> {
    let state = app.state::<PreferencesState>();
    let mut current = state.value.lock().map_err(|_| "Unable to save language")?;
    if current.language != language {
        let mut next = current.clone();
        next.language = language.to_owned();
        write_preferences(&state.file, &next).map_err(|_| "Unable to save language")?;
        *current = next;
    }
    Ok(())
}

pub(crate) fn save_shortcuts(
    app: &AppHandle,
    shortcuts: &crate::shortcuts::Configuration,
) -> Result<(), String> {
    let state = app.state::<PreferencesState>();
    let mut current = state.value.lock().map_err(|_| "暂时无法保存首选项。")?;
    if current.shortcuts != *shortcuts {
        let mut next = current.clone();
        next.shortcuts = shortcuts.clone();
        write_preferences(&state.file, &next)
            .map_err(|_| "无法写入本机首选项，请检查磁盘空间和目录权限。")?;
        *current = next;
    }
    Ok(())
}

fn platform() -> &'static str {
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

fn login_unavailable_reason() -> Option<&'static str> {
    if cfg!(debug_assertions) {
        return Some("请安装桌面版后设置开机自启动。");
    }
    if !cfg!(any(
        target_os = "macos",
        target_os = "windows",
        target_os = "linux"
    )) {
        return Some("此系统不支持开机自启动设置。");
    }
    #[cfg(target_os = "macos")]
    {
        let installed = std::env::current_exe().ok().is_some_and(|path| {
            path.ancestors()
                .any(|part| part.file_name().is_some_and(|name| name == "Applications"))
        });
        if !installed {
            return Some("请先把 md2chat 移到「应用程序」。");
        }
    }
    None
}

fn login_state(app: &AppHandle) -> Value {
    let hidden = std::env::args().any(|argument| argument == "--autostart");
    if let Some(reason) = login_unavailable_reason() {
        return json!({"supported":false,"enabled":false,"reason":reason,"wasOpenedAtLogin":hidden});
    }
    match app.autolaunch().is_enabled() {
        Ok(enabled) => json!({"supported":true,"registered":enabled,"enabled":enabled,
            "pending":false,"blocked":false,"wasOpenedAtLogin":hidden}),
        Err(_) => json!({"supported":false,"enabled":false,"reason":"暂时无法读取系统启动项。"}),
    }
}

fn snapshot(app: &AppHandle, value: &Preferences) -> Value {
    json!({"pinnedTargets":value.pinned_targets,"showTrayLabel":value.show_tray_label,
        "platform":platform(),"login":login_state(app)})
}

fn assert_trusted(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法确认首选项窗口来源。")?;
    if window.label() != "preferences" || !crate::local_url(&url, "/preferences.html") {
        return Err("此窗口不能访问首选项。".into());
    }
    Ok(())
}

#[tauri::command]
pub fn preferences_get(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    assert_trusted(&window)?;
    let state = app.state::<PreferencesState>();
    let value = state.value.lock().map_err(|_| "暂时无法读取首选项。")?;
    Ok(snapshot(&app, &value))
}

#[tauri::command]
pub fn preferences_set(
    app: AppHandle,
    window: WebviewWindow,
    patch: Value,
) -> Result<Value, String> {
    assert_trusted(&window)?;
    let patch = validate_patch(patch)?;
    let state = app.state::<PreferencesState>();
    let mut value = state.value.lock().map_err(|_| "暂时无法保存首选项。")?;
    let mut next = value.clone();
    if let Some(targets) = patch.pinned_targets {
        next.pinned_targets = targets;
    }
    if let Some(label) = patch.show_tray_label {
        next.show_tray_label = label;
    }
    let mut previous_login = None;
    if let Some(enabled) = patch.open_at_login {
        if let Some(reason) = login_unavailable_reason() {
            return Err(reason.into());
        }
        let autolaunch = app.autolaunch();
        let previous = autolaunch
            .is_enabled()
            .map_err(|_| "暂时无法读取系统启动项。")?;
        if enabled != previous {
            if enabled {
                autolaunch.enable()
            } else {
                autolaunch.disable()
            }
            .map_err(|_| "系统未能保存开机自启动设置，请重试。")?;
            if !matches!(autolaunch.is_enabled(), Ok(current) if current == enabled) {
                let _ = if previous {
                    autolaunch.enable()
                } else {
                    autolaunch.disable()
                };
                return Err("系统尚未确认开机自启动设置，请在系统启动项设置中检查。".into());
            }
            previous_login = Some(previous);
        }
    }
    if next != *value {
        if write_preferences(&state.file, &next).is_err() {
            if let Some(previous) = previous_login {
                let autolaunch = app.autolaunch();
                let rollback = if previous {
                    autolaunch.enable()
                } else {
                    autolaunch.disable()
                };
                if rollback.is_err() {
                    return Err("首选项保存失败，请在系统设置中检查开机自启动状态。".into());
                }
            }
            return Err("无法写入本机首选项，请检查磁盘空间和目录权限。".into());
        }
        *value = next;
    }
    let result = snapshot(&app, &value);
    drop(value);
    crate::shell::refresh_tray(&app);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_directory() -> PathBuf {
        let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        std::env::temp_dir().join(format!(
            "md2chat-preferences-test-{}-{sequence}",
            std::process::id()
        ))
    }

    #[test]
    fn image_can_be_pinned_with_all_formats_and_survives_reload() {
        let targets = json!(["email", "image", "wechat", "dingtalk", "feishu", "wecom"]);
        let patch = validate_patch(json!({"pinnedTargets": targets})).unwrap();
        let directory = temporary_directory();
        let file = directory.join("preferences.json");
        let expected = Preferences {
            pinned_targets: patch.pinned_targets.unwrap(),
            show_tray_label: true,
            language: "ja".into(),
            ..Preferences::default()
        };
        write_preferences(&file, &expected).unwrap();
        assert_eq!(read_preferences(&file).unwrap(), expected);
        assert_eq!(json!(expected.pinned_targets), targets);
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn patch_preserves_user_target_order() {
        let patch = validate_patch(
            json!({"pinnedTargets":["email","feishu","wechat"],"openAtLogin":false}),
        )
        .unwrap();
        assert_eq!(patch.pinned_targets.unwrap(), ["email", "feishu", "wechat"]);
        assert_eq!(patch.open_at_login, Some(false));
    }

    #[test]
    fn rejects_unknown_duplicate_or_mistyped_preferences() {
        for value in [
            json!(null),
            json!([]),
            json!({"extra":true}),
            json!({"pinnedTargets":["wechat","wechat"]}),
            json!({"pinnedTargets":["unknown"]}),
            json!({"pinnedTargets":[null]}),
            json!({"showTrayLabel":"true"}),
            json!({"openAtLogin":1}),
        ] {
            assert!(validate_patch(value).is_err());
        }
        assert!(validate_patch(json!({"pinnedTargets":[]})).is_ok());
    }

    #[test]
    fn atomic_store_overwrites_existing_file_and_keeps_private_permissions() {
        let directory = temporary_directory();
        let file = directory.join("preferences.json");
        assert_eq!(read_preferences(&file).unwrap(), Preferences::default());
        write_preferences(&file, &Preferences::default()).unwrap();
        let expected = Preferences {
            pinned_targets: vec!["wecom".into(), "dingtalk".into()],
            show_tray_label: true,
            language: "ja".into(),
            ..Preferences::default()
        };
        write_preferences(&file, &expected).unwrap();
        assert_eq!(read_preferences(&file).unwrap(), expected);
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&file).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn old_preferences_keep_their_settings_and_default_to_auto_language() {
        let value: Preferences =
            serde_json::from_str(r#"{"pinnedTargets":["email"],"showTrayLabel":true}"#).unwrap();
        assert_eq!(value.language, "auto");
        assert_eq!(value.pinned_targets, ["email"]);
        assert!(value.show_tray_label);
        assert_eq!(value.shortcuts, crate::shortcuts::Configuration::default());
    }

    #[test]
    fn broken_shortcut_settings_do_not_reset_existing_preferences() {
        for shortcuts in [
            json!(null),
            json!({"enabled":"yes"}),
            json!({"enabled":true,"bindings":{"email":{"modifiers":[],"key":"KeyC"}}}),
        ] {
            let value: Preferences = serde_json::from_value(json!({
                "pinnedTargets":["email","image"],"showTrayLabel":true,"language":"ja","shortcuts":shortcuts
            })).unwrap();
            assert_eq!(value.pinned_targets, ["email", "image"]);
            assert_eq!(value.language, "ja");
            assert!(value.show_tray_label);
            assert_eq!(value.shortcuts, crate::shortcuts::Configuration::default());
        }
    }

    #[test]
    fn damaged_or_invalid_saved_settings_use_defaults() {
        let directory = temporary_directory();
        fs::create_dir_all(&directory).unwrap();
        let file = directory.join("preferences.json");
        for content in [
            "{",
            "{\"pinnedTargets\":[\"wechat\",\"wechat\"]}",
            "{\"openAtLogin\":true}",
        ] {
            fs::write(&file, content).unwrap();
            assert_eq!(read_preferences(&file).unwrap(), Preferences::default());
        }
        fs::remove_dir_all(directory).unwrap();
    }
}
