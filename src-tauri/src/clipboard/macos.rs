//! One NSPasteboardItem carries all representations, including native chat types.
//! AppKit pasteboard access is thread safe; every entry point owns an autorelease pool.
#[path = "macos_rich.rs"]
mod rich;
pub use rich::wecom_formats;
use super::{Format, Snapshot};
use std::ffi::{c_char, c_void, CString};
type Id = *mut c_void;
type Sel = *mut c_void;
#[link(name = "objc")]
unsafe extern "C" {
    fn objc_getClass(name: *const c_char) -> Id;
    fn sel_registerName(name: *const c_char) -> Sel;
    fn objc_msgSend();
}
#[link(name = "AppKit", kind = "framework")]
unsafe extern "C" {}
#[link(name = "Foundation", kind = "framework")]
unsafe extern "C" {}
unsafe fn class(name: &str) -> Id {
    let name = CString::new(name).unwrap();
    unsafe { objc_getClass(name.as_ptr()) }
}
unsafe fn selector(name: &str) -> Sel {
    let name = CString::new(name).unwrap();
    unsafe { sel_registerName(name.as_ptr()) }
}
unsafe fn send0<R>(obj: Id, name: &str) -> R {
    let address = objc_msgSend as *const ();
    let method: unsafe extern "C" fn(Id, Sel) -> R = unsafe { std::mem::transmute_copy(&address) };
    unsafe { method(obj, selector(name)) }
}
unsafe fn send1<A, R>(obj: Id, name: &str, a: A) -> R {
    let address = objc_msgSend as *const ();
    let method: unsafe extern "C" fn(Id, Sel, A) -> R =
        unsafe { std::mem::transmute_copy(&address) };
    unsafe { method(obj, selector(name), a) }
}
unsafe fn send2<A, B, R>(obj: Id, name: &str, a: A, b: B) -> R {
    let address = objc_msgSend as *const ();
    let method: unsafe extern "C" fn(Id, Sel, A, B) -> R =
        unsafe { std::mem::transmute_copy(&address) };
    unsafe { method(obj, selector(name), a, b) }
}
unsafe fn send3<A, B, C, R>(obj: Id, name: &str, a: A, b: B, c: C) -> R {
    let address = objc_msgSend as *const ();
    let method: unsafe extern "C" fn(Id, Sel, A, B, C) -> R =
        unsafe { std::mem::transmute_copy(&address) };
    unsafe { method(obj, selector(name), a, b, c) }
}
struct Pool(Id);
impl Pool {
    fn new() -> Self {
        Self(unsafe { send0(class("NSAutoreleasePool"), "new") })
    }
}
impl Drop for Pool {
    fn drop(&mut self) {
        unsafe { send0::<()>(self.0, "drain") }
    }
}
unsafe fn ns_string(value: &str) -> Result<Id, String> {
    let allocated: Id = unsafe { send0(class("NSString"), "alloc") };
    let value: Id = unsafe {
        send3(
            allocated,
            "initWithBytes:length:encoding:",
            value.as_ptr(),
            value.len(),
            4usize,
        )
    };
    if !value.is_null() {
        unsafe {
            send0::<Id>(value, "autorelease");
        }
    }
    if value.is_null() {
        Err("无法创建剪贴板格式。".into())
    } else {
        Ok(value)
    }
}
unsafe fn string(value: Id) -> Result<String, String> {
    let length: usize = unsafe { send1(value, "lengthOfBytesUsingEncoding:", 4usize) };
    if length > 8192 {
        return Err("剪贴板格式名称过长。".into());
    }
    let bytes: *const u8 = unsafe { send0(value, "UTF8String") };
    if bytes.is_null() {
        return Err("剪贴板格式名称无效。".into());
    }
    String::from_utf8(unsafe { std::slice::from_raw_parts(bytes, length) }.to_vec())
        .map_err(|_| "剪贴板格式名称无效。".into())
}
fn canonical(name: &str) -> &str {
    match name {
        "public.utf8-plain-text" | "public.text" | "NSStringPboardType" => "text/plain",
        "public.html" | "Apple HTML pasteboard type" => "text/html",
        "public.png" => "image/png",
        "public.tiff" => "image/tiff",
        "public.jpeg" => "image/jpeg",
        "com.compuserve.gif" => "image/gif",
        "public.file-url" => "text/uri-list",
        other => other,
    }
}
fn native(name: &str) -> &str {
    match name {
        "text/plain" => "public.utf8-plain-text",
        "text/html" => "public.html",
        "image/png" => "public.png",
        other => other,
    }
}
pub fn change_count() -> Result<u64, String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        if board.is_null() {
            return Err("系统剪贴板不可用。".into());
        }
        Ok(send0::<isize>(board, "changeCount") as u64)
    }
}

