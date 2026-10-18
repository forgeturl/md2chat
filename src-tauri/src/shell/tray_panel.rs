//! Windows tray UI. Keep IPC restricted to the bundled panel; clipboard access
//! still belongs exclusively to the existing conversion service and editor.
#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

use serde_json::{json, Value};
use tauri::{
    AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};

pub(crate) const LABEL: &str = "tray-panel";
const EVENT: &str = "md2chat:tray-panel";
const WIDTH: f64 = 320.0;
const HEIGHT: f64 = 648.0;

fn trusted(window: &WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法确认调用来源")?;
    if window.label() == LABEL && crate::local_url(&url, "/tray-panel.html") {
        Ok(())
    } else {
        Err("不允许的调用来源".into())
    }
}

fn snapshot(app: &AppHandle) -> Value {
    let preferences = crate::preferences::current(app);
    let busy = crate::is_busy(app);
    let mut targets = preferences.pinned_targets;
    for target in crate::preferences::TARGETS {
        if !targets.iter().any(|value| value == target) {
            targets.push(target.to_owned());
        }
    }
    let conversions: Vec<Value> = targets
        .iter()
        .filter_map(|target| {
            super::target_label(target).map(|label| {
                json!({
                    "id": format!("convert:{target}"), "icon": target,
                    "label": crate::locale::tr(app, label), "enabled": !busy,
                })
            })
        })
        .collect();
    let actions: Vec<Value> = [
        ("show-main", "window", "显示主窗口"),
        ("preferences", "preferences", "首选项"),
        ("help", "help", "帮助 ↗"),
        ("updates", "update", "检查更新"),
        ("quit", "quit", "彻底退出 md2chat"),
    ]
    .into_iter()
    .map(|(id, icon, label)| {
        json!({
            "id": id, "icon": icon, "label": crate::locale::tr(app, label), "enabled": true,
        })
    })
    .collect();
    json!({
        "title": crate::locale::tr(app, if busy { "正在转换…" } else { "剪贴板转换" }),
        "conversions": conversions, "actions": actions,
    })
}

#[tauri::command]
pub(crate) fn tray_panel_state(app: AppHandle, window: WebviewWindow) -> Result<Value, String> {
    trusted(&window)?;
    Ok(snapshot(&app))
}

#[tauri::command]
pub(crate) fn tray_panel_hide(window: WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    window.hide().map_err(|_| "无法收起快捷面板".into())
}

fn valid_action(action: &str) -> bool {
    super::conversion_target(action).is_some()
        || matches!(
            action,
            "show-main" | "preferences" | "help" | "updates" | "quit"
        )
}

#[tauri::command]
pub(crate) fn tray_panel_action(
    app: AppHandle,
    window: WebviewWindow,
    action: String,
) -> Result<(), String> {
    trusted(&window)?;
    if !valid_action(&action) {
        return Err("不支持的快捷操作".into());
    }
    if super::conversion_target(&action).is_some() && crate::is_busy(&app) {
        return Err(crate::locale::tr(&app, "正在转换…"));
    }
    window.hide().map_err(|_| "无法收起快捷面板")?;
    super::activate_menu_action(&app, &action);
    Ok(())
}

pub(crate) fn refresh(app: &AppHandle) {
    let _ = app.emit_to(LABEL, EVENT, snapshot(app));
}

pub(crate) fn create(app: &AppHandle) -> tauri::Result<()> {
    let window = WebviewWindowBuilder::new(app, LABEL, WebviewUrl::App("tray-panel.html".into()))
        .title("md2chat")
        .inner_size(WIDTH, HEIGHT)
        .visible(false)
        .focused(false)
        .decorations(false)
        .shadow(true)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .zoom_hotkeys_enabled(false)
        .on_navigation(|url| crate::local_url(url, "/tray-panel.html"))
        .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
        .build()?;
    // App-wide menus are inherited by new windows on Windows.
    window.remove_menu()?;
    let handle = window.clone();
    window.on_window_event(move |event| match event {
        WindowEvent::Focused(false) => {
            let _ = handle.hide();
        }
        WindowEvent::CloseRequested { api, .. } => {
            api.prevent_close();
            let _ = handle.hide();
        }
        _ => {}
    });
    Ok(())
}

