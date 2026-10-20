mod cache;
mod native;
mod payload;
mod summary;
use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    path::Path,
    sync::{Mutex, MutexGuard},
};
static CLIPBOARD: Mutex<()> = Mutex::new(());
#[cfg(windows)]
pub use native::register_app_owner;
pub use native::CHANGED;
fn lock() -> Result<MutexGuard<'static, ()>, String> {
    CLIPBOARD
        .lock()
        .map_err(|_| "剪贴板操作不可用，请重新打开 md2chat。".into())
}

pub fn copy(parts: Vec<Value>, target: &str, directory: &Path) -> Result<Value, String> {
    let _lock = lock()?;
    copy_inner(parts, target, directory, None)
}
pub fn copy_guarded(
    parts: Vec<Value>,
    target: &str,
    directory: &Path,
    expected_fingerprint: &str,
) -> Result<Value, String> {
    let _lock = lock()?;
    copy_inner(parts, target, directory, Some(expected_fingerprint))
}
fn copy_inner(
    parts: Vec<Value>,
    target: &str,
    directory: &Path,
    expected: Option<&str>,
) -> Result<Value, String> {
    #[cfg(target_os = "macos")]
    let wecom_formats = if target == "wecom" { native::wecom_formats(&parts)? } else { Vec::new() };
    let payload = payload::build(
        parts,
        target,
        directory,
        cfg!(windows),
        cfg!(target_os = "macos"),
    )?;
    let mut formats = vec![
        ("text/plain".into(), payload.plain.into_bytes()),
        ("text/html".into(), payload.html.into_bytes()),
    ];
    #[cfg(target_os = "macos")]
    formats.extend(wecom_formats);
    let native = cfg!(target_os = "macos") && target == "dingtalk";
    let feishu_native = cfg!(any(target_os = "macos", windows)) && target == "feishu";
    if native {
        formats.push((
            payload::DINGTALK.into(),
            serde_json::to_vec(&payload.rich).map_err(|_| "钉钉图文编码失败")?,
        ));
    }
    if feishu_native {
        formats.push((
            payload::FEISHU.into(),
            payload::encode_feishu(&payload.fragment)?,
        ));
    }
    let sequence = expected
        .map(|fingerprint| check_fingerprint(directory, fingerprint))
        .transpose()?;
    native::write_checked(formats, sequence)?;
    // Prune only after replacing the previous clipboard, whose private fragments
    // may still refer to the cache. Current files have a fresh modification time.
    if feishu_native || (cfg!(windows) && target == "wecom") {
        let _ = cache::prune(directory);
    }
    Ok(
        json!({"images":payload.images,"native":native,"target":target,"windowsHtml":cfg!(windows)&&target=="dingtalk"&&payload.images>0,"feishuNative":feishu_native,"wecomNative":cfg!(target_os="macos")&&target=="wecom"}),
    )
}
pub fn copy_segment(segment: Value) -> Result<Value, String> {
    let _lock = lock()?;
    copy_segment_inner(segment, None)
}
pub fn change_count() -> Result<u64, String> {
    let _lock = lock()?;
    native::change_count()
}

enum SegmentGuard<'a> {
    Fingerprint(&'a Path, &'a str),
    Sequence(u64),
}