pub fn read() -> Result<Snapshot, String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        if board.is_null() {
            return Err("系统剪贴板不可用。".into());
        }
        let sequence: isize = send0(board, "changeCount");
        let objects: Id = send0(board, "pasteboardItems");
        let count: usize = if objects.is_null() {
            0
        } else {
            send0(objects, "count")
        };
        if count > 500 {
            return Err("剪贴板内容过多，请分段转换。".into());
        }
        let mut items = Vec::new();
        let mut total = 0;
        for index in 0..count {
            let item: Id = send1(objects, "objectAtIndex:", index);
            let types: Id = send0(item, "types");
            let type_count: usize = send0(types, "count");
            if type_count > 500 {
                return Err("剪贴板格式过多。".into());
            }
            let mut descriptors = Vec::new();
            for type_index in 0..type_count {
                let kind: Id = send1(types, "objectAtIndex:", type_index);
                let name = string(kind)?;
                descriptors.push((kind, canonical(&name).to_owned()));
            }
            let preferred_image = [
                "image/png",
                "image/jpeg",
                "image/webp",
                "image/gif",
                "image/bmp",
                "image/tiff",
            ]
            .into_iter()
            .find(|name| descriptors.iter().any(|(_, kind)| kind == name));
            let mut formats = Vec::new();
            let mut copied = std::collections::HashSet::new();
            for (kind, name) in descriptors {
                if !super::readable(&name)
                    || name.starts_with("image/") && preferred_image != Some(name.as_str())
                    || !copied.insert(name.clone())
                {
                    formats.push(Format {
                        name,
                        size: 0,
                        bytes: None,
                    });
                    continue;
                }
                let data: Id = send1(item, "dataForType:", kind);
                if data.is_null() {
                    formats.push(Format {
                        name,
                        size: 0,
                        bytes: None,
                    });
                    continue;
                }
                let size: usize = send0(data, "length");
                total += size;
                if size > 60 * 1024 * 1024 || total > 60 * 1024 * 1024 {
                    return Err("剪贴板图文过大，请分段转换。".into());
                }
                let bytes: *const u8 = send0(data, "bytes");
                let bytes = if size == 0 {
                    Some(Vec::new())
                } else if bytes.is_null() {
                    None
                } else {
                    Some(std::slice::from_raw_parts(bytes, size).to_vec())
                };
                formats.push(Format { name, size, bytes });
            }
            items.push(formats);
        }
        let after: isize = send0(board, "changeCount");
        if after != sequence {
            return Err("读取期间剪贴板已更新，请重试。".into());
        }
        Ok(Snapshot {
            items,
            sequence: sequence as u64,
        })
    }
}
pub fn diagnostic_read() -> Result<(u64, Vec<super::DiagnosticFormat>), String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        if board.is_null() { return Err("系统剪贴板不可用。".into()); }
        let sequence: isize = send0(board, "changeCount");
        let objects: Id = send0(board, "pasteboardItems");
        let count: usize = if objects.is_null() { 0 } else { send0(objects, "count") };
        let mut out = Vec::new();
        let mut total = 0usize;
        // Fail explicitly rather than silently omitting items/formats.
        if count > super::DIAGNOSTIC_FORMATS { return Err("剪贴板项目超过 1000，请缩小样本。".into()); }
        for index in 0..count {
            let item: Id = send1(objects, "objectAtIndex:", index);
            let types: Id = send0(item, "types");
            let type_count: usize = send0(types, "count");
            if out.len() + type_count > super::DIAGNOSTIC_FORMATS { return Err("剪贴板格式超过 1000，请缩小样本。".into()); }
            for type_index in 0..type_count {
                let kind: Id = send1(types, "objectAtIndex:", type_index);
                let native_name = string(kind)?;
                let mut entry = super::DiagnosticFormat { item: index, name: canonical(&native_name).into(), native_name, size: None, bytes: None, error: None };
                let data: Id = send1(item, "dataForType:", kind);
                if data.is_null() {
                    entry.error = Some("系统未提供此格式的数据".into());
                } else {
                    let size: usize = send0(data, "length");
                    entry.size = Some(size);
                    if size > super::DIAGNOSTIC_MAX.saturating_sub(total) {
                        entry.error = Some("超过单次采集 60 MiB 限额，未采集此格式".into());
                    } else {
                        let pointer: *const u8 = send0(data, "bytes");
                        if size > 0 && pointer.is_null() { entry.error = Some("数据不可读".into()); }
                        else { entry.bytes = Some(if size == 0 { Vec::new() } else { std::slice::from_raw_parts(pointer, size).to_vec() }); total += size; }
                    }
                }
                out.push(entry);
            }
        }
        if send0::<isize>(board, "changeCount") != sequence { return Err("读取期间剪贴板已更新，请重试。".into()); }
        Ok((sequence as u64, out))
    }
}

