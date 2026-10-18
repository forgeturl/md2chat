use crate::preferences;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    image::Image,
    menu::{IconMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

#[cfg(target_os = "macos")]
mod macos;

pub(crate) mod tray_panel;

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
    IconMenuItem::with_id(
        app,
        id,
        crate::locale::tr(app, text),
        enabled,
        icon(icon_name),
        None::<&str>,
    )
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
        crate::locale::tr(
            app,
            if busy {
                "正在转换…"
            } else {
                "剪贴板转换"
            },
        ),
        !busy,
        icon("clipboard"),
    )?;
    for target in preferences::TARGETS {
        conversions.append(&conversion_item(app, target, !busy)?)?;
    }
    menu.append(&conversions)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(
        app,
        "show-main",
        &crate::locale::tr(app, "显示主窗口"),
        true,
        "window",
    )?)?;
    menu.append(&item(
        app,
        "preferences",
        &crate::locale::tr(app, "首选项"),
        true,
        "preferences",
    )?)?;
    menu.append(&item(
        app,
        "help",
        &crate::locale::tr(app, "帮助 ↗"),
        true,
        "help",
    )?)?;
    menu.append(&item(
        app,
        "updates",
        &crate::locale::tr(app, "检查更新"),
        true,
        "update",
    )?)?;
    menu.append(&PredefinedMenuItem::separator(app)?)?;
    menu.append(&item(
        app,
        "quit",
        &crate::locale::tr(app, "彻底退出 md2chat"),
        true,
        "quit",
    )?)?;
    Ok(menu)
}