pub fn copy_image_checked(segment: Value, sequence: u64) -> Result<Value, String> {
    if segment["type"] != "image" {
        return Err("转图片未生成完整 PNG，请重试。".into());
    }
    let _lock = lock()?;
    copy_segment_inner(segment, Some(SegmentGuard::Sequence(sequence)))
}
pub fn copy_segment_guarded(
    segment: Value,
    directory: &Path,
    expected_fingerprint: &str,
) -> Result<Value, String> {
    let _lock = lock()?;
    copy_segment_inner(
        segment,
        Some(SegmentGuard::Fingerprint(directory, expected_fingerprint)),
    )
}
fn check_fingerprint(directory: &Path, expected: &str) -> Result<u64, String> {
    let snapshot = native::read()?;
    let sequence = snapshot.sequence;
    let current = source(snapshot, directory)?;
    if current["fingerprint"].as_str() != Some(expected) {
        return Err(native::CHANGED.into());
    }
    Ok(sequence)
}
fn copy_segment_inner(segment: Value, guard: Option<SegmentGuard<'_>>) -> Result<Value, String> {
    let (kind, formats) = if segment["type"] == "text" {
        let text = segment["text"].as_str().ok_or("内容格式错误")?;
        if text.len() > 2 * 1024 * 1024 {
            return Err("文字过长".into());
        }
        (
            "text",
            vec![("text/plain".into(), text.as_bytes().to_vec())],
        )
    } else if segment["type"] == "image" {
        let (png, _, _) =
            crate::images::normalized_png(segment["src"].as_str().ok_or("图片格式错误")?)?;
        ("image", vec![("image/png".into(), png)])
    } else {
        return Err("不支持的内容类型".into());
    };
    let sequence = match guard {
        Some(SegmentGuard::Fingerprint(directory, expected)) => {
            Some(check_fingerprint(directory, expected)?)
        }
        Some(SegmentGuard::Sequence(sequence)) => Some(sequence),
        None => None,
    };
    native::write_checked(formats, sequence)?;
    Ok(json!({"type":kind}))
}
pub fn read_source(directory: &Path) -> Result<Value, String> {
    let _lock = lock()?;
    source(native::read()?, directory)
}
fn source(snapshot: native::Snapshot, directory: &Path) -> Result<Value, String> {
    let mut hash = Sha256::new();
    hash.update(snapshot.sequence.to_le_bytes());
    let mut content = Vec::new();
    let mut total = 0;
    for item in snapshot.items {
        let mut names = item
            .iter()
            .map(|format| format.name.as_str())
            .collect::<Vec<_>>();
        names.sort();
        hash.update(serde_json::to_vec(&names).map_err(|_| "剪贴板格式错误")?);
        let image_type = [
            "image/png",
            "image/jpeg",
            "image/webp",
            "image/gif",
            "image/bmp",
            "image/tiff",
        ]
        .into_iter()
        .find(|name| item.iter().any(|f| f.name == *name));
        if image_type.is_none()
            && item.iter().any(|f| f.name == "text/uri-list")
            && item
                .iter()
                .any(|f| f.name.contains("WWKPrivatePBDataKey_Rich"))
        {
            return Err("这份企微剪贴板中的图片只有文件引用，无法直接转换。请复制 Markdown，或单独复制图片本身后重试。".into());
        }
        let mut entry = json!({"plain":"","html":"","images":[]});
        for name in [Some("text/plain"), Some("text/html"), image_type]
            .into_iter()
            .flatten()
        {
            let Some(format) = item
                .iter()
                .find(|f| f.name == name && f.bytes.is_some())
                .or_else(|| item.iter().find(|f| f.name == name))
            else {
                continue;
            };
            let bytes = format
                .bytes
                .as_ref()
                .ok_or("无法读取剪贴板内容，请重新复制。")?;
            total += bytes.len();
            if total > payload::MAX_TOTAL {
                return Err("剪贴板图文过大，请分段转换。".into());
            }
            // Embedded image data counts toward MAX_TOTAL, not the plain-text
            // limit. Windows DingTalk carries PNGs in both HTML representations.
            if name == "text/plain" && bytes.len() > payload::MAX_TEXT {
                return Err("剪贴板文字过长，请分段转换。".into());
            }
            if name.starts_with("image/")
                && name != "image/tiff"
                && bytes.len() > crate::images::MAX_IMAGE_BYTES
            {
                return Err("单张图片不能超过 10 MB。".into());
            }
            hash.update(serde_json::to_vec(&(name, bytes.len())).unwrap());
            hash.update(bytes);
            if name == "text/plain" {
                entry["plain"] = json!(String::from_utf8_lossy(bytes));
            } else if name == "text/html" {
                entry["html"] = json!(cache::resolve_with(
                    &String::from_utf8_lossy(bytes),
                    directory,
                    |bytes, filename| {
                        total += bytes.len();
                        if total > payload::MAX_TOTAL {
                            return Err("剪贴板图文过大，请分段转换。".into());
                        }
                        hash.update(
                            serde_json::to_vec(&("cached-image", filename, bytes.len())).unwrap(),
                        );
                        hash.update(bytes);
                        Ok(())
                    }
                )?);
            } else {
                let (mime, bytes) = if name == "image/tiff" {
                    let image = crate::images::decode_image(bytes)?;
                    ("image/png", crate::images::encode_png(&image)?)
                } else {
                    crate::images::decode_image(bytes)?;
                    (name, bytes.clone())
                };
                if bytes.len() > crate::images::MAX_IMAGE_BYTES {
                    return Err("单张图片不能超过 10 MB。".into());
                }
                entry["images"] = json!([format!("data:{mime};base64,{}", STANDARD.encode(bytes))]);
            }
        }
        content.push(entry);
    }
    Ok(json!({"content":content,"fingerprint":format!("{:x}",hash.finalize())}))
}
pub fn resolve_html(html: &str, directory: &Path) -> Result<String, String> {
    cache::resolve_with(html, directory, |_, _| Ok(()))
}
pub fn has_private() -> Result<bool, String> {
    let _lock = lock()?;
    native::has_private()
}
pub fn prune(directory: &Path) -> Result<(), String> {
    let _lock = lock()?;
    if native::has_private()? {
        return Ok(());
    }
    cache::prune(directory)
}
pub fn inspect(version: &str) -> Result<Value, String> {
    let _lock = lock()?;
    let (sequence, formats) = native::diagnostic_read()?;
    Ok(diagnostic_report(version, sequence, formats))
}
fn diagnostic_report(version: &str, sequence: u64, formats: Vec<native::DiagnosticFormat>) -> Value {
    let entries = formats.into_iter().map(|format| {
        let mut entry = json!({"item":format.item,"type":format.name,"nativeType":format.native_name,"size":format.size});
        if let Some(error) = format.error { entry["error"] = json!(error); }
        if let Some(bytes) = format.bytes {
            entry["base64"] = json!(STANDARD.encode(&bytes));
            // Raw bytes always survive, even when decoding fails (e.g. malformed CF_HTML).
            let text = if entry["nativeType"].as_str().unwrap_or("").starts_with("CF_UNICODETEXT ") {
                let units = bytes.chunks_exact(2).map(|s| u16::from_le_bytes([s[0],s[1]])).take_while(|u| *u != 0).collect::<Vec<_>>();
                if bytes.len() % 2 != 0 { None } else { String::from_utf16(&units).ok() }
            } else {
                String::from_utf8(bytes.clone()).ok().filter(|text| !text.contains('\0') || entry["type"] == "text/html").map(|text| text.trim_end_matches('\0').to_owned())
            };
            if let Some(text) = text { entry["text"] = json!(text); }
            #[cfg(windows)]
            if entry["type"] == "text/html" {
                match native::parse_cf_html(&bytes).and_then(|bytes| String::from_utf8(bytes).map_err(|_| "HTML 文字编码无效".into())) {
                    Ok(html) => { entry["html"] = json!(html); }
                    Err(error) => { entry["parseError"] = json!(error); }
                }
            }
        }
        entry
    }).collect::<Vec<_>>();
    json!({"version":version,"platform":if cfg!(target_os="macos"){"darwin"}else if cfg!(windows){"win32"}else{std::env::consts::OS},"sequence":sequence,"entries":entries})
}
pub fn test_dingtalk_html(mode: &str) -> Result<Value, String> {
    let _lock = lock()?;
    if !cfg!(windows) {
        return Err("此项 HTML 测试仅适用于 Windows 桌面版。".into());
    }
    if !["text", "rewrite"].contains(&mode) {
        return Err("不支持的 HTML 测试模式。".into());
    }
    let original = if mode == "rewrite" {
        Some(native::read()?)
    } else {
        None
    };
    let html = if let Some(snapshot) = &original {
        let formats = snapshot
            .items
            .iter()
            .flatten()
            .filter(|f| f.name == "text/html")
            .collect::<Vec<_>>();
        if formats.len() != 1 {
            return Err("当前剪贴板需要恰好一份 HTML，请先从钉钉复制一条图文。".into());
        }
        let bytes = formats[0].bytes.as_ref().ok_or("无法读取剪贴板 HTML。")?;
        if bytes.len() > payload::MAX_TEXT {
            return Err("HTML 超过 8 MiB，请复制更短的图文后再试。".into());
        }
        String::from_utf8(bytes.clone()).map_err(|_| "剪贴板 HTML 编码无效")?
    } else {
        "<article><p><strong>md2chat HTML 文字测试</strong></p></article>".into()
    };
    let sequence = original.map(|snapshot| snapshot.sequence);
    let summary = summary::html(&html);
    native::write_checked(
        vec![("text/html".into(), html.as_bytes().to_vec())],
        sequence,
    )?;
    Ok(
        json!({"mode":mode,"bytes":html.len(),"htmlImages":summary["imageCount"],"htmlTables":summary["tableCount"],"truncated":summary["truncated"]}),
    )
}

