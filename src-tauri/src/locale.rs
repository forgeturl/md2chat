//! Locale-only IPC is available to the two bundled windows; clipboard IPC remains main-window-only.
use serde_json::{json, Value};
use std::sync::{Mutex, OnceLock};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

const CODES: [&str; 9] = ["zh-CN", "en", "es", "pt-BR", "ja", "ko", "de", "fr", "hi"];
struct LocaleState(Mutex<String>);

pub(crate) fn valid(preference: &str) -> bool {
    preference == "auto" || CODES.contains(&preference)
}
fn resolve(preference: &str, detected: &str) -> String {
    if CODES.contains(&preference) {
        preference
    } else if CODES.contains(&detected) {
        detected
    } else {
        "en"
    }
    .into()
}
pub(crate) fn setup(app: &AppHandle) {
    let preference = crate::preferences::current(app).language;
    app.manage(LocaleState(Mutex::new(resolve(&preference, "en"))));
}
fn catalog() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../assets/locales.json"))
            .expect("bundled locale catalog")
    })
}
fn lookup<'a>(source: &'a str, locale: &str) -> &'a str {
    let entry = &catalog()["messages"][source];
    entry[locale]
        .as_str()
        .or_else(|| entry["en"].as_str())
        .unwrap_or(source)
}
pub(crate) fn tr(app: &AppHandle, source: &str) -> String {
    let locale = app
        .try_state::<LocaleState>()
        .and_then(|state| state.0.lock().ok().map(|value| value.clone()))
        .unwrap_or_else(|| "en".into());
    lookup(source, &locale).to_owned()
}
fn assert_trusted(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "Unable to verify window")?;
    if (window.label() == "main" && crate::local_url(&url, "/editor.html"))
        || (window.label() == "preferences" && crate::local_url(&url, "/preferences.html"))
    {
        Ok(())
    } else {
        Err("This window cannot access language settings".into())
    }
}
#[tauri::command]
pub fn locale_get(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    assert_trusted(&window)?;
    let preference = crate::preferences::current(&app).language;
    Ok(json!({"preference":preference}))
}
#[tauri::command]
pub fn locale_set(
    app: AppHandle,
    window: WebviewWindow,
    preference: String,
    detected: String,
) -> Result<Value, String> {
    assert_trusted(&window)?;
    if !valid(&preference) || !CODES.contains(&detected.as_str()) {
        return Err("Unsupported language".into());
    }
    crate::preferences::save_language(&app, &preference)?;
    let effective = resolve(&preference, &detected);
    let state = app.state::<LocaleState>();
    let mut current = state.0.lock().map_err(|_| "Unable to apply language")?;
    let changed = *current != effective;
    *current = effective.clone();
    drop(current);
    if changed {
        crate::shell::refresh_locale(&app);
    }
    let value = json!({"preference":preference,"locale":effective});
    let _ = app.emit("md2chat:locale", &value);
    Ok(value)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unsupported_values_never_become_locales() {
        for code in CODES {
            assert!(valid(code));
            assert_eq!(resolve(code, "en"), code);
        }
        assert!(valid("auto"));
        assert!(!valid("../../en"));
        assert_eq!(resolve("auto", "ja"), "ja");
        assert_eq!(resolve("auto", "unknown"), "en");
    }
    #[test]
    fn menus_use_the_shared_catalog_and_safe_fallbacks() {
        for code in CODES {
            assert!(!lookup("首选项", code).is_empty());
            assert_eq!(lookup("md2chat", code), "md2chat");
        }
        assert_eq!(lookup("首选项", "en"), "Preferences");
        assert_eq!(lookup("首选项", "ja"), "設定");
    }
}
