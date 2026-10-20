//! WeCom imports an AppKit attributed string when BOTH RTF and flat RTFD are
//! offered. RTFD alone is ignored in the tested client. Do not synthesize its
//! private message protobuf or copy account IDs / process-local object pointers.
use super::{class, ns_string, send0, send1, send2, Id, Pool};
use serde_json::Value;

#[repr(C)]
#[derive(Clone, Copy)]
struct Range {
    location: usize,
    length: usize,
}
#[repr(C)]
#[derive(Clone, Copy)]
struct Size {
    width: f64,
    height: f64,
}

unsafe fn owned(value: Id) -> Result<Id, String> {
    if value.is_null() {
        return Err("内容格式错误".into());
    }
    unsafe {
        send0::<Id>(value, "autorelease");
    }
    Ok(value)
}
unsafe fn append_text(target: Id, text: &str, run: &Value) -> Result<(), String> {
    unsafe {
        let attrs: Id = send0(class("NSMutableDictionary"), "dictionary");
        let font: Id = send1(class("NSFont"), "systemFontOfSize:", 14f64);
        let manager: Id = send0(class("NSFontManager"), "sharedFontManager");
        let traits = usize::from(run["bold"] == true) * 2 | usize::from(run["italic"] == true);
        let font: Id = if traits > 0 {
            send2(manager, "convertFont:toHaveTrait:", font, traits)
        } else {
            font
        };
        send2::<_, _, ()>(attrs, "setObject:forKey:", font, ns_string("NSFont")?);
        if run["strikethrough"] == true {
            let one: Id = send1(class("NSNumber"), "numberWithInteger:", 1isize);
            send2::<_, _, ()>(
                attrs,
                "setObject:forKey:",
                one,
                ns_string("NSStrikethrough")?,
            );
        }
        let value: Id = send0(class("NSAttributedString"), "alloc");
        let value = owned(send2(
            value,
            "initWithString:attributes:",
            ns_string(text)?,
            attrs,
        ))?;
        send1::<_, ()>(target, "appendAttributedString:", value);
        Ok(())
    }
}
unsafe fn data_bytes(data: Id) -> Result<Vec<u8>, String> {
    unsafe {
        if data.is_null() {
            return Err("内容格式错误".into());
        }
        let length: usize = send0(data, "length");
        if length == 0 || length > super::super::DIAGNOSTIC_MAX {
            return Err("图文过大，请减少图片后重试".into());
        }
        let bytes: *const u8 = send0(data, "bytes");
        if bytes.is_null() {
            return Err("内容格式错误".into());
        }
        Ok(std::slice::from_raw_parts(bytes, length).to_vec())
    }
}

/// Builds formats without touching the pasteboard; callers retain their lock
/// and check the clipboard sequence immediately before the final atomic write.
pub fn wecom_formats(parts: &[Value]) -> Result<Vec<(String, Vec<u8>)>, String> {
    use super::super::super::payload::{MAX_TEXT, MAX_TOTAL};
    if parts.is_empty() || parts.len() > 500 {
        return Err("内容为空或段落过多".into());
    }
    let _pool = Pool::new();
    unsafe {
        let allocated: Id = send0(class("NSMutableAttributedString"), "alloc");
        let target = owned(send1(allocated, "initWithString:", ns_string("")?))?;
        let mut total = 0usize;
        for (index, part) in parts.iter().enumerate() {
            if index > 0 {
                append_text(target, "\n", &Value::Null)?;
            }
            match part["type"].as_str() {
                Some("text") => {
                    let text = part["text"].as_str().ok_or("内容格式错误")?;
                    if text.encode_utf16().count() > 2 * 1024 * 1024 {
                        return Err("文字过长".into());
                    }
                    total = total.saturating_add(text.len());
                    if total > MAX_TOTAL {
                        return Err("图文过大，请减少图片后重试".into());
                    }
                    if let Some(runs) = part["runs"].as_array().filter(|runs| {
                        runs.len() < 10000
                            && runs.iter().all(|r| r["text"].is_string())
                            && runs
                                .iter()
                                .map(|r| r["text"].as_str().unwrap())
                                .collect::<String>()
                                == text
                    }) {
                        for run in runs {
                            append_text(target, run["text"].as_str().unwrap(), run)?;
                        }
                    } else {
                        append_text(target, text, &Value::Null)?;
                    }
                }
                Some("image") => {
                    let src = part["src"].as_str().ok_or("图片格式错误")?;
                    if src.len() > 15 * 1024 * 1024 {
                        return Err("图片必须小于 10 MB".into());
                    }
                    let (png, width, height) = crate::images::normalized_png(src)?;
                    total = total.saturating_add(png.len());
                    if total > MAX_TOTAL {
                        return Err("图文过大，请减少图片后重试".into());
                    }
                    let data: Id = send2(
                        class("NSData"),
                        "dataWithBytes:length:",
                        png.as_ptr(),
                        png.len(),
                    );
                    let requested = part["displayWidth"]
                        .as_f64()
                        .filter(|v| v.is_finite() && *v > 0.0)
                        .unwrap_or(width as f64);
                    let display = (width as f64).min(1100.0).min(requested.max(1.0));
                    // RTFD restores the PNG from its file wrapper. Changing only
                    // NSImage.size is lost on decode; persist the point size as
                    // PNG resolution metadata without reducing its pixel count.
                    let bitmap: Id = send1(class("NSBitmapImageRep"), "imageRepWithData:", data);
                    if bitmap.is_null() {
                        return Err("图片格式错误".into());
                    }
                    send1::<_, ()>(
                        bitmap,
                        "setSize:",
                        Size {
                            width: display,
                            height: (height as f64) * display / (width as f64),
                        },
                    );
                    let properties: Id = send0(class("NSDictionary"), "dictionary");
                    let data: Id = send2(
                        bitmap,
                        "representationUsingType:properties:",
                        4usize,
                        properties,
                    ); // NSBitmapImageFileTypePNG
                    let encoded = data_bytes(data)?;
                    total = total
                        .saturating_sub(png.len())
                        .saturating_add(encoded.len());
                    if total > MAX_TOTAL {
                        return Err("图文过大，请减少图片后重试".into());
                    }
                    let wrapper: Id = send0(class("NSFileWrapper"), "alloc");
                    let wrapper = owned(send1(wrapper, "initRegularFileWithContents:", data))?;
                    send1::<_, ()>(
                        wrapper,
                        "setPreferredFilename:",
                        ns_string(&format!("image-{index}.png"))?,
                    );
                    let attachment = owned(send0(class("NSTextAttachment"), "new"))?;
                    send1::<_, ()>(attachment, "setFileWrapper:", wrapper);
                    let cell: Id = send0(attachment, "attachmentCell");
                    if cell.is_null() {
                        return Err("图片格式错误".into());
                    }
                    let value: Id = send1(
                        class("NSAttributedString"),
                        "attributedStringWithAttachment:",
                        attachment,
                    );
                    send1::<_, ()>(target, "appendAttributedString:", value);
                }
                _ => return Err("不支持的内容类型".into()),
            }
        }
        let length: usize = send0(target, "length");
        if length > MAX_TEXT {
            return Err("图文过大，请减少图片后重试".into());
        }
        let range = Range {
            location: 0,
            length,
        };
        let attrs: Id = send0(class("NSDictionary"), "dictionary");
        let rtfd = data_bytes(send2(
            target,
            "RTFDFromRange:documentAttributes:",
            range,
            attrs,
        ))?;
        let rtf = data_bytes(send2(
            target,
            "RTFFromRange:documentAttributes:",
            range,
            attrs,
        ))?;
        if rtfd.len().saturating_add(rtf.len()) > MAX_TOTAL {
            return Err("图文过大，请减少图片后重试".into());
        }
        Ok(vec![
            ("public.rtf".into(), rtf),
            ("com.apple.flat-rtfd".into(), rtfd),
        ])
    }
}

