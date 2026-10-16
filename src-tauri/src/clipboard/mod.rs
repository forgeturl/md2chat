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
    let native = cfg!(target_os = "macos") && target == "dingtalk";
    let feishu_native = cfg!(target_os = "macos") && target == "feishu";
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
    if cfg!(windows) && target == "dingtalk" || feishu_native {
        let _ = cache::prune(directory);
    }
    Ok(
        json!({"images":payload.images,"native":native,"target":target,"windowsHtml":cfg!(windows)&&target=="dingtalk"&&payload.images>0,"feishuNative":feishu_native}),
    )
}
pub fn copy_segment(segment: Value) -> Result<Value, String> {
    let _lock = lock()?;
    copy_segment_inner(segment, None)
}
pub fn copy_segment_guarded(
    segment: Value,
    directory: &Path,
    expected_fingerprint: &str,
) -> Result<Value, String> {
    let _lock = lock()?;
    copy_segment_inner(segment, Some((directory, expected_fingerprint)))
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
fn copy_segment_inner(segment: Value, guard: Option<(&Path, &str)>) -> Result<Value, String> {
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
    let sequence = guard
        .map(|(directory, expected)| check_fingerprint(directory, expected))
        .transpose()?;
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
            if name.starts_with("text/") && bytes.len() > payload::MAX_TEXT {
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
    let snapshot = native::read()?;
    let mac = cfg!(target_os = "macos");
    let mut report = json!({"platform":if mac{"darwin"}else if cfg!(windows){"win32"}else{std::env::consts::OS},"version":version,"formats":[],"html":[],"htmlImages":0,"htmlTables":0,"imageFormats":0,"macDingtalk":{"applicable":mac,"present":false,"images":if mac{json!(0)}else{Value::Null}},"truncated":false});
    let mut decoded = 0usize;
    for format in snapshot.items.iter().flatten() {
        if report["formats"].as_array().unwrap().len() >= 100 {
            report["truncated"] = json!(true);
            break;
        }
        let known = [
            "text/plain",
            "text/html",
            "text/rtf",
            "text/uri-list",
            "image/png",
            "image/jpeg",
            "image/gif",
            "image/webp",
            "image/bmp",
            "image/tiff",
            payload::DINGTALK,
            payload::FEISHU,
        ]
        .contains(&format.name.as_str());
        let mut info = json!({"type":if known{format.name.as_str()}else{"其他系统格式"},"bytes":if format.bytes.is_some(){json!(format.size)}else{Value::Null}});
        if format.name.starts_with("image/") {
            let n = report["imageFormats"].as_u64().unwrap() + 1;
            report["imageFormats"] = json!(n);
        }
        if format.name == payload::DINGTALK {
            report["macDingtalk"]["present"] = json!(true);
        }
        if format.name == "text/html" || mac && format.name == payload::DINGTALK {
            if decoded + format.size > payload::MAX_TEXT {
                info["skipped"] = json!(true);
                report["truncated"] = json!(true);
                if format.name == payload::DINGTALK {
                    report["macDingtalk"]["images"] = Value::Null;
                }
            } else if let Some(bytes) = &format.bytes {
                decoded += bytes.len();
                if format.name == "text/html" {
                    let summary = summary::html(&String::from_utf8_lossy(bytes));
                    let images = report["htmlImages"].as_u64().unwrap()
                        + summary["imageCount"].as_u64().unwrap();
                    let tables = report["htmlTables"].as_u64().unwrap()
                        + summary["tableCount"].as_u64().unwrap();
                    report["htmlImages"] = json!(images);
                    report["htmlTables"] = json!(tables);
                    if summary["truncated"] == true {
                        report["truncated"] = json!(true);
                    }
                    report["html"].as_array_mut().unwrap().push(summary);
                } else if let Ok(value) = serde_json::from_slice::<Value>(bytes) {
                    let count = value["contents"].as_array().map(|contents| {
                        contents
                            .iter()
                            .filter_map(|c| c["text"]["items"].as_array())
                            .flatten()
                            .filter(|p| p["type"] == "image")
                            .count()
                    });
                    if let Some(n) = count {
                        report["macDingtalk"]["images"] = json!(n);
                    } else {
                        info["unreadable"] = json!(true);
                        report["macDingtalk"]["images"] = Value::Null;
                    }
                } else {
                    info["unreadable"] = json!(true);
                    report["macDingtalk"]["images"] = Value::Null;
                }
            } else {
                info["unreadable"] = json!(true);
            }
        }
        report["formats"].as_array_mut().unwrap().push(info);
    }
    Ok(report)
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
    // The application writes these chat formats on macOS only. Read them back
    // without accepting a generic HTML fallback as a successful native write.
    #[cfg(target_os = "macos")]
    {
        formats.push((payload::DINGTALK.into(),json!({"contents":[{"type":"markdown","text":{"items":[{"type":"text","data":{"text":"test"}}]}}]}).to_string().into_bytes()));
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