// All coordinates here are physical pixels, including negative monitor origins.
// Use the target monitor's scale, rather than the main editor's current DPI.
fn placement(
    work: (i32, i32, u32, u32),
    anchor: (f64, f64, f64, f64),
    scale: f64,
) -> (PhysicalPosition<i32>, PhysicalSize<u32>) {
    let (left, top, width, height) = work;
    let gap = (8.0 * scale).round() as i32;
    let w = ((WIDTH * scale).round() as u32).min(width.saturating_sub((gap * 2) as u32).max(1));
    let h = ((HEIGHT * scale).round() as u32).min(height.saturating_sub((gap * 2) as u32).max(1));
    let min_x = left + gap.min((width.saturating_sub(w) / 2) as i32);
    let min_y = top + gap.min((height.saturating_sub(h) / 2) as i32);
    let max_x = (left + width as i32 - gap - w as i32).max(min_x);
    let max_y = (top + height as i32 - gap - h as i32).max(min_y);
    let x = (anchor.0 + anchor.2 - w as f64).round() as i32;
    let below = (anchor.1 + anchor.3).round() as i32 + gap;
    let y = if below <= max_y {
        below
    } else {
        anchor.1.round() as i32 - gap - h as i32
    };
    (
        PhysicalPosition::new(x.clamp(min_x, max_x), y.clamp(min_y, max_y)),
        PhysicalSize::new(w, h),
    )
}

pub(crate) fn show(app: &AppHandle, point: PhysicalPosition<f64>, rect: Rect) -> tauri::Result<()> {
    let window = app
        .get_webview_window(LABEL)
        .ok_or(tauri::Error::WindowNotFound)?;
    let monitor = app
        .monitor_from_point(point.x, point.y)?
        .or(app.primary_monitor()?)
        .ok_or(tauri::Error::WindowNotFound)?;
    let scale = monitor.scale_factor();
    let work = monitor.work_area();
    let anchor = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    let (position, size) = placement(
        (
            work.position.x,
            work.position.y,
            work.size.width,
            work.size.height,
        ),
        (anchor.x, anchor.y, size.width, size.height),
        scale,
    );
    window.set_position(position)?;
    window.set_size(size)?;
    refresh(app);
    window.show()?;
    window.set_focus()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_known_panel_actions_are_accepted() {
        for action in [
            "convert:image",
            "convert:wechat",
            "convert:email",
            "show-main",
            "quit",
        ] {
            assert!(valid_action(action));
        }
        for action in [
            "convert:unknown",
            "convert:",
            "fullscreen",
            "hide-to-tray",
            "https://example.com",
        ] {
            assert!(!valid_action(action));
        }
    }

    #[test]
    fn panel_stays_in_work_area_at_all_edges_scales_and_monitor_origins() {
        for scale in [1.0, 1.25, 1.5, 2.0] {
            for work in [
                (0, 0, 1920, 1040),
                (-2560, -200, 2560, 1400),
                (1920, 40, 1280, 680),
                (0, 0, 300, 400),
            ] {
                let (x, y, w, h) = work;
                for anchor in [
                    (x as f64, y as f64, 24.0, 24.0),
                    (
                        (x + w as i32 - 24) as f64,
                        (y + h as i32) as f64,
                        24.0,
                        24.0,
                    ),
                ] {
                    let (pos, size) = placement(work, anchor, scale);
                    assert!(pos.x >= x && pos.y >= y);
                    assert!(pos.x + size.width as i32 <= x + w as i32);
                    assert!(pos.y + size.height as i32 <= y + h as i32);
                    assert!(size.width > 0 && size.height > 0);
                }
            }
        }
    }
}
