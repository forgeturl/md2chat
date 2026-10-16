use base64::{engine::general_purpose::STANDARD, Engine};
use regex::Regex;
use sha2::{Digest, Sha256};
use std::{fs, io::Write, path::Path};

fn filename_valid(filename: &str) -> bool {
    filename.len() == 68
        && filename.ends_with(".png")
        && filename.as_bytes().get(..64).is_some_and(|bytes| {
            bytes
                .iter()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(b))
        })
}
fn check_directory(directory: &Path) -> Result<(), String> {
    let stat =
        fs::symlink_metadata(directory).map_err(|_| "缓存图片目录已失效，请重新复制原内容。")?;
    if !directory.is_absolute() || stat.file_type().is_symlink() || !stat.is_dir() {
        return Err("缓存图片目录无效，请重新复制原内容。".into());
    }
    Ok(())
}

#[cfg(unix)]
fn open_directory(directory: &Path) -> Result<std::fs::File, String> {
    use std::os::unix::fs::OpenOptionsExt;
    check_directory(directory)?;
    std::fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(directory)
        .map_err(|_| "缓存图片目录无法安全读取。".into())
}

pub fn write(directory: &Path, filename: &str, bytes: &[u8]) -> Result<(), String> {
    if !filename_valid(filename) || bytes.len() > crate::images::MAX_PNG_BYTES {
        return Err("缓存图片无效。".into());
    }
    if !directory.exists() {
        let mut builder = fs::DirBuilder::new();
        builder.recursive(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::DirBuilderExt;
            builder.mode(0o700);
        }
        builder
            .create(directory)
            .map_err(|_| "无法创建图片缓存目录。")?;
    }
    check_directory(directory)?;
    let temporary = format!(".{}.tmp", uuid::Uuid::new_v4());
    #[cfg(unix)]
    {
        use std::{
            ffi::CString,
            os::fd::{AsRawFd, FromRawFd},
        };
        let directory = open_directory(directory)?;
        let temp = CString::new(temporary).unwrap();
        let dest = CString::new(filename).unwrap();
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                temp.as_ptr(),
                libc::O_CREAT | libc::O_EXCL | libc::O_WRONLY | libc::O_NOFOLLOW,
                0o600,
            )
        };
        if fd < 0 {
            return Err("无法写入图片缓存。".into());
        }
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let result = (|| {
            file.write_all(bytes).map_err(|_| "无法写入图片缓存。")?;
            file.sync_data().map_err(|_| "无法保存图片缓存。")?;
            if unsafe {
                libc::renameat(
                    directory.as_raw_fd(),
                    temp.as_ptr(),
                    directory.as_raw_fd(),
                    dest.as_ptr(),
                )
            } != 0
            {
                return Err("无法保存图片缓存。".to_string());
            }
            Ok(())
        })();
        if result.is_err() {
            unsafe {
                libc::unlinkat(directory.as_raw_fd(), temp.as_ptr(), 0);
            }
        }
        result
    }
    #[cfg(not(unix))]
    {
        let temp = directory.join(temporary);
        let dest = directory.join(filename);
        let result = (|| {
            let mut file = fs::OpenOptions::new()
                .create_new(true)
                .write(true)
                .open(&temp)
                .map_err(|_| "无法写入图片缓存。")?;
            file.write_all(bytes).map_err(|_| "无法写入图片缓存。")?;
            file.sync_data().map_err(|_| "无法保存图片缓存。")?;
            if let Ok(stat) = fs::symlink_metadata(&dest) {
                if stat.file_type().is_symlink() || !stat.is_file() {
                    return Err("图片缓存路径无效。".to_string());
                }
                fs::remove_file(&dest).map_err(|_| "无法更新图片缓存。")?;
            }
            fs::rename(&temp, &dest).map_err(|_| "无法保存图片缓存。".to_string())
        })();
        if result.is_err() {
            let _ = fs::remove_file(temp);
        }
        result
    }
}

fn read(directory: &Path, filename: &str) -> Result<Vec<u8>, String> {
    if !filename_valid(filename) {
        return Err("缓存图片路径无效，请重新复制原内容。".into());
    }
    check_directory(directory)?;
    #[cfg(unix)]
    let bytes = {
        use std::{
            ffi::CString,
            os::fd::{AsRawFd, FromRawFd},
        };
        let directory = open_directory(directory)?;
        let name = CString::new(filename).unwrap();
        let fd = unsafe {
            libc::openat(
                directory.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_NONBLOCK,
            )
        };
        if fd < 0 {
            return Err("缓存图片无法安全读取，请重新复制原内容。".into());
        }
        let mut file = unsafe { std::fs::File::from_raw_fd(fd) };
        let stat = file.metadata().map_err(|_| "缓存图片已失效。")?;
        crate::images::read_open_file(&mut file, &stat, crate::images::MAX_PNG_BYTES)?
    };
    #[cfg(not(unix))]
    let bytes = crate::images::safe_read(&directory.join(filename), crate::images::MAX_PNG_BYTES)?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n")
        || format!("{:x}.png", Sha256::digest(&bytes)) != filename
    {
        return Err("缓存图片校验失败，请重新复制原内容。".into());
    }
    Ok(bytes)
}