#[cfg(test)]
fn roundtrip_formats() -> Vec<(String, Vec<u8>)> {
    let mut png = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(2, 3)
        .write_to(&mut png, image::ImageFormat::Png)
        .unwrap();
    let mut formats = vec![
        ("text/plain".into(), "原生剪贴板测试😀".as_bytes().to_vec()),
        (
            "text/html".into(),
            "<p>原生测试<strong>😀</strong></p>".as_bytes().to_vec(),
        ),
        ("image/png".into(), png.into_inner()),
    ];
    // Read chat formats back without accepting generic HTML as a native write.
    #[cfg(target_os = "macos")]
    {
        formats.push((payload::DINGTALK.into(),json!({"contents":[{"type":"markdown","text":{"items":[{"type":"text","data":{"text":"test"}}]}}]}).to_string().into_bytes()));
    }
    #[cfg(any(target_os = "macos", windows))]
    {
        formats.push((
            payload::FEISHU.into(),
            payload::encode_feishu(&json!({"deltas":{"0":{"ops":[{"insert":"中文😀"}]}}})).unwrap(),
        ));
    }
    formats
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostics_preserve_unknown_formats_raw_cf_html_and_failed_entries() {
        let report = diagnostic_report("test", 42, vec![
            native::DiagnosticFormat { item: 2, name: "text/html".into(), native_name: "HTML Format (ID 49000)".into(), size: Some(5), bytes: Some(b"<p>x\0".to_vec()), error: None },
            native::DiagnosticFormat { item: 2, name: "private/custom".into(), native_name: "com.private/custom".into(), size: Some(3), bytes: Some(vec![0, 255, 128]), error: None },
            native::DiagnosticFormat { item: 2, name: "CF_BITMAP".into(), native_name: "CF_BITMAP (ID 2)".into(), size: None, bytes: None, error: Some("object handle".into()) },
            native::DiagnosticFormat { item: 3, name: "text/plain".into(), native_name: "CF_UNICODETEXT (ID 13)".into(), size: Some(4), bytes: Some(vec![0x2d, 0x4e, 0, 0]), error: None },
        ]);
        assert_eq!(report["sequence"], 42);
        assert_eq!(report["entries"][0]["item"], 2);
        let bytes = STANDARD.decode(report["entries"][0]["base64"].as_str().unwrap()).unwrap();
        assert_eq!(bytes, b"<p>x\0");
        assert_eq!(report["entries"][1]["type"], "private/custom");
        assert_eq!(report["entries"][1]["nativeType"], "com.private/custom");
        assert_eq!(STANDARD.decode(report["entries"][1]["base64"].as_str().unwrap()).unwrap(), vec![0, 255, 128]);
        assert_eq!(report["entries"][2]["error"], "object handle");
        assert!(report["entries"][2].get("base64").is_none());
        assert_eq!(report["entries"][3]["text"], "中");
    }
    #[test]
    fn fingerprint_changes_with_sequence() {
        let make = |sequence| native::Snapshot {
            items: vec![vec![native::Format {
                name: "text/plain".into(),
                size: 1,
                bytes: Some(b"a".to_vec()),
            }]],
            sequence,
        };
        let dir = std::env::temp_dir();
        let a = source(make(1), &dir).unwrap();
        let b = source(make(2), &dir).unwrap();
        assert_ne!(a["fingerprint"], b["fingerprint"]);
        assert_eq!(a["content"][0]["plain"], "a");
    }
    #[test]
    fn source_rejects_large_text() {
        let snapshot = native::Snapshot {
            items: vec![vec![native::Format {
                name: "text/plain".into(),
                size: payload::MAX_TEXT + 1,
                bytes: Some(vec![0; payload::MAX_TEXT + 1]),
            }]],
            sequence: 1,
        };
        assert!(source(snapshot, &std::env::temp_dir()).is_err());
    }
    #[test]
    fn windows_dingtalk_large_image_can_be_read_back() {
        let mut state = 1u32;
        let pixels = (0..1024 * 1024 * 4)
            .map(|_| {
                state ^= state << 13;
                state ^= state >> 17;
                state ^= state << 5;
                state as u8
            })
            .collect::<Vec<_>>();
        let image = image::DynamicImage::ImageRgba8(
            image::RgbaImage::from_raw(1024, 1024, pixels).unwrap(),
        );
        let png = crate::images::encode_png(&image).unwrap();
        assert!(png.len() < crate::images::MAX_IMAGE_BYTES);
        let src = format!("data:image/png;base64,{}", STANDARD.encode(png));
        let payload = payload::build(
            vec![json!({"type":"image","src":src})],
            "dingtalk",
            &std::env::temp_dir(),
            true,
            false,
        )
        .unwrap();
        assert!(payload.html.len() > payload::MAX_TEXT);
        let snapshot = native::Snapshot {
            items: vec![vec![native::Format {
                name: "text/html".into(),
                size: payload.html.len(),
                bytes: Some(payload.html.as_bytes().to_vec()),
            }]],
            sequence: 1,
        };
        let read = source(snapshot, &std::env::temp_dir()).unwrap();
        assert_eq!(read["content"][0]["html"], payload.html);
    }
    /// Run only on an isolated runner, or explicitly with a restorable clipboard.
    /// This proves native bytes round trip; chat-client paste acceptance is separate.
    #[test]
    #[ignore = "explicit native clipboard integration test; backs up and restores the original native formats"]
    #[cfg(any(target_os = "macos", windows))]
    fn native_roundtrip() {
        let _lock = lock().unwrap();
        native::native_roundtrip().unwrap();
    }
}
