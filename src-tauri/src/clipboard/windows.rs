//! Native Windows clipboard formats. SetClipboardData transfers each allocation
//! to the OS; all formats are installed during one open/empty/close transaction.
use super::{Format, Snapshot};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::{ffi::c_void, ptr, thread, time::Duration};
type Handle = *mut c_void;
type Hwnd = *mut c_void;
const CF_UNICODETEXT: u32 = 13;
const CF_DIB: u32 = 8;
const CF_DIBV5: u32 = 17;
const GMEM_MOVEABLE: u32 = 0x0042;
#[link(name = "user32")]
unsafe extern "system" {
    fn OpenClipboard(owner: Hwnd) -> i32;
    fn CloseClipboard() -> i32;
    fn EmptyClipboard() -> i32;
    fn SetClipboardData(format: u32, data: Handle) -> Handle;
    fn GetClipboardData(format: u32) -> Handle;
    fn EnumClipboardFormats(format: u32) -> u32;
    fn RegisterClipboardFormatW(name: *const u16) -> u32;
    fn GetClipboardFormatNameW(format: u32, name: *mut u16, max: i32) -> i32;
    fn GetClipboardSequenceNumber() -> u32;
    #[cfg(test)]
    fn GetClipboardOwner() -> Hwnd;
    fn IsWindow(window: Hwnd) -> i32;
    fn CreateWindowExW(
        style: u32,
        class: *const u16,
        name: *const u16,
        window_style: u32,
        x: i32,
        y: i32,
        width: i32,
        height: i32,
        parent: Hwnd,
        menu: Handle,
        instance: Handle,
        param: *const c_void,
    ) -> Hwnd;
    fn DestroyWindow(window: Hwnd) -> i32;
}
#[link(name = "kernel32")]
unsafe extern "system" {
    fn GlobalAlloc(flags: u32, bytes: usize) -> Handle;
    fn GlobalLock(memory: Handle) -> *mut c_void;
    fn GlobalUnlock(memory: Handle) -> i32;
    fn GlobalSize(memory: Handle) -> usize;
    fn GlobalFree(memory: Handle) -> Handle;
}
// HWND wraps a raw pointer and is not Send/Sync. Store only its pointer-sized
// value; the Tauri window manager keeps the registered main window alive.
static APP_OWNER: AtomicUsize = AtomicUsize::new(0);
pub fn register_app_owner(window: usize) -> Result<(), String> {
    if window == 0 || unsafe { IsWindow(window as Hwnd) } == 0 {
        return Err("无法注册剪贴板所有者窗口。".into());
    }
    APP_OWNER.store(window, Ordering::Release);
    Ok(())
}
#[cfg(test)]
struct TestOwnerWindow(Hwnd);
#[cfg(test)]
impl TestOwnerWindow {
    fn new() -> Result<Self, String> {
        let window = unsafe {
            CreateWindowExW(
                0,
                wide("STATIC").as_ptr(),
                wide("md2chat external clipboard owner test").as_ptr(),
                0,
                0,
                0,
                0,
                0,
                -3isize as Hwnd,
                ptr::null_mut(),
                ptr::null_mut(),
                ptr::null(),
            )
        };
        if window.is_null() || unsafe { IsWindow(window) } == 0 {
            return Err("Could not create external clipboard owner test window".into());
        }
        Ok(Self(window))
    }
}
#[cfg(test)]
impl Drop for TestOwnerWindow {
    fn drop(&mut self) {
        let _ = APP_OWNER.compare_exchange(self.0 as usize, 0, Ordering::SeqCst, Ordering::SeqCst);
        // A window must be destroyed by the thread that created it. This guard
        // is intentionally !Send because it retains the raw HWND.
        unsafe {
            DestroyWindow(self.0);
        }
    }
}
fn wide(value: &str) -> Vec<u16> {
    value.encode_utf16().chain([0]).collect()
}
struct Clipboard {
    window: Hwnd,
    open: bool,
    // Borrowed Tauri windows belong to the UI thread and must never be
    // destroyed here. Only the fallback/test window is owned by this session.
    owns_window: bool,
}
impl Clipboard {
    fn open(writing: bool) -> Result<Self, String> {
        Self::open_with_owner(writing, None)
    }
    fn open_with_owner(writing: bool, owner: Option<Hwnd>) -> Result<Self, String> {
        unsafe {
            let (window, owns_window) = if writing {
                if let Some(window) = owner {
                    if window.is_null() || IsWindow(window) == 0 {
                        return Err("剪贴板所有者窗口已失效，请重新打开 md2chat。".into());
                    }
                    (window, false)
                } else {
                    (
                        CreateWindowExW(
                            0,
                            wide("STATIC").as_ptr(),
                            wide("md2chat clipboard").as_ptr(),
                            0,
                            0,
                            0,
                            0,
                            0,
                            -3isize as Hwnd,
                            ptr::null_mut(),
                            ptr::null_mut(),
                            ptr::null(),
                        ),
                        true,
                    )
                }
            } else {
                (ptr::null_mut(), false)
            };
            if writing && window.is_null() {
                return Err("无法创建剪贴板所有者窗口。".into());
            }
            for _ in 0..10 {
                if OpenClipboard(window) != 0 {
                    return Ok(Self {
                        window,
                        open: true,
                        owns_window,
                    });
                }
                thread::sleep(Duration::from_millis(10));
            }
            if owns_window {
                DestroyWindow(window);
            }
            Err("剪贴板正被其他程序使用，请重试。".into())
        }
    }
    fn close(&mut self) -> Result<(), String> {
        if self.open {
            if unsafe { CloseClipboard() } == 0 {
                return Err("无法关闭系统剪贴板。".into());
            }
            self.open = false;
        }
        Ok(())
    }
}
impl Drop for Clipboard {
    fn drop(&mut self) {
        let _ = self.close();
        unsafe {
            if self.owns_window && !self.window.is_null() {
                DestroyWindow(self.window);
            }
        }
    }
}
fn format_name(id: u32) -> String {
    match id {
        CF_UNICODETEXT => "text/plain".into(),
        CF_DIB | CF_DIBV5 => format!("windows-dib-{id}"),
        _ => unsafe {
            let mut chars = [0u16; 4096];
            let count = GetClipboardFormatNameW(id, chars.as_mut_ptr(), chars.len() as i32);
            if count <= 0 {
                return format!("windows-format-{id}");
            }
            let name = String::from_utf16_lossy(&chars[..count as usize]);
            match name.as_str() {
                "HTML Format" => "text/html".into(),
                "PNG" => "image/png".into(),
                _ => name,
            }
        },
    }
}
unsafe fn data(id: u32) -> Result<Vec<u8>, String> {
    unsafe { data_limited(id, 60 * 1024 * 1024) }
}
unsafe fn data_limited(id: u32, max: usize) -> Result<Vec<u8>, String> {
    unsafe {
        let memory = GetClipboardData(id);
        if memory.is_null() {
            return Err("无法读取剪贴板格式。".into());
        }
        let size = GlobalSize(memory);
        if size > max {
            return Err("剪贴板图文过大，请分段转换。".into());
        }
        if size == 0 {
            return Ok(Vec::new());
        }
        let pointer = GlobalLock(memory);
        if pointer.is_null() {
            return Err("无法读取剪贴板数据。".into());
        }
        let bytes = std::slice::from_raw_parts(pointer as *const u8, size).to_vec();
        GlobalUnlock(memory);
        Ok(bytes)
    }
}
fn dib_to_bmp(dib: &[u8]) -> Result<Vec<u8>, String> {
    if dib.len() < 40 {
        return Err("剪贴板位图无效。".into());
    }
    let number = |offset| u32::from_le_bytes(dib[offset..offset + 4].try_into().unwrap());
    let header = number(0) as usize;
    if header < 40 || header > dib.len() {
        return Err("剪贴板位图头无效。".into());
    }
    let bits = u16::from_le_bytes([dib[14], dib[15]]);
    let colors = number(32) as usize;
    let colors = if colors > 0 {
        colors
    } else if bits <= 8 {
        1usize << bits
    } else {
        0
    };
    let masks = if header == 40 && number(16) == 3 {
        12
    } else {
        0
    };
    let offset = 14usize
        .checked_add(header)
        .and_then(|n| n.checked_add(masks))
        .and_then(|n| n.checked_add(colors.checked_mul(4)?))
        .ok_or("剪贴板位图无效。")?;
    if offset > dib.len() + 14 {
        return Err("剪贴板位图无效。".into());
    }
    let mut bmp = Vec::with_capacity(dib.len() + 14);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((dib.len() + 14) as u32).to_le_bytes());
    bmp.extend_from_slice(&[0; 4]);
    bmp.extend_from_slice(&(offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Ok(bmp)
}
fn png_to_dib(png: &[u8]) -> Result<Vec<u8>, String> {
    let image = crate::images::decode_image(png)?.to_rgba8();
    let (width, height) = image.dimensions();
    let mut out = vec![0u8; 124];
    out[..4].copy_from_slice(&124u32.to_le_bytes());
    out[4..8].copy_from_slice(&(width as i32).to_le_bytes());
    out[8..12].copy_from_slice(&(-(height as i32)).to_le_bytes());
    out[12..14].copy_from_slice(&1u16.to_le_bytes());
    out[14..16].copy_from_slice(&32u16.to_le_bytes());
    out[16..20].copy_from_slice(&3u32.to_le_bytes());
    out[20..24].copy_from_slice(&(width * height * 4).to_le_bytes());
    for (offset, mask) in [
        (40, 0x00ff0000u32),
        (44, 0x0000ff00),
        (48, 0x000000ff),
        (52, 0xff000000),
    ] {
        out[offset..offset + 4].copy_from_slice(&mask.to_le_bytes());
    }
    out[56..60].copy_from_slice(&0x73524742u32.to_le_bytes());
    out[108..112].copy_from_slice(&4u32.to_le_bytes());
    for pixel in image.pixels() {
        out.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }
    Ok(out)
}
pub fn read() -> Result<Snapshot, String> {
    let _clipboard = Clipboard::open(false)?;
    let sequence = unsafe { GetClipboardSequenceNumber() };
    let mut formats = Vec::new();
    let mut id = 0;
    let mut total = 0usize;
    let mut dib = None;
    let mut ids = Vec::new();
    loop {
        id = unsafe { EnumClipboardFormats(id) };
        if id == 0 {
            break;
        }
        if ids.len() >= 500 {
            return Err("剪贴板格式过多。".into());
        }
        ids.push(id);
    }
    let has_png = ids.iter().any(|id| format_name(*id) == "image/png");
    let preferred_dib = if ids.contains(&CF_DIBV5) {
        CF_DIBV5
    } else {
        CF_DIB
    };
    for id in ids {
        let name = format_name(id);
        if (id == CF_DIB || id == CF_DIBV5) && (has_png || id != preferred_dib) {
            continue;
        }
        if !super::readable(&name) && id != CF_DIB && id != CF_DIBV5 {
            formats.push(Format {
                name,
                size: 0,
                bytes: None,
            });
            continue;
        }
        let is_dib = id == CF_DIB || id == CF_DIBV5;
        let bytes = unsafe {
            data_limited(
                id,
                if is_dib {
                    crate::images::MAX_PIXELS as usize * 4 + 1024 * 1024
                } else {
                    60 * 1024 * 1024
                },
            )
        }?;
        let size = bytes.len();
        if is_dib {
            if dib.is_none() || id == CF_DIBV5 {
                dib = Some(bytes);
            }
            continue;
        }
        total += size;
        if total > 60 * 1024 * 1024 {
            return Err("剪贴板图文过大，请分段转换。".into());
        }
        let bytes = if id == CF_UNICODETEXT {
            let units = bytes
                .chunks_exact(2)
                .map(|s| u16::from_le_bytes([s[0], s[1]]))
                .take_while(|n| *n != 0)
                .collect::<Vec<_>>();
            String::from_utf16(&units)
                .map_err(|_| "剪贴板文字编码无效。")?
                .into_bytes()
        } else if name == "text/html" {
            super::parse_cf_html(&bytes)?
        } else {
            bytes
        };
        formats.push(Format {
            name,
            size,
            bytes: Some(bytes),
        });
    }
    if !formats.iter().any(|f| f.name == "image/png") {
        if let Some(dib) = dib {
            let bmp = dib_to_bmp(&dib)?;
            let png = crate::images::encode_png(&crate::images::decode_image(&bmp)?)?;
            total += png.len();
            if total > 60 * 1024 * 1024 {
                return Err("剪贴板图文过大，请分段转换。".into());
            }
            formats.push(Format {
                name: "image/png".into(),
                size: png.len(),
                bytes: Some(png),
            });
        }
    }
    if unsafe { GetClipboardSequenceNumber() } != sequence {
        return Err("读取期间剪贴板已更新，请重试。".into());
    }
    Ok(Snapshot {
        items: vec![formats],
        sequence: sequence as u64,
    })
}
#[cfg(test)]
pub fn write(formats: Vec<(String, Vec<u8>)>) -> Result<(), String> {
    write_checked(formats, None)
}
pub fn write_checked(formats: Vec<(String, Vec<u8>)>, sequence: Option<u64>) -> Result<(), String> {
    let registered = APP_OWNER.load(Ordering::Acquire);
    // Native tests do not boot Tauri, so an unregistered writer retains the
    // self-owned message-only window fallback.
    let owner = if registered == 0 {
        None
    } else {
        let owner = registered as Hwnd;
        if unsafe { IsWindow(owner) } == 0 {
            return Err("剪贴板所有者窗口已失效，请重新打开 md2chat。".into());
        }
        Some(owner)
    };
    write_owned_with_owner(formats, sequence, owner).map(|_| ())
}
fn write_owned(
    formats: Vec<(String, Vec<u8>)>,
    sequence: Option<u64>,
) -> Result<Clipboard, String> {
    write_owned_with_owner(formats, sequence, None)
}
fn write_owned_with_owner(
    mut formats: Vec<(String, Vec<u8>)>,
    sequence: Option<u64>,
    owner: Option<Hwnd>,
) -> Result<Clipboard, String> {
    // Windows consumers can choose the first supported representation.
    formats.sort_by_key(|(name, _)| if name == "text/plain" { 2 } else { 0 });
    // Prepare every allocation before clearing the user's clipboard.
    let mut allocated = Vec::new();
    let result = (|| {
        for (name, bytes) in formats {
            let id = if name == "text/plain" {
                CF_UNICODETEXT
            } else {
                let native = match name.as_str() {
                    "text/html" => "HTML Format",
                    "image/png" => "PNG",
                    other => other,
                };
                let id = unsafe { RegisterClipboardFormatW(wide(native).as_ptr()) };
                if id == 0 {
                    return Err("无法注册剪贴板格式。".to_string());
                }
                id
            };
            let bytes = if name == "text/plain" {
                String::from_utf8(bytes)
                    .map_err(|_| "文字编码无效")?
                    .encode_utf16()
                    .chain([0])
                    .flat_map(u16::to_le_bytes)
                    .collect()
            } else if name == "text/html" {
                super::cf_html(std::str::from_utf8(&bytes).map_err(|_| "HTML 编码无效")?)
            } else {
                bytes
            };
            allocate(id, &bytes, &mut allocated)?;
            if name == "image/png" {
                allocate(CF_DIBV5, &png_to_dib(&bytes)?, &mut allocated)?;
            }
        }
        let mut clipboard = Clipboard::open_with_owner(true, owner)?;
        if sequence
            .is_some_and(|expected| unsafe { GetClipboardSequenceNumber() } as u64 != expected)
        {
            return Err(super::CHANGED.into());
        }
        if unsafe { EmptyClipboard() } == 0 {
            return Err("无法清空剪贴板。".into());
        }
        for (id, memory) in &mut allocated {
            if unsafe { SetClipboardData(*id, *memory) }.is_null() {
                return Err("无法写入系统剪贴板。".into());
            }
            *memory = ptr::null_mut();
        }
        // Closing can synthesize Windows formats and advance the sequence. Keep
        // the owner window alive so tests can restore without a pre-close token.
        clipboard.close()?;
        Ok(clipboard)
    })();
    for (_, memory) in allocated {
        if !memory.is_null() {
            unsafe {
                GlobalFree(memory);
            }
        }
    }
    result
}
fn allocate(id: u32, bytes: &[u8], allocated: &mut Vec<(u32, Handle)>) -> Result<(), String> {
    unsafe {
        let memory = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1));
        if memory.is_null() {
            return Err("剪贴板内存不足。".into());
        }
        let pointer = GlobalLock(memory);
        if pointer.is_null() {
            GlobalFree(memory);
            return Err("无法分配剪贴板内存。".into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), pointer as *mut u8, bytes.len());
        GlobalUnlock(memory);
        allocated.push((id, memory));
        Ok(())
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn dib_v5_roundtrip() {
        let mut png = std::io::Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 3)
            .write_to(&mut png, image::ImageFormat::Png)
            .unwrap();
        let dib = png_to_dib(&png.into_inner()).unwrap();
        let bmp = dib_to_bmp(&dib).unwrap();
        let decoded = crate::images::decode_image(&bmp).unwrap();
        assert_eq!((decoded.width(), decoded.height()), (2, 3));
    }
}

