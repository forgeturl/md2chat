mod clipboard;
mod images;
mod preferences;
mod shell;
mod updates;

use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, AtomicU64, Ordering},
    Mutex,
};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

struct Pending {
    id: u64,
    request: Value,
    response: oneshot::Sender<Result<Vec<Value>, String>>,
}

#[derive(Default)]
struct RuntimeState {
    busy: AtomicBool,
    ready: AtomicBool,
    next_id: AtomicU64,
    pending: Mutex<Option<Pending>>,
}

fn trusted(window: &tauri::WebviewWindow) -> Result<(), String> {
    let url = window.url().map_err(|_| "无法确认调用来源")?;
    if window.label() != "main" || !local_url(&url, "/editor.html") {
        return Err("不允许的调用来源".into());
    }
    Ok(())
}

pub(crate) fn local_url(url: &url::Url, path: &str) -> bool {
    (url.scheme() == "tauri" && url.host_str() == Some("localhost")
        || matches!(url.scheme(), "http" | "https") && url.host_str() == Some("tauri.localhost"))
        && url.path() == path
}

pub fn is_busy(app: &tauri::AppHandle) -> bool {
    app.state::<RuntimeState>().busy.load(Ordering::SeqCst)
}

struct BusyGuard(tauri::AppHandle);
impl BusyGuard {
    fn acquire(app: &tauri::AppHandle) -> Result<Self, String> {
        app.state::<RuntimeState>()
            .busy
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| "正在转换或复制，请稍候再试。".to_owned())?;
        shell::refresh_tray(app);
        Ok(Self(app.clone()))
    }
}
impl Drop for BusyGuard {
    fn drop(&mut self) {
        self.0
            .state::<RuntimeState>()
            .busy
            .store(false, Ordering::SeqCst);
        shell::refresh_tray(&self.0);
    }
}

fn image_directory(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_cache_dir()
        .map(|p| p.join("clipboard-images"))
        .map_err(|_| "无法访问图片缓存目录".into())
}

async fn blocking<T: Send + 'static>(
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| "本机操作未完成，请重试。".to_owned())?
}

#[tauri::command]
async fn desktop_copy(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    parts: Vec<Value>,
    target: String,
) -> Result<Value, String> {
    trusted(&window)?;
    let _guard = BusyGuard::acquire(&app)?;
    let directory = image_directory(&app)?;
    blocking(move || clipboard::copy(parts, &target, &directory)).await
}

#[tauri::command]
async fn desktop_copy_segment(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    segment: Value,
) -> Result<Value, String> {
    trusted(&window)?;
    let _guard = BusyGuard::acquire(&app)?;
    blocking(move || clipboard::copy_segment(segment)).await
}

#[tauri::command]
async fn desktop_inspect(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
) -> Result<Value, String> {
    trusted(&window)?;
    let version = app.package_info().version.to_string();
    blocking(move || clipboard::inspect(&version)).await
}

#[tauri::command]
async fn desktop_read_local_image(
    window: tauri::WebviewWindow,
    source: String,
) -> Result<String, String> {
    trusted(&window)?;
    blocking(move || images::read_local_image(&source)).await
}

#[tauri::command]
async fn desktop_resolve_clipboard_html(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    html: String,
) -> Result<String, String> {
    trusted(&window)?;
    let directory = image_directory(&app)?;
    blocking(move || clipboard::resolve_html(&html, &directory)).await
}

#[tauri::command]
async fn desktop_test_dingtalk_html(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    mode: String,
) -> Result<Value, String> {
    trusted(&window)?;
    let _guard = BusyGuard::acquire(&app)?;
    blocking(move || clipboard::test_dingtalk_html(&mode)).await
}

#[tauri::command]
fn desktop_open_external(
    window: tauri::WebviewWindow,
    app: tauri::AppHandle,
    url: String,
) -> Result<(), String> {
    trusted(&window)?;
    let parsed = url::Url::parse(&url).map_err(|_| "链接无效")?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || !matches!(
            parsed.host_str(),
            Some("github.com" | "forgeturl.github.io")
        )
    {
        return Err("此链接不能在桌面应用中打开".into());
    }
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|_| "无法打开浏览器".into())
}

