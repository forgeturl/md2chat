use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageReader, Limits};
use std::{
    fs::{self, File, Metadata, OpenOptions},
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

pub(crate) const MAX_IMAGE_BYTES: usize = 10 * 1024 * 1024;
pub(crate) const MAX_PNG_BYTES: usize = 15 * 1024 * 1024;
pub(crate) const MAX_PIXELS: u64 = 20_000_000;

pub(crate) fn local_image_path(source: &str) -> Result<PathBuf, String> {
    if source.is_empty()
        || source.len() > 8192
        || source.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err("路径无效。".into());
    }
    let path = if source
        .get(..5)
        .is_some_and(|s| s.eq_ignore_ascii_case("file:"))
    {
        let url = url::Url::parse(source).map_err(|_| "路径无效。")?;
        if url.scheme() != "file"
            || url.host_str().is_some()
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
        {
            return Err("路径无效。".into());
        }
        url.to_file_path().map_err(|_| "路径无效。")?
    } else {
        PathBuf::from(source)
    };
    let text = path.to_string_lossy();
    if !path.is_absolute()
        || text.starts_with("//")
        || text.starts_with("\\\\")
        || text.chars().any(|c| c <= '\u{1f}' || c == '\u{7f}')
    {
        return Err("路径无效。".into());
    }
    #[cfg(windows)]
    if !matches!(path.components().next(), Some(std::path::Component::Prefix(p)) if matches!(p.kind(), std::path::Prefix::Disk(_)))
    {
        return Err("路径无效。".into());
    }
    Ok(path)
}

fn same_file(a: &Metadata, b: &Metadata) -> bool {
    if !a.is_file() || !b.is_file() || a.len() != b.len() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        a.dev() == b.dev() && a.ino() == b.ino()
    }
    #[cfg(not(unix))]
    {
        a.modified().ok() == b.modified().ok() && a.created().ok() == b.created().ok()
    }
}

pub(crate) fn read_open_file(
    file: &mut File,
    expected: &Metadata,
    max: usize,
) -> Result<Vec<u8>, String> {
    let opened = file.metadata().map_err(|_| "读取失败。")?;
    if !same_file(expected, &opened) || opened.len() > max as u64 {
        return Err("文件已更新或过大，请重试。".into());
    }
    let mut bytes = Vec::with_capacity(opened.len() as usize + 1);
    (&mut *file)
        .take(opened.len() + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| "读取失败。")?;
    let after = file.metadata().map_err(|_| "读取失败。")?;
    let unchanged = same_file(&opened, &after) && opened.modified().ok() == after.modified().ok();
    #[cfg(unix)]
    let unchanged = {
        use std::os::unix::fs::MetadataExt;
        unchanged
            && opened.ctime() == after.ctime()
            && opened.ctime_nsec() == after.ctime_nsec()
            && opened.mtime_nsec() == after.mtime_nsec()
    };
    if bytes.len() != opened.len() as usize || !unchanged {
        return Err("文件已更新，请重试。".into());
    }
    Ok(bytes)
}

pub(crate) fn safe_read(path: &Path, max: usize) -> Result<Vec<u8>, String> {
    let stat = fs::symlink_metadata(path).map_err(map_io)?;
    if !stat.is_file() || stat.file_type().is_symlink() {
        return Err("不是普通图片文件。".into());
    }
    if stat.len() > max as u64 {
        return Err("超过图片大小限制。".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000).share_mode(1);
    }
    let mut file = options.open(path).map_err(map_io)?;
    read_open_file(&mut file, &stat, max)
}

fn map_io(error: std::io::Error) -> String {
    match error.kind() {
        std::io::ErrorKind::NotFound => "文件不存在。",
        std::io::ErrorKind::PermissionDenied => "无读取权限。",
        _ => "读取失败。",
    }
    .into()
}

pub(crate) fn image_mime(bytes: &[u8]) -> Result<&'static str, String> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Ok("image/png")
    } else if bytes.starts_with(b"\xff\xd8\xff") {
        Ok("image/jpeg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Ok("image/gif")
    } else if bytes.len() >= 12 && &bytes[..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
        Ok("image/webp")
    } else if bytes.starts_with(b"BM") {
        Ok("image/bmp")
    } else {
        Err("不支持的图片格式。".into())
    }
}

