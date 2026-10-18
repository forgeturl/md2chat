//! `md2chat-clipboard copy --cache-dir <dir>`: read `{"target","parts"}` JSON
//! (md2chat payload segments) on stdin, write the target's native clipboard
//! representation with md2chat desktop's own clipboard module, and print its
//! JSON result. Errors go to stderr with exit status 1.
#![allow(dead_code)]

#[path = "../../../src-tauri/src/images.rs"]
mod images;
#[path = "../../../src-tauri/src/clipboard/mod.rs"]
mod clipboard;

use serde_json::Value;
use std::{io::Read, path::PathBuf, process::ExitCode};

const TARGETS: [&str; 2] = ["dingtalk", "feishu"];

fn run() -> Result<Value, String> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let directory = match args.as_slice() {
        [command, flag, dir] if command == "copy" && flag == "--cache-dir" => PathBuf::from(dir),
        _ => return Err("usage: md2chat-clipboard copy --cache-dir <absolute dir>".into()),
    };
    if !directory.is_absolute() {
        return Err("缓存图片目录必须是绝对路径".into());
    }
    let mut input = String::new();
    std::io::stdin()
        .read_to_string(&mut input)
        .map_err(|_| "无法读取转换内容")?;
    let request: Value = serde_json::from_str(&input).map_err(|_| "转换内容不是有效 JSON")?;
    let target = request["target"].as_str().unwrap_or_default();
    if !TARGETS.contains(&target) {
        return Err("不支持的目标平台".into());
    }
    let parts = request["parts"].as_array().cloned().ok_or("缺少转换内容")?;
    clipboard::copy(parts, target, &directory)
}

fn main() -> ExitCode {
    match run() {
        Ok(result) => {
            println!("{result}");
            ExitCode::SUCCESS
        }
        Err(message) => {
            eprintln!("{message}");
            ExitCode::FAILURE
        }
    }
}