#[tauri::command]
fn desktop_smoke_result(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    mut report: Value,
) -> Result<(), String> {
    trusted(&window)?;
    if !std::env::args().any(|arg| arg == "--smoke") {
        return Err("未启用本机验证模式".into());
    }
    let path = std::env::var("MD2CHAT_SMOKE_REPORT")
        .map(std::path::PathBuf::from)
        .map_err(|_| "未指定验证报告文件")?;
    if let Some(images) = report.get_mut("images").and_then(Value::as_array_mut) {
        use base64::Engine;
        for (index, image) in images.iter_mut().enumerate() {
            let source = image.get("src").and_then(Value::as_str).unwrap_or("");
            if source.len() > 15 * 1024 * 1024 {
                return Err("验证图片过大".into());
            }
            let bytes = base64::engine::general_purpose::STANDARD
                .decode(
                    source
                        .strip_prefix("data:image/png;base64,")
                        .ok_or("验证图片格式无效")?,
                )
                .map_err(|_| "验证图片格式无效")?;
            let file = path.with_file_name(format!("md2chat-smoke-{index}.png"));
            std::fs::write(&file, bytes).map_err(|_| "无法保存验证图片")?;
            image.as_object_mut().unwrap().remove("src");
            image["path"] = json!(file);
        }
    }
    let exit_code = if report["status"] == "passed" { 0 } else { 1 };
    std::fs::write(
        path,
        serde_json::to_vec_pretty(&report).map_err(|_| "报告格式无效")?,
    )
    .map_err(|_| "无法保存验证报告")?;
    app.exit(exit_code);
    Ok(())
}

fn dispatch(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<RuntimeState>();
    if !state.ready.load(Ordering::SeqCst) {
        return Ok(());
    }
    let pending = state.pending.lock().map_err(|_| "转换状态不可用")?;
    if let Some(pending) = pending.as_ref() {
        app.emit_to("main", "md2chat:conversion-request", json!({"id":pending.id,"kind":pending.request["kind"],"target":pending.request["target"]}))
            .map_err(|_| "无法启动转换，请重新打开主窗口。")?;
    }
    Ok(())
}

#[tauri::command]
fn conversion_ready(app: tauri::AppHandle, window: tauri::WebviewWindow) -> Result<(), String> {
    trusted(&window)?;
    app.state::<RuntimeState>()
        .ready
        .store(true, Ordering::SeqCst);
    dispatch(&app)?;
    if !std::env::args().any(|arg| arg == "--autostart" || arg == "--smoke") {
        shell::show_window(&app);
    }
    Ok(())
}

#[tauri::command]
fn conversion_take(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u64,
) -> Result<Value, String> {
    trusted(&window)?;
    let state = app.state::<RuntimeState>();
    let pending = state.pending.lock().map_err(|_| "转换状态不可用")?;
    pending
        .as_ref()
        .filter(|p| p.id == id)
        .map(|p| p.request.clone())
        .ok_or_else(|| "转换请求已失效".into())
}

#[tauri::command]
fn conversion_result(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    id: u64,
    result: Value,
) -> Result<(), String> {
    trusted(&window)?;
    let state = app.state::<RuntimeState>();
    let mut slot = state.pending.lock().map_err(|_| "转换状态不可用")?;
    if slot.as_ref().is_none_or(|p| p.id != id) {
        return Ok(());
    }
    if let Some(pending) = slot.take() {
        let result = if let Some(error) = result.get("error").and_then(Value::as_str) {
            Err(error.chars().take(500).collect())
        } else {
            result
                .get("parts")
                .and_then(Value::as_array)
                .cloned()
                .ok_or_else(|| "转换结果格式错误".into())
        };
        let _ = pending.response.send(result);
    }
    Ok(())
}

async fn request_render(app: &tauri::AppHandle, request: Value) -> Result<Vec<Value>, String> {
    let state = app.state::<RuntimeState>();
    let id = state.next_id.fetch_add(1, Ordering::SeqCst) + 1;
    let (sender, receiver) = oneshot::channel();
    {
        let mut pending = state.pending.lock().map_err(|_| "转换状态不可用")?;
        if pending.is_some() {
            return Err("正在转换，请稍候。".into());
        }
        *pending = Some(Pending {
            id,
            request,
            response: sender,
        });
    }
    let result = match dispatch(app) {
        Ok(()) => match tokio::time::timeout(Duration::from_secs(60), receiver).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("转换窗口已重新加载，请重试。".into()),
            Err(_) => Err("转换超时，请减少内容后重试。".into()),
        },
        Err(error) => Err(error),
    };
    let mut pending = state.pending.lock().map_err(|_| "转换状态不可用")?;
    if pending.as_ref().is_some_and(|p| p.id == id) {
        pending.take();
    }
    result
}

async fn convert(app: &tauri::AppHandle, target: &str) -> Result<Value, String> {
    let _guard = BusyGuard::acquire(app)?;
    let directory = image_directory(app)?;
    let source = blocking({
        let directory = directory.clone();
        move || clipboard::read_source(&directory)
    })
    .await?;
    let fingerprint = source["fingerprint"]
        .as_str()
        .ok_or("无法确认剪贴板状态")?
        .to_owned();
    let parts = request_render(
        app,
        json!({"kind":"render","target":target,"content":source["content"]}),
    )
    .await?;
    let current = blocking({
        let directory = directory.clone();
        move || clipboard::read_source(&directory)
    })
    .await?;
    if current["fingerprint"].as_str() != Some(fingerprint.as_str()) {
        return Err("转换期间剪贴板已更新，已保留新内容。请重新选择转换格式。".into());
    }
    if target == "wecom" && parts.iter().any(|p| p["type"] == "image") {
        shell::show_window(app);
        request_render(
            app,
            json!({"kind":"segments","target":target,"parts":parts}),
        )
        .await?;
        return Ok(json!({"segmented":true,"target":target}));
    }
    if target == "image" {
        if parts.len() != 1 || parts[0]["type"] != "image" {
            return Err("转图片未生成完整 PNG，请重试。".into());
        }
        return blocking(move || {
            clipboard::copy_segment_guarded(parts[0].clone(), &directory, &fingerprint)
        })
        .await;
    }
    let target = target.to_owned();
    blocking(move || clipboard::copy_guarded(parts, &target, &directory, &fingerprint)).await
}

