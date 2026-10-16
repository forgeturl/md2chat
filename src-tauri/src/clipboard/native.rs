#[derive(Clone, Debug)]
pub struct Format {
    pub name: String,
    pub size: usize,
    pub bytes: Option<Vec<u8>>,
}
pub struct Snapshot {
    pub items: Vec<Vec<Format>>,
    pub sequence: u64,
}

pub fn readable(name: &str) -> bool {
    [
        "text/plain",
        "text/html",
        "image/png",
        "image/jpeg",
        "image/webp",
        "image/gif",
        "image/bmp",
        "image/tiff",
        super::payload::DINGTALK,
        super::payload::FEISHU,
    ]
    .contains(&name)
}

#[cfg(target_os = "macos")]
#[path = "macos.rs"]
mod platform;
#[cfg(windows)]
#[path = "windows.rs"]
mod platform;
#[cfg(all(test, any(target_os = "macos", windows)))]
pub use platform::native_roundtrip;
#[cfg(any(target_os = "macos", windows))]
pub use platform::{has_private, read, write_checked};
#[cfg(not(any(target_os = "macos", windows)))]
pub fn read() -> Result<Snapshot, String> {
    Err("当前平台尚未提供原生剪贴板适配。".into())
}
#[cfg(not(any(target_os = "macos", windows)))]
pub fn write_checked(_: Vec<(String, Vec<u8>)>, _: Option<u64>) -> Result<(), String> {
    Err("当前平台尚未提供原生剪贴板适配。".into())
}

#[cfg(any(windows, test))]
pub fn cf_html(html: &str) -> Vec<u8> {
    let before = "<html><body><!--StartFragment-->";
    let after = "<!--EndFragment--></body></html>";
    let dummy="Version:0.9\r\nStartHTML:0000000000\r\nEndHTML:0000000000\r\nStartFragment:0000000000\r\nEndFragment:0000000000\r\n";
    let start = dummy.len();
    let fragment = start + before.len();
    let end_fragment = fragment + html.len();
    let end = end_fragment + after.len();
    format!("Version:0.9\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nStartFragment:{fragment:010}\r\nEndFragment:{end_fragment:010}\r\n{before}{html}{after}\0").into_bytes()
}
#[cfg(any(windows, test))]
pub fn parse_cf_html(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let bytes = bytes.strip_suffix(&[0]).unwrap_or(bytes);
    let header = String::from_utf8_lossy(&bytes[..bytes.len().min(1024)]);
    let number = |key: &str| -> Option<usize> {
        header
            .lines()
            .find_map(|line| line.strip_prefix(key).and_then(|v| v.trim().parse().ok()))
    };
    if let (Some(start), Some(end)) = (number("StartFragment:"), number("EndFragment:")) {
        if start <= end && end <= bytes.len() {
            return Ok(bytes[start..end].to_vec());
        }
        return Err("剪贴板 HTML 偏移无效。".into());
    }
    if let (Some(start), Some(end)) = (number("StartHTML:"), number("EndHTML:")) {
        if start <= end && end <= bytes.len() {
            return Ok(bytes[start..end].to_vec());
        }
    }
    Err("剪贴板 HTML 格式无效。".into())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cf_html_offsets_are_utf8_bytes() {
        let html = "<p>中文😀</p>";
        let bytes = cf_html(html);
        assert_eq!(parse_cf_html(&bytes).unwrap(), html.as_bytes());
        assert!(String::from_utf8_lossy(&bytes).contains("StartFragment:"));
    }
    #[test]
    fn invalid_offsets_rejected() {
        assert!(parse_cf_html(b"StartFragment:1000\r\nEndFragment:2000\r\nhi").is_err());
    }
}

#[cfg(not(any(target_os = "macos", windows)))]
pub fn has_private() -> Result<bool, String> {
    Ok(false)
}

pub const CHANGED: &str = "转换期间剪贴板已更新，已保留新内容。请重新选择转换格式。";