pub fn write_checked(formats: Vec<(String, Vec<u8>)>, sequence: Option<u64>) -> Result<(), String> {
    write_items(vec![formats], sequence, false).map(|_| ())
}
fn write_items(
    items: Vec<Vec<(String, Vec<u8>)>>,
    sequence: Option<u64>,
    raw: bool,
) -> Result<u64, String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        if board.is_null() {
            return Err("系统剪贴板不可用。".into());
        }
        let array: Id = send0(class("NSMutableArray"), "array");
        for formats in &items {
            let item: Id = send0(class("NSPasteboardItem"), "new");
            if item.is_null() {
                return Err("无法准备剪贴板项目。".into());
            }
            let result = (|| {
                for (name, bytes) in formats {
                    let kind = ns_string(if raw { name } else { native(name) })?;
                    let data: Id = send2(
                        class("NSData"),
                        "dataWithBytes:length:",
                        bytes.as_ptr(),
                        bytes.len(),
                    );
                    let success: i8 = send2(item, "setData:forType:", data, kind);
                    if success == 0 {
                        return Err("无法准备剪贴板格式。".to_string());
                    }
                }
                send1::<Id, ()>(array, "addObject:", item);
                Ok(())
            })();
            send0::<()>(item, "release");
            result?;
        }
        if sequence.is_some_and(|expected| send0::<isize>(board, "changeCount") as u64 != expected)
        {
            return Err(super::CHANGED.into());
        }
        send0::<isize>(board, "clearContents");
        if !items.is_empty() {
            let success: i8 = send1(board, "writeObjects:", array);
            if success == 0 {
                return Err("无法写入系统剪贴板。".into());
            }
        }
        let written_sequence = send0::<isize>(board, "changeCount") as u64;
        for formats in &items {
            for (name, _) in formats {
                let kind = ns_string(if raw { name } else { native(name) })?;
                let data: Id = send1(board, "dataForType:", kind);
                if data.is_null() {
                    return Err("系统未保留所需的剪贴板格式。".into());
                }
            }
        }
        if send0::<isize>(board, "changeCount") as u64 != written_sequence {
            return Err(super::CHANGED.into());
        }
        Ok(written_sequence)
    }
}
#[cfg(test)]
fn backup_all() -> Result<Vec<Vec<(String, Vec<u8>)>>, String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        let sequence: isize = send0(board, "changeCount");
        let objects: Id = send0(board, "pasteboardItems");
        let count: usize = if objects.is_null() {
            0
        } else {
            send0(objects, "count")
        };
        if count > 500 {
            return Err("Cannot safely back up this many clipboard items".into());
        }
        let mut out = Vec::new();
        let mut total = 0usize;
        for index in 0..count {
            let item: Id = send1(objects, "objectAtIndex:", index);
            let types: Id = send0(item, "types");
            let count: usize = send0(types, "count");
            if count > 500 {
                return Err("Cannot safely back up this many clipboard formats".into());
            }
            let mut formats = Vec::new();
            for index in 0..count {
                let kind: Id = send1(types, "objectAtIndex:", index);
                let name = string(kind)?;
                let data: Id = send1(item, "dataForType:", kind);
                if data.is_null() {
                    return Err("Clipboard contains a format that cannot be restored; native test was not run".into());
                }
                let size: usize = send0(data, "length");
                total = total.checked_add(size).ok_or("Clipboard backup overflow")?;
                if total > 60 * 1024 * 1024 {
                    return Err(
                        "Clipboard too large to safely back up; native test was not run".into(),
                    );
                }
                let pointer: *const u8 = send0(data, "bytes");
                if size > 0 && pointer.is_null() {
                    return Err("Clipboard data unavailable; native test was not run".into());
                }
                let bytes = if size == 0 {
                    Vec::new()
                } else {
                    std::slice::from_raw_parts(pointer, size).to_vec()
                };
                formats.push((name, bytes));
            }
            out.push(formats);
        }
        if send0::<isize>(board, "changeCount") != sequence {
            return Err("Clipboard changed during backup; native test was not run".into());
        }
        Ok(out)
    }
}
#[cfg(test)]
pub fn native_roundtrip() -> Result<(), String> {
    let original = backup_all()?;
    let test = super::super::roundtrip_formats();
    let mut owned_sequence = None;
    let result = (|| {
        owned_sequence = Some(write_items(vec![test.clone()], None, false)?);
        let snapshot = read()?;
        if snapshot.items.len() != 1 {
            return Err("Native write did not retain a single item".into());
        }
        for (name, expected) in test {
            let actual = snapshot.items[0]
                .iter()
                .find(|f| f.name == name)
                .and_then(|f| f.bytes.as_ref())
                .ok_or("Missing native clipboard format")?;
            if actual != &expected {
                return Err(format!("Native bytes differ for {name}"));
            }
        }
        let sequence = read()?.sequence;
        if write_checked(
            vec![("text/plain".into(), b"must not overwrite".to_vec())],
            Some(sequence.wrapping_sub(1)),
        )
        .is_ok()
        {
            return Err("Stale sequence did not preserve clipboard".into());
        }
        let current = read()?;
        if current.sequence != sequence {
            return Err("Rejected write changed the clipboard".into());
        }
        Ok(())
    })();
    if let Some(sequence) = owned_sequence {
        write_items(original.clone(), Some(sequence), true)
            .map_err(|_| "Clipboard changed during native test, or original clipboard could not be restored; newer content was preserved".to_string())?;
    } else {
        return result;
    }
    if backup_all()? != original {
        return Err("Original clipboard formats/bytes did not restore exactly".into());
    }
    result
}

/// Startup cleanup consults types only, never materializes clipboard bodies.
pub fn has_private() -> Result<bool, String> {
    let _pool = Pool::new();
    unsafe {
        let board: Id = send0(class("NSPasteboard"), "generalPasteboard");
        if board.is_null() {
            return Err("系统剪贴板不可用。".into());
        }
        let types: Id = send0(board, "types");
        if types.is_null() {
            return Ok(false);
        }
        let count: usize = send0(types, "count");
        if count > 500 {
            return Err("剪贴板格式过多。".into());
        }
        for index in 0..count {
            let kind: Id = send1(types, "objectAtIndex:", index);
            let name = string(kind)?;
            if name == super::super::payload::DINGTALK || name == super::super::payload::FEISHU {
                return Ok(true);
            }
        }
        Ok(false)
    }
}