pub fn resolve_with(
    html: &str,
    directory: &Path,
    mut on_image: impl FnMut(&[u8], &str) -> Result<(), String>,
) -> Result<String, String> {
    if html.len() > super::payload::MAX_TEXT {
        return Err("剪贴板 HTML 过长，请分段转换。".into());
    }
    let prefix = super::payload::escape(
        url::Url::from_directory_path(directory)
            .map_err(|_| "缓存目录无效")?
            .as_str(),
    );
    let pattern = Regex::new(r#"<img src="([^"]*)""#).unwrap();
    let mut output = String::new();
    let mut position = 0;
    let mut total = 0;
    for captures in pattern.captures_iter(html) {
        let src = &captures[1];
        let Some(filename) = src.strip_prefix(&prefix) else {
            continue;
        };
        let bytes = read(directory, filename)?;
        total += bytes.len();
        if total > super::payload::MAX_TOTAL {
            return Err("剪贴板图文过大，请分段转换。".into());
        }
        on_image(&bytes, filename)?;
        let matched = captures.get(0).unwrap();
        output.push_str(&html[position..matched.start()]);
        output.push_str(&format!(
            "<img src=\"data:image/png;base64,{}\"",
            STANDARD.encode(bytes)
        ));
        position = matched.end();
    }
    if position == 0 {
        Ok(html.into())
    } else {
        output.push_str(&html[position..]);
        Ok(output)
    }
}
pub fn prune(directory: &Path) -> Result<(), String> {
    if !directory.exists() {
        return Ok(());
    }
    check_directory(directory)?;
    for entry in fs::read_dir(directory).map_err(|_| "无法读取图片缓存目录。")? {
        let entry = entry.map_err(|_| "无法读取图片缓存目录。")?;
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if !filename_valid(name) {
            continue;
        }
        let stat = fs::symlink_metadata(entry.path()).map_err(|_| "无法读取图片缓存。")?;
        if stat.is_file()
            && !stat.file_type().is_symlink()
            && stat
                .modified()
                .ok()
                .and_then(|time| time.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 7 * 86400)
        {
            fs::remove_file(entry.path()).map_err(|_| "无法清理图片缓存。")?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn unicode_cache_names_are_rejected() {
        for name in [
            format!("{}😀.png", "中".repeat(20)),
            format!("{}中.png", "a".repeat(61)),
            format!("{}é.png", "a".repeat(62)),
        ] {
            assert_eq!(name.len(), 68);
            assert!(!filename_valid(&name));
        }
    }
    #[test]
    fn hashes_and_resolves_only_own_cache() {
        let dir = std::env::temp_dir().join(format!("md2chat-cache-{}", uuid::Uuid::new_v4()));
        let bytes = b"\x89PNG\r\n\x1a\npayload";
        let name = format!("{:x}.png", Sha256::digest(bytes));
        write(&dir, &name, bytes).unwrap();
        let source = url::Url::from_file_path(dir.join(&name)).unwrap();
        let html = format!("<img src=\"{source}\"><img src=\"file:///etc/passwd\">");
        let out = resolve_with(&html, &dir, |_, _| Ok(())).unwrap();
        assert!(out.contains("data:image/png;base64,"));
        assert!(out.contains("file:///etc/passwd"));
        fs::write(dir.join(name), b"corrupt").unwrap();
        assert!(resolve_with(&html, &dir, |_, _| Ok(())).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn traversal_rejected() {
        let dir = std::env::temp_dir().join(format!("md2chat-cache-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let prefix = url::Url::from_directory_path(&dir).unwrap();
        assert!(resolve_with(
            &format!("<img src=\"{prefix}../secret.png\">"),
            &dir,
            |_, _| Ok(())
        )
        .is_err());
        fs::remove_dir(dir).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn cache_symlink_is_rejected() {
        let dir = std::env::temp_dir().join(format!("md2chat-cache-link-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();
        let name = format!("{}.png", "a".repeat(64));
        std::os::unix::fs::symlink("/etc/passwd", dir.join(&name)).unwrap();
        assert!(read(&dir, &name).is_err());
        fs::remove_dir_all(dir).unwrap();
    }
}