fn application_menu(app: &AppHandle) -> tauri::Result<Menu<tauri::Wry>> {
    let menu = Menu::new(app)?;
    let application = Submenu::new(
        app,
        crate::locale::tr(
            app,
            if cfg!(target_os = "macos") {
                "md2chat"
            } else {
                "文件"
            },
        ),
        true,
    )?;
    #[cfg(target_os = "macos")]
    {
        application.append(&PredefinedMenuItem::about(
            app,
            Some(&crate::locale::tr(app, "关于 md2chat")),
            None,
        )?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
    }
    #[cfg(not(target_os = "macos"))]
    application.append(&item(
        app,
        "show-main",
        &crate::locale::tr(app, "显示主窗口"),
        true,
        "window",
    )?)?;
    application.append(&MenuItem::with_id(
        app,
        "preferences",
        &crate::locale::tr(app, "首选项…"),
        true,
        Some("CmdOrCtrl+,"),
    )?)?;
    application.append(&item(
        app,
        "help",
        &crate::locale::tr(app, "帮助 ↗"),
        true,
        "help",
    )?)?;
    application.append(&item(
        app,
        "updates",
        &crate::locale::tr(app, "检查更新"),
        true,
        "update",
    )?)?;
    application.append(&PredefinedMenuItem::separator(app)?)?;
    #[cfg(target_os = "macos")]
    {
        application.append(&PredefinedMenuItem::services(
            app,
            Some(&crate::locale::tr(app, "服务")),
        )?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
        application.append(&PredefinedMenuItem::hide(
            app,
            Some(&crate::locale::tr(app, "隐藏 md2chat")),
        )?)?;
        application.append(&PredefinedMenuItem::hide_others(
            app,
            Some(&crate::locale::tr(app, "隐藏其他")),
        )?)?;
        application.append(&PredefinedMenuItem::show_all(
            app,
            Some(&crate::locale::tr(app, "显示全部")),
        )?)?;
        application.append(&PredefinedMenuItem::separator(app)?)?;
    }
    application.append(&MenuItem::with_id(
        app,
        "hide-to-tray",
        &crate::locale::tr(app, "关闭窗口并驻留托盘"),
        true,
        Some("CmdOrCtrl+Q"),
    )?)?;
    menu.append(&application)?;

    let edit = Submenu::with_items(
        app,
        &crate::locale::tr(app, "编辑"),
        true,
        &[
            &PredefinedMenuItem::undo(app, Some(&crate::locale::tr(app, "撤销")))?,
            &PredefinedMenuItem::redo(app, Some(&crate::locale::tr(app, "重做")))?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::cut(app, Some(&crate::locale::tr(app, "剪切")))?,
            &PredefinedMenuItem::copy(app, Some(&crate::locale::tr(app, "复制")))?,
            &PredefinedMenuItem::paste(app, Some(&crate::locale::tr(app, "粘贴")))?,
            &PredefinedMenuItem::select_all(app, Some(&crate::locale::tr(app, "全选")))?,
        ],
    )?;
    menu.append(&edit)?;

    let view = Submenu::new(app, &crate::locale::tr(app, "视图"), true)?;
    #[cfg(target_os = "macos")]
    view.append(&PredefinedMenuItem::fullscreen(
        app,
        Some(&crate::locale::tr(app, "进入全屏")),
    )?)?;
    #[cfg(not(target_os = "macos"))]
    view.append(&MenuItem::with_id(
        app,
        "fullscreen",
        &crate::locale::tr(app, "切换全屏"),
        true,
        Some("F11"),
    )?)?;
    menu.append(&view)?;

    let window = Submenu::with_items(
        app,
        &crate::locale::tr(app, "窗口"),
        true,
        &[
            &PredefinedMenuItem::minimize(app, Some(&crate::locale::tr(app, "最小化")))?,
            &PredefinedMenuItem::maximize(app, Some(&crate::locale::tr(app, "缩放")))?,
            &PredefinedMenuItem::close_window(app, Some(&crate::locale::tr(app, "关闭窗口")))?,
        ],
    )?;
    #[cfg(target_os = "macos")]
    window.append(&PredefinedMenuItem::bring_all_to_front(
        app,
        Some(&crate::locale::tr(app, "前置所有窗口")),
    )?)?;
    menu.append(&window)?;
    Ok(menu)
}

pub fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        restore_dock(app);
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn restore_dock(_app: &AppHandle) {
    #[cfg(target_os = "macos")]
    if let Err(error) = _app.set_activation_policy(tauri::ActivationPolicy::Regular) {
        eprintln!("md2chat: 无法恢复 Dock 图标：{error}");
    }
}

fn hide_to_tray(app: &AppHandle) {
    if app.tray_by_id(TRAY_ID).is_none() {
        // Without a tray there would be no way to reopen a hidden application.
        quit(app);
        return;
    }
    for window in app.webview_windows().values() {
        if let Err(error) = window.hide() {
            eprintln!("md2chat: 无法隐藏窗口：{error}");
            return;
        }
    }
    #[cfg(target_os = "macos")]
    if let Err(error) = app.set_activation_policy(tauri::ActivationPolicy::Accessory) {
        eprintln!("md2chat: 无法隐藏 Dock 图标：{error}");
    }
}

fn should_keep_in_tray(code: Option<i32>, quitting: bool, tray_available: bool) -> bool {
    // Explicit tray quit, smoke-test completion and updater restarts carry a
    // code and must finish normally. Native macOS termination is handled by
    // the application delegate, since it bypasses Tauri's exit event.
    code.is_none() && !quitting && tray_available
}

pub fn handle_exit_request(app: &AppHandle, code: Option<i32>, api: &tauri::ExitRequestApi) {
    let quitting = app
        .try_state::<ShellState>()
        .map(|state| state.quitting.load(Ordering::Acquire))
        .unwrap_or(false);
    let reopen_available =
        app.tray_by_id(TRAY_ID).is_some() && app.get_webview_window("main").is_some();
    if should_keep_in_tray(code, quitting, reopen_available) {
        api.prevent_exit();
        hide_to_tray(app);
    }
}

pub fn open_preferences(app: &AppHandle) {
    restore_dock(app);
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
    .title(format!("{} · md2chat", crate::locale::tr(app, "首选项")))
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
    #[cfg(target_os = "windows")]
    if app.get_webview_window(tray_panel::LABEL).is_some() {
        tray_panel::refresh(app);
        return;
    }
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

pub(crate) fn refresh_locale(app: &AppHandle) {
    if let Ok(menu) = application_menu(app) {
        let _ = app.set_menu(menu);
    }
    #[cfg(target_os = "windows")]
    if let Some(window) = app.get_webview_window(tray_panel::LABEL) {
        let _ = window.remove_menu();
    }
    refresh_tray(app);
    if let Some(window) = app.get_webview_window("preferences") {
        let _ = window.set_title(&format!("{} · md2chat", crate::locale::tr(app, "首选项")));
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_title("md2chat");
    }
}

fn quit(app: &AppHandle) {
    if let Some(state) = app.try_state::<ShellState>() {
        state.quitting.store(true, Ordering::Release);
    }
    app.exit(0);
}

#[cfg(debug_assertions)]
pub(crate) async fn smoke_check(app: AppHandle) -> Result<serde_json::Value, String> {
    if !std::env::args().any(|arg| arg == "--smoke") {
        return Err("未启用本机验证模式".into());
    }
    let (sender, receiver) = tokio::sync::oneshot::channel();
    let handle = app.clone();
    app.run_on_main_thread(move || {
        let _ = sender.send(smoke_check_on_main(&handle));
    })
    .map_err(|_| "驻留验证：无法调度本机操作")?;
    receiver.await.map_err(|_| "驻留验证：本机操作中断")?
}

#[cfg(debug_assertions)]
fn smoke_check_on_main(app: &AppHandle) -> Result<serde_json::Value, String> {
    show_window(app);
    open_preferences(app);
    let main = app.get_webview_window("main").ok_or("主窗口不存在")?;
    let preferences = app
        .get_webview_window("preferences")
        .ok_or("首选项窗口不存在")?;
    if !main.is_visible().unwrap_or(false) || !preferences.is_visible().unwrap_or(false) {
        return Err("驻留验证：窗口未显示".into());
    }
    #[cfg(target_os = "macos")]
    macos::smoke_quit();
    #[cfg(not(target_os = "macos"))]
    hide_to_tray(app);
    if main.is_visible().unwrap_or(true)
        || preferences.is_visible().unwrap_or(true)
        || app.tray_by_id(TRAY_ID).is_none()
    {
        return Err("驻留验证：退出后窗口未隐藏或托盘丢失".into());
    }
    #[cfg(target_os = "macos")]
    if macos::dock_visible() {
        return Err("驻留验证：退出后 Dock 图标仍显示".into());
    }
    open_preferences(app);
    #[cfg(target_os = "macos")]
    if !macos::dock_visible() {
        return Err("驻留验证：打开首选项未恢复 Dock 图标".into());
    }
    hide_to_tray(app);
    show_window(app);
    if !main.is_visible().unwrap_or(false) || preferences.is_visible().unwrap_or(true) {
        return Err("驻留验证：主窗口未恢复或首选项被意外打开".into());
    }
    #[cfg(target_os = "macos")]
    if !macos::dock_visible() {
        return Err("驻留验证：打开主窗口未恢复 Dock 图标".into());
    }
    Ok(serde_json::json!({"status":"passed", "quitKeepsTray":true, "reopenWindows":true}))
}

fn activate_menu_action(app: &AppHandle, id: &str) {
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
        "hide-to-tray" => hide_to_tray(app),
        "fullscreen" => {
            if let Some(window) = app.get_webview_window("main") {
                if let Ok(fullscreen) = window.is_fullscreen() {
                    let _ = window.set_fullscreen(!fullscreen);
                }
            }
        }
        _ => {}
    }
}

pub fn setup(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    preferences::setup(app.handle())?;
    crate::locale::setup(app.handle());
    app.manage(ShellState {
        quitting: AtomicBool::new(false),
    });
    app.set_menu(application_menu(app.handle())?)?;
    app.on_menu_event(|app, event| activate_menu_action(app, event.id().as_ref()));

    // Preload the small Windows panel so the first click does not create a WebView.
    #[cfg(not(target_os = "windows"))]
    let use_panel = false;
    #[cfg(target_os = "windows")]
    let use_panel = match tray_panel::create(app.handle()) {
        Ok(()) => true,
        Err(error) => {
            eprintln!("md2chat: 快捷面板暂不可用，改用原生托盘菜单：{error}");
            false
        }
    };

    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(include_bytes!(
            "../../assets/menu-icons/tray.png"
        ))?)
        .icon_as_template(false)
        .tooltip("md2chat");
    let tray = if use_panel {
        tray
    } else {
        tray.menu(&tray_menu(app.handle())?)
    };
    let tray = tray
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| match event {
            #[cfg(target_os = "windows")]
            TrayIconEvent::Click {
                button: MouseButton::Right,
                button_state: MouseButtonState::Up,
                position,
                rect,
                ..
            } if tray
                .app_handle()
                .get_webview_window(tray_panel::LABEL)
                .is_some() =>
            {
                if let Err(error) = tray_panel::show(tray.app_handle(), position, rect) {
                    eprintln!("md2chat: 无法打开快捷面板：{error}");
                    show_window(tray.app_handle());
                }
            }
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
    #[cfg(target_os = "macos")]
    macos::install(app.handle())?;

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
        hide_to_tray(app.handle());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_quit_stays_in_tray_only_when_reopen_is_available() {
        assert!(should_keep_in_tray(None, false, true));
        assert!(!should_keep_in_tray(None, false, false));
        assert!(!should_keep_in_tray(None, true, true));
    }

    #[test]
    fn explicit_exit_and_update_restart_are_never_prevented() {
        for code in [0, 1, tauri::RESTART_EXIT_CODE] {
            for quitting in [false, true] {
                for tray_available in [false, true] {
                    assert!(!should_keep_in_tray(Some(code), quitting, tray_available));
                }
            }
        }
    }

    #[test]
    fn conversion_menu_dispatch_is_limited_to_known_targets() {
        for target in preferences::TARGETS {
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
