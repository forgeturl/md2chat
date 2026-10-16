use crate::preferences;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const TRAY_ID: &str = "md2chat-tray";
const HELP_URL: &str = "https://github.com/forgeturl/md2chat/issues";

struct ShellState {
    quitting: AtomicBool,
}

fn icon(name: &str) -> Option<Image<'static>> {
    let bytes: &[u8] = match name {
        "wechat" => include_bytes!("../../assets/menu-icons/wechat.png"),
        "dingtalk" => include_bytes!("../../assets/menu-icons/dingtalk.png"),
        "feishu" => include_bytes!("../../assets/menu-icons/feishu.png"),
        "wecom" => include_bytes!("../../assets/menu-icons/wecom.png"),
        "email" => include_bytes!("../../assets/menu-icons/email.png"),
        "image" => include_bytes!("../../assets/menu-icons/image.png"),
        "clipboard" => include_bytes!("../../assets/menu-icons/clipboard.png"),
        "window" => include_bytes!("../../assets/menu-icons/window.png"),
        "preferences" => include_bytes!("../../assets/menu-icons/preferences.png"),
        "help" => include_bytes!("../../assets/menu-icons/help.png"),
        "update" => include_bytes!("../../assets/menu-icons/update.png"),
        "quit" => include_bytes!("../../assets/menu-icons/quit.png"),
        _ => return None,
    };
    Image::from_bytes(bytes).ok()
}

fn item(
    app: &AppHandle,
    id: &str,
    text: &str,
    enabled: bool,
    icon_name: &str,
) -> tauri::Result<IconMenuItem<tauri::Wry>> {
    IconMenuItem::with_id(app, id, text, enabled, icon(icon_name), None::<&str>)
}

fn target_label(target: &str) -> Option<&'static str> {
    match target {
        "wechat" => Some("微信格式"),
        "dingtalk" => Some("钉钉格式"),
        "feishu" => Some("飞书格式"),
        "wecom" => Some("企业微信格式"),
        "email" => Some("邮件格式"),
        "image" => Some("转图片"),
        _ => None,
    }
}

fn conversion_target(id: &str) -> Option<&str> {
    let target = id.strip_prefix("convert:")?;
    target_label(target).map(|_| target)
}

fn conversion_item(
    app: &AppHandle,
    target: &str,
    enabled: bool,
) -> tauri::Result<IconMenuItem<tauri::Wry>> {
    item(
        app,
        &format!("convert:{target}"),
        target_label(target).unwrap_or("格式"),
        enabled,
        target,
    )
}

fn tray_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let preferences = preferences::current(app);
    let busy = crate::is_busy(app);
    let menu = Menu::new(app)?;
    for target in &preferences.pinned_targets {
        menu.append(&conversion_item(app, target, !busy)?)?;
    }
    let conversions = Submenu::new_with_icon(
        app,
        if busy {
            "正在转换…"
        } else {
            "剪贴板转换"
        },
        !busy,
        icon("clipboard"),
    )?;
    conversions.append(&conversion_item(app, "image", !busy)?)?;
    for target in preferences::TARGETS {
        conversions.append(&conversion_item(app, target, !busy)?)?;
    }
    menu.append(&conversions)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(app, "show-main", "显示主窗口", true, "window")?)?;
    menu.append(&item(app, "preferences", "首选项", true, "preferences")?)?;
    menu.append(&item(app, "help", "帮助 ↗", true, "help")?)?;
    menu.append(&item(app, "updates", "检查更新", true, "update")?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(app, "quit", "退出 md2chat", true, "quit")?)?;
    Ok(menu)
}

fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let application = Submenu::new(
        app,
        if cfg!(target_os = "macos") {
            "md2chat"
        } else {
            "文件"
        },
        true,
    )?;
    #[cfg(target_os = "macos")]
    {
        application.append(&PredefinedMenuItem::about(app, Some("关于 md2chat"), None)?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
    }
    #[cfg(not(target_os = "macos"))]
    application.append(&item(app, "show-main", "显示主窗口", true, "window")?)?;
    application.append(&MenuItem::with_id(
        app,
        "preferences",
        "首选项…",
        true,
        Some("CmdOrCtrl+,"),
    )?)?;
    application.append(&item(app, "help", "帮助 ↗", true, "help")?)?;
    application.append(&item(app, "updates", "检查更新", true, "update")?)?;
    application.append(&PredefinedMenuItem::separator(app)?)?;
    #[cfg(target_os = "macos")]
    {
        application.append(&PredefinedMenuItem::services(app, Some("服务"))?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::hide(app, Some("隐藏 md2chat"))?)?;
        application.append(&PredefinedMenuItem::hide_others(app, Some("隐藏其他"))?)?;
        application.append(&PredefinedMenuItem::show_all(app, Some("显示全部"))?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
    }
    application.append(&MenuItem::with_id(
        app,
        "quit",
        "退出 md2chat",
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;
    menu.append(&application)?;

    let edit = Submenu::with_items(
        app,
        "编辑",
        true,
        &[
            &PredefinedMenuItem::undo(app, Some("撤销"))?,
            &PredefinedMenuItem::redo(app, Some("重做"))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some("剪切"))?,
            &PredefinedMenuItem::copy(app, Some("复制"))?,
            &PredefinedMenuItem::paste(app, Some("粘贴"))?,
            &PredefinedMenuItem::select_all(app, Some("全选"))?,
        ],
    )?;
    menu.append(&edit)?;

    let view = Submenu::new(app, "视图", true)?;
    #[cfg(target_os = "macos")]
    view.append(&PredefinedMenuItem::fullscreen(app, Some("进入全屏"))?)?;
    #[cfg(not(target_os = "macos"))]
    view.append(&MenuItem::with_id(
        app,
        "fullscreen",
        "切换全屏",
        true,
        Some("F11"),
    )?)?;
    menu.append(&view)?;

    let window = Submenu::with_items(
        app,
        "窗口",
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some("最小化"))?,
            &PredefinedMenuItem::maximize(app, Some("缩放"))?,
            &PredefinedMenuItem::close_window(app, Some("关闭窗口"))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    window.append(&PredefinedMenuItem::bring_all_to_front(
        app,
        Some("前置所有窗口"),
    )?)?;
    menu.append(&window)?;
    Ok(menu)
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

pub fn open_preferences(app: &AppHandle) {
    // The menu callback runs on the UI thread, so checking and creating a label
    // is serialized and opening preferences repeatedly reuses the same window.
    if let Some(window) = app.get_webview_window("preferences") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let result = WebviewWindowBuilder::new(
        app,
        "preferences",
        WebviewUrl::App("preferences.html".into()),
    )
    .title("首选项 · md2chat")
    .inner_size(600.0, 680.0)
    .min_inner_size(520.0, 560.0)
    .visible(true)
    .center()
    .on_navigation(|url| crate::local_url(url, "/preferences.html"))
    .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
    .build();
    if let Err(error) = result {
        eprintln!("md2chat: 无法打开首选项：{error}");
    }
}

pub fn refresh_tray(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match tray_menu(app) {
        Ok(menu) => {
            let _ = tray.set_menu(Some(menu));
        }
        Err(error) => eprintln!("md2chat: 无法刷新托盘：{error}"),
    }
    #[cfg(target_os = "macos")]
    {
        let preferences = preferences::current(app);
        let _ = tray.set_title(Some(if preferences.show_tray_label {
            "md2chat"
        } else {
            ""
        }));
    }
}

fn quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<ShellState>() {
        state.quitting.store(true, Ordering::Release);
    }
    app.exit(0);
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    preferences::setup(app.handle())?;
    app.manage(ShellState {
        quitting: AtomicBool::new(false),
    });
    app.set_menu(application_menu(app.handle())?)?;
    app.on_menu_event(|app, event| {
        let id = event.id().as_ref();
        if let Some(target) = conversion_target(id) {
            if !crate::is_busy(app) {
                crate::start_conversion(app.clone(), target.to_owned());
            }
            return;
        }
        match id {
            "show-main" => show_window(app),
            "preferences" => open_preferences(app),
            "updates" => crate::open_updates(app),
            "help" => {
                let _ = app.opener().open_url(HELP_URL, None::<&str>);
            }
            "quit" => quit(app),
            "fullscreen" => {
                if let Some(window) = app.get_webview_window("main") {
                    if let Ok(fullscreen) = window.is_fullscreen() {
                        let _ = window.set_fullscreen(!fullscreen);
                    }
                }
            }
            _ => {}
        }
    });

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!(
            "../../assets/menu-icons/tray.png"
        ))?)
        .icon_as_template(false)
        .tooltip("md2chat · 贴贴 Markdown")
        .menu(&tray_menu(app.handle())?)
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| match event {
            TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } if !cfg!(target_os = "macos") => show_window(tray.app_handle()),
            TrayIconEvent::DoubleClick {
                button: MouseButton::Left,
                ..
            } => show_window(tray.app_handle()),
            _ => {}
        })
        .build(app);
    if let Err(error) = tray {
        eprintln!("md2chat: 托盘暂不可用，主窗口仍可使用：{error}");
    }
    refresh_tray(app.handle());

    if let Some(window) = app.get_webview_window("main") {
        let handle = app.handle().clone();
        window.on_window_event(move |event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let quitting = handle
                    .try_state::<ShellState>()
                    .map(|state| state.quitting.load(Ordering::Acquire))
                    .unwrap_or(false);
                if !quitting && handle.tray_by_id(TRAY_ID).is_some() {
                    api.prevent_close();
                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.hide();
                    }
                } else if !quitting {
                    quit(&handle);
                }
            }
        });
    }
    // The editor announces readiness after registering its render callbacks.
    // Normal launches are shown by conversion_ready; retain access if no tray
    // could be created, even when the front-end bridge fails to initialize.
    if app.tray_by_id(TRAY_ID).is_none() {
        show_window(app.handle());
    } else if std::env::args().any(|argument| argument == "--autostart" || argument == "--smoke") {
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.hide();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn conversion_menu_dispatch_is_limited_to_known_targets() {
        for target in preferences::TARGETS.into_iter().chain(["image"]) {
            assert_eq!(
                conversion_target(&format!("convert:{target}")),
                Some(target)
            );
        }
        for id in [
            "convert:",
            "convert:unknown",
            "wechat",
            "quit",
            "convert:wechat:extra",
        ] {
            assert_eq!(conversion_target(id), None);
        }
    }
}