pub fn start_conversion(app: tauri::AppHandle, target: String) {
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_notification::NotificationExt;
        match convert(&app, &target).await {
            Ok(result) if result["segmented"] == true => {}
            Ok(_) => {
                let body = match target.as_str() {
                    "image" => "已转为图片并写入剪贴板，可以直接粘贴。",
                    "feishu" if cfg!(target_os = "macos") => {
                        "已转为飞书图文，请先展开飞书富文本输入框，再一次粘贴。"
                    }
                    _ => "已写入剪贴板，请到对应聊天输入框粘贴。",
                };
                let _ = app
                    .notification()
                    .builder()
                    .title("剪贴板转换完成")
                    .body(body)
                    .show();
            }
            Err(error) => {
                use tauri_plugin_dialog::DialogExt;
                app.dialog()
                    .message(error)
                    .title("剪贴板转换未完成")
                    .show(|_| {});
            }
        }
    });
}

pub fn open_updates(app: &tauri::AppHandle) {
    shell::show_window(app);
    let _ = app.emit_to("main", "md2chat:update-open", ());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _ = updates::check(&app).await;
    });
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            shell::show_window(app)
        }))
        .plugin({
            let autostart = tauri_plugin_autostart::Builder::new().args(["--autostart"]);
            #[cfg(target_os = "macos")]
            let autostart =
                autostart.macos_launcher(tauri_plugin_autostart::MacosLauncher::LaunchAgent);
            autostart.build()
        })
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(RuntimeState::default())
        .on_page_load(|window, payload| {
            if window.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Started)
            {
                let state = window.state::<RuntimeState>();
                state.ready.store(false, Ordering::SeqCst);
                if let Ok(mut pending) = state.pending.lock() {
                    pending.take();
                };
            }
            if window.label() == "main"
                && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished)
                && std::env::args().any(|arg| arg == "--smoke")
            {
                let _ = window.eval(include_str!("../../scripts/tauri-smoke.js"));
            }
        })
        .invoke_handler(tauri::generate_handler![
            desktop_copy,
            desktop_copy_segment,
            desktop_inspect,
            desktop_read_local_image,
            desktop_resolve_clipboard_html,
            desktop_test_dingtalk_html,
            desktop_open_external,
            desktop_smoke_result,
            conversion_ready,
            conversion_take,
            conversion_result,
            preferences::preferences_get,
            preferences::preferences_set,
            updates::update_status,
            updates::update_check,
            updates::update_download,
            updates::update_install
        ])
        .setup(|app| {
            let config = app.config().app.windows[0].clone();
            tauri::WebviewWindowBuilder::from_config(app, &config)?
                .on_navigation(|url| local_url(url, "/editor.html"))
                .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
                .build()?;
            shell::setup(app)?;
            updates::setup(app.handle());
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(10)).await;
                if !handle.state::<RuntimeState>().ready.load(Ordering::SeqCst)
                    && !std::env::args().any(|arg| arg == "--autostart" || arg == "--smoke")
                {
                    shell::show_window(&handle);
                }
            });
            // Startup never reads clipboard body. Preserve caches referenced by native fragments.
            // Windows HTML can still reference old PNG paths without a private
            // marker. Its cleanup runs only after a successful explicit copy.
            #[cfg(not(windows))]
            if let Ok(directory) = image_directory(app.handle()) {
                tauri::async_runtime::spawn_blocking(move || {
                    if matches!(clipboard::has_private(), Ok(false)) {
                        let _ = clipboard::prune(&directory);
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("无法启动 md2chat")
        .run(|app, event| match event {
            #[cfg(target_os = "macos")]
            tauri::RunEvent::Reopen { .. } => shell::show_window(app),
            _ => {}
        });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn local_command_origin_rejects_other_pages_and_remote_hosts() {
        assert!(local_url(
            &url::Url::parse("tauri://localhost/editor.html").unwrap(),
            "/editor.html"
        ));
        assert!(local_url(
            &url::Url::parse("http://tauri.localhost/editor.html").unwrap(),
            "/editor.html"
        ));
        for url in [
            "https://example.com/editor.html",
            "tauri://localhost/preferences.html",
            "https://tauri.localhost.evil/editor.html",
            "file:///editor.html",
        ] {
            assert!(!local_url(&url::Url::parse(url).unwrap(), "/editor.html"));
        }
    }
}