#[cfg(test)]
fn backup_all() -> Result<Vec<(u32, Vec<u8>)>, String> {
    let _clipboard = Clipboard::open(false)?;
    let mut formats = Vec::new();
    let mut id = 0;
    let mut total = 0;
    loop {
        id = unsafe { EnumClipboardFormats(id) };
        if id == 0 {
            break;
        }
        if matches!(id, 2 | 3 | 9 | 14 | 0x80..=0x8e | 0x200..=0x3ff) {
            return Err("Clipboard contains native handles that cannot be restored exactly; native test was not run".into());
        }
        if formats.len() > 500 {
            return Err("Clipboard has too many formats to safely back up".into());
        }
        let bytes = unsafe { data(id) }?;
        total += bytes.len();
        if total > 60 * 1024 * 1024 {
            return Err("Clipboard is too large to safely back up".into());
        }
        formats.push((id, bytes));
    }
    Ok(formats)
}
#[cfg(test)]
fn restore_all(formats: &[(u32, Vec<u8>)], expected_owner: Hwnd) -> Result<(), String> {
    let mut allocated = Vec::new();
    let result = (|| {
        for (id, bytes) in formats {
            allocate(*id, bytes, &mut allocated)?;
        }
        let _clipboard = Clipboard::open(true)?;
        // Check ownership while locked: sampling a sequence after closing could
        // adopt another application's update and later overwrite it.
        if unsafe { GetClipboardOwner() } != expected_owner {
            return Err(super::CHANGED.into());
        }
        if unsafe { EmptyClipboard() } == 0 {
            return Err("Cannot empty clipboard for restoration".into());
        }
        for (id, memory) in &mut allocated {
            if unsafe { SetClipboardData(*id, *memory) }.is_null() {
                return Err("Could not restore original native format".into());
            }
            *memory = ptr::null_mut();
        }
        Ok(())
    })();
    for (_, memory) in allocated {
        if !memory.is_null() {
            unsafe {
                GlobalFree(memory);
            }
        }
    }
    result
}
#[cfg(test)]
pub fn native_roundtrip() -> Result<(), String> {
    let original = backup_all()?;
    let test = super::super::roundtrip_formats();
    let app_owner = TestOwnerWindow::new()?;
    register_app_owner(app_owner.0 as usize)?;
    let mut owned_clipboard = None;
    let mut restore_owner = None;
    let result = (|| {
        let probe_formats = test.clone();
        let owner_probe = thread::spawn(move || write_checked(probe_formats, None))
            .join()
            .map_err(|_| "Cross-thread clipboard owner probe panicked".to_string())
            .and_then(|result| result);
        let actual_owner = unsafe { GetClipboardOwner() };
        if actual_owner == app_owner.0 {
            // From this point onward every failure path can safely attempt to
            // restore only while this exact owner still holds the clipboard.
            restore_owner = Some(app_owner.0);
        }
        owner_probe?;
        if actual_owner != app_owner.0 {
            return Err(
                "Public write did not retain the registered application window as clipboard owner"
                    .into(),
            );
        }
        if unsafe { IsWindow(actual_owner) } == 0 {
            return Err("Public write left an invalid clipboard owner window".into());
        }
        let snapshot = read()?;
        if snapshot.items.len() != 1 {
            return Err("Native write did not retain one item".into());
        }
        for (name, expected) in test {
            let actual = snapshot.items[0]
                .iter()
                .find(|f| f.name == name)
                .and_then(|f| f.bytes.as_ref())
                .ok_or("Missing native format")?;
            if name == "image/png" {
                if !actual.starts_with(&expected)
                    || actual[expected.len()..].iter().any(|b| *b != 0)
                {
                    return Err("PNG bytes did not round trip".into());
                }
            } else if actual != &expected {
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
        if read()?.sequence != sequence {
            return Err("Rejected write changed clipboard".into());
        }
        if unsafe { GetClipboardOwner() } != app_owner.0
            || APP_OWNER.load(Ordering::Acquire) != app_owner.0 as usize
            || unsafe { IsWindow(app_owner.0) } == 0
        {
            return Err("Rejected write destroyed the borrowed application owner".into());
        }
        // A subsequent writer must prevent restoration with the old owner.
        let newer_text = b"newer clipboard content";
        let newer = write_owned(
            vec![("text/plain".into(), newer_text.to_vec())],
            Some(sequence),
        )?;
        owned_clipboard = Some(newer);
        restore_owner = Some(owned_clipboard.as_ref().unwrap().window);
        let rejected = restore_all(&original, app_owner.0);
        if rejected != Err(super::CHANGED.into()) {
            return Err("Restoration did not reject a newer clipboard owner".into());
        }
        if !read()?.items[0].iter().any(|format| {
            format.name == "text/plain" && format.bytes.as_deref() == Some(newer_text)
        }) {
            return Err("Rejected restoration changed newer clipboard content".into());
        }
        Ok(())
    })();
    if let Some(owner) = restore_owner {
        restore_all(&original, owner)
            .map_err(|error| format!("Could not restore original clipboard: {error}"))?;
    } else {
        return result;
    }
    if backup_all()? != original {
        return Err("Original clipboard formats did not restore exactly".into());
    }
    result
}

/// Format enumeration does not request, decode, or copy any clipboard body.
pub fn has_private() -> Result<bool, String> {
    let _clipboard = Clipboard::open(false)?;
    let mut id = 0;
    for _ in 0..500 {
        id = unsafe { EnumClipboardFormats(id) };
        if id == 0 {
            return Ok(false);
        }
        let name = format_name(id);
        if name == super::super::payload::DINGTALK || name == super::super::payload::FEISHU {
            return Ok(true);
        }
    }
    Err("剪贴板格式过多。".into())
}