#[cfg(test)]
mod tests {
    use super::super::send3;
    use super::*;
    use serde_json::json;
    #[test]
    fn wecom_rich_roundtrip_keeps_unicode_and_two_inline_images() {
        use base64::{engine::general_purpose::STANDARD, Engine};
        let png = crate::images::encode_png(&image::DynamicImage::new_rgba8(8, 4)).unwrap();
        let src = format!("data:image/png;base64,{}", STANDARD.encode(png));
        let formats = wecom_formats(&[
            json!({"type":"text","text":"前文😀\n第二行","runs":[{"text":"前文😀\n第二行","bold":true}]}),
            json!({"type":"image","src":src,"displayWidth":4}),
            json!({"type":"text","text":"中间"}),
            json!({"type":"image","src":src}),
            json!({"type":"text","text":"后文"}),
        ]).unwrap();
        assert_eq!(
            formats
                .iter()
                .map(|(name, _)| name.as_str())
                .collect::<Vec<_>>(),
            ["public.rtf", "com.apple.flat-rtfd"]
        );
        let _pool = Pool::new();
        unsafe {
            let bytes = &formats[1].1;
            let data: Id = send2(
                class("NSData"),
                "dataWithBytes:length:",
                bytes.as_ptr(),
                bytes.len(),
            );
            let value: Id = send0(class("NSAttributedString"), "alloc");
            let value = owned(send2(
                value,
                "initWithRTFD:documentAttributes:",
                data,
                std::ptr::null_mut::<Id>(),
            ))
            .unwrap();
            let text: Id = send0(value, "string");
            assert_eq!(
                super::super::string(text).unwrap(),
                "前文😀\n第二行\n\u{fffc}\n中间\n\u{fffc}\n后文"
            );
            // Each replacement character must carry a real PNG attachment, not a literal placeholder.
            let length: usize = send0(value, "length");
            let mut images = 0;
            for index in 0..length {
                let attachment: Id = send3(
                    value,
                    "attribute:atIndex:effectiveRange:",
                    ns_string("NSAttachment").unwrap(),
                    index,
                    std::ptr::null_mut::<Range>(),
                );
                if !attachment.is_null() {
                    let wrapper: Id = send0(attachment, "fileWrapper");
                    let data: Id = send0(wrapper, "regularFileContents");
                    let png = data_bytes(data).unwrap();
                    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n"));
                    let decoded = crate::images::decode_image(&png).unwrap();
                    assert_eq!((decoded.width(), decoded.height()), (8, 4));
                    let cell: Id = send0(attachment, "attachmentCell");
                    let size: Size = send0(cell, "cellSize");
                    assert_eq!(size.width, if images == 0 { 4.0 } else { 8.0 });
                    images += 1;
                }
            }
            assert_eq!(images, 2);
        }
    }
    #[test]
    fn wecom_rich_rejects_empty_invalid_and_oversized_content() {
        assert!(wecom_formats(&[]).is_err());
        assert!(
            wecom_formats(&[json!({"type":"image","src":"https://invalid/image.png"})]).is_err()
        );
        assert!(wecom_formats(&[json!({"type":"text","text":"x".repeat(2*1024*1024+1)})]).is_err());
    }
}