pub(crate) fn decode_image(bytes: &[u8]) -> Result<image::DynamicImage, String> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片解码失败")?;
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_PIXELS as u32);
    limits.max_image_height = Some(MAX_PIXELS as u32);
    limits.max_alloc = Some(160 * 1024 * 1024);
    reader.limits(limits.clone());
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| "图片尺寸无效或图片数据损坏。")?;
    if width == 0 || height == 0 || u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err("图片不能超过 2000 万像素".into());
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| "图片解码失败")?;
    reader.limits(limits);
    reader.decode().map_err(|_| "图片数据损坏。".into())
}

pub(crate) fn normalized_png(source: &str) -> Result<(Vec<u8>, u32, u32), String> {
    if source.len() > MAX_PNG_BYTES {
        return Err("图片必须是完整的内嵌图片，且小于 10 MB".into());
    }
    let (header, encoded) = source.split_once(',').ok_or("图片格式错误")?;
    if ![
        "data:image/png;base64",
        "data:image/jpeg;base64",
        "data:image/jpg;base64",
        "data:image/gif;base64",
        "data:image/webp;base64",
        "data:image/bmp;base64",
    ]
    .iter()
    .any(|mime| header.eq_ignore_ascii_case(mime))
    {
        return Err("图片必须是完整的内嵌图片".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "图片 Base64 格式错误")?;
    if bytes.len() > MAX_IMAGE_BYTES {
        return Err("单张图片不能超过 10 MB。".into());
    }
    image_mime(&bytes)?;
    let image = decode_image(&bytes)?;
    let (width, height) = (image.width(), image.height());
    let png = encode_png(&image)?;
    Ok((png, width, height))
}

pub(crate) fn encode_png(image: &image::DynamicImage) -> Result<Vec<u8>, String> {
    struct BoundedPng(Vec<u8>);
    impl std::io::Write for BoundedPng {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self
                .0
                .len()
                .checked_add(bytes.len())
                .is_none_or(|size| size > MAX_PNG_BYTES)
            {
                return Err(std::io::Error::other("PNG exceeds the output limit"));
            }
            self.0.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut output = BoundedPng(Vec::new());
    image
        .write_with_encoder(image::codecs::png::PngEncoder::new(&mut output))
        .map_err(|_| "图片转换失败或转换后的图片超过 15 MB。")?;
    Ok(output.0)
}

pub fn read_local_image(source: &str) -> Result<String, String> {
    let bytes = safe_read(&local_image_path(source)?, MAX_IMAGE_BYTES)?;
    let mime = image_mime(&bytes)?;
    decode_image(&bytes)?;
    Ok(format!("data:{mime};base64,{}", STANDARD.encode(bytes)))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejects_nonlocal_paths() {
        for path in [
            "https://example.com/a.png",
            "a.png",
            "file://host/a.png",
            "file:///tmp/a.png?x=1",
            "file:///tmp/a.png#x",
            "/tmp/a\n.png",
            "//host/a.png",
        ] {
            assert!(local_image_path(path).is_err(), "{path}");
        }
    }
    #[test]
    fn data_png_is_decoded_and_normalized() {
        let mut bytes = Cursor::new(Vec::new());
        image::DynamicImage::new_rgba8(2, 3)
            .write_to(&mut bytes, image::ImageFormat::Png)
            .unwrap();
        let (png, w, h) = normalized_png(&format!(
            "data:image/png;base64,{}",
            STANDARD.encode(bytes.into_inner())
        ))
        .unwrap();
        assert_eq!((w, h), (2, 3));
        assert!(png.starts_with(b"\x89PNG"));
    }
    #[test]
    fn rejects_corrupt_images() {
        assert!(normalized_png("data:image/png;base64,aGVsbG8=").is_err());
    }
    #[test]
    fn detects_files_changed_after_validation() {
        let root =
            std::env::temp_dir().join(format!("md2chat-image-race-{}", uuid::Uuid::new_v4()));
        fs::write(&root, b"original").unwrap();
        let stat = fs::metadata(&root).unwrap();
        let mut file = File::open(&root).unwrap();
        fs::write(&root, b"changed size").unwrap();
        assert!(read_open_file(&mut file, &stat, 100).is_err());
        fs::remove_file(root).unwrap();
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_images() {
        let root = std::env::temp_dir().join(format!("md2chat-image-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        fs::write(root.join("file.png"), b"data").unwrap();
        std::os::unix::fs::symlink(root.join("file.png"), root.join("link.png")).unwrap();
        assert!(safe_read(&root.join("link.png"), 10).is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
