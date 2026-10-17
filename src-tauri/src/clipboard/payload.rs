use base64::{engine::general_purpose::STANDARD, Engine};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::Path;

pub const DINGTALK: &str = "com.dingtalk.richTextAttributedString";
pub const FEISHU: &str = "org.chromium.web-custom-data";
pub const MAX_TOTAL: usize = 60 * 1024 * 1024;
pub const MAX_TEXT: usize = 8 * 1024 * 1024;

pub struct Payload {
    pub plain: String,
    pub html: String,
    pub rich: Value,
    pub fragment: Value,
    pub images: usize,
}
pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
pub fn valid_target(target: &str) -> Result<(), String> {
    if ["wechat", "dingtalk", "feishu", "wecom", "email"].contains(&target) {
        Ok(())
    } else {
        Err("不支持的目标平台".into())
    }
}
fn string<'a>(part: &'a Value, key: &str) -> Result<&'a str, String> {
    part.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| "内容格式错误".into())
}
fn runs(part: &Value) -> Vec<Value> {
    if let Some(runs) = part["runs"].as_array() {
        if runs.len() < 10000
            && runs.iter().all(|r| r["text"].is_string())
            && runs
                .iter()
                .map(|r| r["text"].as_str().unwrap())
                .collect::<String>()
                == part["text"].as_str().unwrap_or("")
        {
            return runs.clone();
        }
    }
    vec![json!({"text":part["text"]})]
}
fn styled(run: &Value, text: &str) -> String {
    let mut text = escape(text);
    for (key, tag) in [("bold", "strong"), ("italic", "em"), ("strikethrough", "s")] {
        if run[key].as_bool() == Some(true) {
            text = format!("<{tag}>{text}</{tag}>");
        }
    }
    text
}
fn style(run: &Value) -> Value {
    json!({"bold":run["bold"]==true,"italic":run["italic"]==true,"strikethrough":run["strikethrough"]==true,"underLine":false,"indent":0,"lightColor":"#222222","darkColor":"#eeeeee"})
}

fn cangjie_text(text: &str) -> Value {
    // DingTalk's text leaf must contain a string. HTML formatting elements
    // nested here cause the client to discard the entire styled text run.
    // Until native marks are verified, keep every character in the fragment;
    // the standard HTML representation still preserves emphasis styles.
    json!(["span", {"data-type":"text"}, ["span", {"data-type":"leaf"}, text]])
}

fn cangjie_paragraph(children: &mut Vec<Value>) -> Value {
    let mut node = vec![json!("p"), json!({})];
    if children.is_empty() {
        children.push(cangjie_text(""));
    }
    node.append(children);
    Value::Array(node)
}

pub fn build(
    parts: Vec<Value>,
    target: &str,
    directory: &Path,
    windows: bool,
    mac: bool,
) -> Result<Payload, String> {
    valid_target(target)?;
    if parts.is_empty() || parts.len() > 500 {
        return Err("内容为空或段落过多".into());
    }
    let mut total = 0usize;
    for part in &parts {
        match part["type"].as_str() {
            Some("text") => {
                let text = string(part, "text")?;
                if text.encode_utf16().count() > 2 * 1024 * 1024 {
                    return Err("文字过长".into());
                }
                total += text.len();
            }
            Some("image") => {
                let src = string(part, "src")?;
                if src.len() > 15 * 1024 * 1024 {
                    return Err("图片必须小于 10 MB".into());
                }
                total += src.len();
            }
            Some("table") if target == "email" => {
                let rows = part["rows"].as_array().ok_or("表格格式错误或过大")?;
                if rows.is_empty()
                    || rows.len() > 2000
                    || rows.iter().any(|r| {
                        r.as_array().is_none_or(|cells| {
                            cells.is_empty()
                                || cells.len() > 100
                                || cells.iter().any(|c| {
                                    c.as_str().is_none_or(|s| s.encode_utf16().count() > 10000)
                                })
                        })
                    })
                {
                    return Err("表格格式错误或过大".into());
                }
                total += part["rows"].to_string().len();
            }
            _ => return Err("不支持的内容类型".into()),
        }
        if total > MAX_TOTAL {
            return Err("图文过大，请减少图片后重试".into());
        }
    }
    let mut items = Vec::new();
    let mut html = Vec::new();
    let mut plain = Vec::new();
    let mut feishu = Vec::new();
    let mut cangjie = vec![json!("root"), json!({"copyFrom":"im-native"})];
    let mut image_count = 0;
    let mut png_total = 0;
    let win_ding = windows && target == "dingtalk";
    let feishu_native = (mac || windows) && target == "feishu";
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            items.push(json!({"type":"newLine","data":{}}));
            if target == "dingtalk" && !win_ding {
                html.push("<br>".into());
            }
        }
        match part["type"].as_str().unwrap() {
            "text" => {
                let text = string(part, "text")?;
                plain.push(text.to_owned());
                let all_runs = runs(part);
                if feishu_native {
                    feishu.push(part.clone());
                }
                if target != "dingtalk" {
                    html.push(format!(
                        "<div style=\"margin:0;line-height:1.5;white-space:pre-wrap\">{}</div>",
                        all_runs
                            .iter()
                            .map(|r| styled(r, r["text"].as_str().unwrap()).replace('\n', "<br>"))
                            .collect::<String>()
                    ));
                    continue;
                }
                let mut paragraph = String::new();
                let mut paragraph_nodes = Vec::new();
                for run in all_runs {
                    for (line_index, line) in run["text"].as_str().unwrap().split('\n').enumerate()
                    {
                        if line_index > 0 {
                            items.push(json!({"type":"newLine","data":{}}));
                            if win_ding {
                                html.push(format!(
                                    "<p>{}</p>",
                                    if paragraph.is_empty() {
                                        "<br>"
                                    } else {
                                        &paragraph
                                    }
                                ));
                                paragraph.clear();
                                cangjie.push(cangjie_paragraph(&mut paragraph_nodes));
                            } else {
                                html.push("<br>".into());
                            }
                        }
                        if line.is_empty() {
                            continue;
                        }
                        items.push(json!({"type":"text","data":{"text":line},"style":style(&run)}));
                        let leaf = format!(
                            "<span data-type=\"text\"><span data-type=\"leaf\">{}</span></span>",
                            styled(&run, line)
                        );
                        if win_ding {
                            paragraph.push_str(&leaf);
                            paragraph_nodes.push(cangjie_text(line));
                        } else {
                            html.push(leaf);
                        }
                    }
                }
                if win_ding {
                    cangjie.push(cangjie_paragraph(&mut paragraph_nodes));
                    html.push(format!(
                        "<p>{}</p>",
                        if paragraph.is_empty() {
                            "<br>"
                        } else {
                            &paragraph
                        }
                    ));
                }
            }
            "table" => {
                let rows = part["rows"].as_array().unwrap();
                plain.push(
                    rows.iter()
                        .map(|r| {
                            r.as_array()
                                .unwrap()
                                .iter()
                                .map(|c| c.as_str().unwrap())
                                .collect::<Vec<_>>()
                                .join(" | ")
                        })
                        .collect::<Vec<_>>()
                        .join("\n"),
                );
                let rows_html=rows.iter().enumerate().map(|(i,r)| {let tag=if i==0{"th"}else{"td"};format!("<tr>{}</tr>",r.as_array().unwrap().iter().map(|c|format!("<{tag} style=\"border:1px solid #ccd5df;text-align:left;{}\">{}</{tag}>",if i==0{"background:#edf2f8;"}else{""},escape(c.as_str().unwrap()).replace('\n',"<br>"))).collect::<String>())}).collect::<String>();
                html.push(format!("<table cellpadding=\"8\" cellspacing=\"0\" style=\"border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px\">{rows_html}</table>"));
            }
            "image" => {
                let (png, width, height) = crate::images::normalized_png(string(part, "src")?)?;
                png_total += png.len();
                if png_total > MAX_TOTAL {
                    return Err("图文过大，请减少图片后重试".into());
                }
                let filename = format!("{:x}.png", Sha256::digest(&png));
                let file = directory.join(&filename);
                if target == "dingtalk" && !win_ding || feishu_native {
                    super::cache::write(directory, &filename, &png)?;
                }
                let requested = part["displayWidth"]
                    .as_f64()
                    .filter(|x| x.is_finite() && *x > 0.0)
                    .unwrap_or(f64::from(width));
                let display_width = f64::from(width).min(1100.0).min(requested.max(1.0));
                let display_height = (f64::from(height) * display_width / f64::from(width)).round();
                let data = format!("data:image/png;base64,{}", STANDARD.encode(png));
                if feishu_native {
                    feishu.push(json!({"type":"image","path":file,"width":display_width,"height":display_height}));
                }
                items.push(json!({"type":"image","data":{"authMediaId":"","filename":filename,"path":file,"text":"","url":""},"style":{"width":display_width,"height":display_height,"indent":0,"mode":0}}));
                if target == "dingtalk" {
                    if win_ding {
                        cangjie.push(json!(["p", {},
                            ["img", {"src":data,"width":display_width,"height":display_height}],
                            cangjie_text("")
                        ]));
                    }
                    let image = format!(
                        "<img src=\"{}\" width=\"{display_width}\" height=\"{display_height}\">",
                        escape(&data)
                    );
                    html.push(if win_ding {
                        format!("<p>{image}</p>")
                    } else {
                        image
                    });
                } else {
                    html.push(format!("<div style=\"margin:0;line-height:0\"><img src=\"{data}\" width=\"{display_width}\" alt=\"图片\" style=\"display:block;max-width:100%;height:auto;border:0\"></div>"));
                }
                image_count += 1;
                plain.push("[图片]".into());
            }
            _ => unreachable!(),
        }
    }
    let body = html.join("");
    let body = if win_ding {
        // Windows DingTalk imports this JSON tree from HTML. A normal <img>
        // alone falls back to plain text in the tested client. Keep standard
        // HTML as well, so other HTML consumers can still import the content.
        let fragment = escape(&Value::Array(cangjie).to_string());
        format!("<article class=\"4ever-article\" data-clipboard-cangjie=\"{fragment}\">{body}</article>")
    } else if target == "dingtalk" {
        format!("<article class=\"4ever-article\">{body}</article>")
    } else if target == "email" {
        format!("<div style=\"font-family:Arial,sans-serif;font-size:14px;color:#222;line-height:1.5\">{body}</div>")
    } else {
        body
    };
    let plain = plain.join("\n");
    let html = format!("<meta charset=\"utf-8\">{body}");
    if win_ding && html.len() + plain.len() > MAX_TOTAL {
        return Err("图文过大，请减少图片后重试".into());
    }
    Ok(Payload {
        plain,
        html,
        rich: json!({"contents":[{"type":"markdown","text":{"fallbackText":"","items":items,"minSupportVersion":"1.2","version":"2.0"}}]}),
        fragment: if feishu_native {
            make_fragment(&feishu)?
        } else {
            Value::Null
        },
        images: image_count,
    })
}

pub fn make_fragment(parts: &[Value]) -> Result<Value, String> {
    if parts.is_empty() {
        return Err("飞书内容为空".into());
    }
    let mut ops = Vec::new();
    let mut bytes = 0usize;
    for (index, part) in parts.iter().enumerate() {
        if index > 0 {
            ops.push(json!({"insert":"\n"}));
        }
        if part["type"] == "text" {
            bytes += string(part, "text")?.encode_utf16().count() * 2;
            for run in runs(part) {
                let text = run["text"].as_str().unwrap();
                if text.is_empty() {
                    continue;
                }
                let mut attr = serde_json::Map::new();
                for key in ["bold", "italic", "strikethrough"] {
                    if run[key] == true {
                        attr.insert(key.into(), json!("true"));
                    }
                }
                let mut op = json!({"insert":text});
                if !attr.is_empty() {
                    op["attributes"] = Value::Object(attr);
                }
                ops.push(op);
            }
        } else if part["type"] == "image" {
            let path = string(part, "path")?;
            if !Path::new(path).is_absolute() {
                return Err("飞书图片必须使用本机缓存的绝对路径".into());
            }
            bytes += path.encode_utf16().count() * 2;
            let uuid = uuid::Uuid::new_v4().to_string();
            let image = json!({"src":path,"zoneId":"0","key":uuid,"imageState":"INITIAL","width":part["width"],"height":part["height"]});
            ops.push(json!({"insert":"*","attributes":{"uuid":uuid,"entityType":"image","image":image.to_string()}}));
        } else {
            return Err("飞书内容格式错误".into());
        }
        if bytes > MAX_TEXT {
            return Err("飞书图文数据超过 8 MiB，请减少内容后重试".into());
        }
    }
    Ok(
        json!({"deltas":{"0":{"ops":ops,"zoneId":"0","zoneType":"Z"}},"editorUniqueId":&uuid::Uuid::new_v4().simple().to_string()[..6]}),
    )
}

pub fn encode_feishu(fragment: &Value) -> Result<Vec<u8>, String> {
    let fragment = fragment.to_string();
    let entries = [
        ("application/x-editor-kit-business-key", "IM_CHAT"),
        ("application/x-editor-kit-fragment", fragment.as_str()),
    ];
    let mut data = vec![0; 4];
    data.extend_from_slice(&(entries.len() as u32).to_le_bytes());
    let mut string_bytes = 0;
    for (key, value) in entries {
        for text in [key, value] {
            let units = text.encode_utf16().collect::<Vec<_>>();
            string_bytes += units.len() * 2;
            if string_bytes > MAX_TEXT {
                return Err("飞书图文数据超过 8 MiB，请减少内容后重试".into());
            }
            data.extend_from_slice(&(units.len() as u32).to_le_bytes());
            for unit in units {
                data.extend_from_slice(&unit.to_le_bytes());
            }
            while !data.len().is_multiple_of(4) {
                data.push(0);
            }
        }
    }
    let size = (data.len() - 4) as u32;
    data[..4].copy_from_slice(&size.to_le_bytes());
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn feishu_pickle_utf16_and_padding() {
        let f = json!({"中文":"😀"});
        let bytes = encode_feishu(&f).unwrap();
        assert_eq!(
            u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize,
            bytes.len() - 4
        );
        assert_eq!(u32::from_le_bytes(bytes[4..8].try_into().unwrap()), 2);
        let mut cursor = 8;
        let mut strings = Vec::new();
        for _ in 0..4 {
            let n = u32::from_le_bytes(bytes[cursor..cursor + 4].try_into().unwrap()) as usize;
            cursor += 4;
            strings.push(
                String::from_utf16(
                    &bytes[cursor..cursor + n * 2]
                        .chunks_exact(2)
                        .map(|x| u16::from_le_bytes([x[0], x[1]]))
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            );
            cursor = (cursor + n * 2 + 3) & !3;
        }
        assert_eq!(strings[1], "IM_CHAT");
        assert_eq!(serde_json::from_str::<Value>(&strings[3]).unwrap(), f);
        assert_eq!(cursor, bytes.len());
    }
    #[test]
    fn rich_text_preserves_styles_and_lines() {
        let p=build(vec![json!({"type":"text","text":"你好\n世界","runs":[{"text":"你好\n","bold":true},{"text":"世界","italic":true}]})],"dingtalk",Path::new("/tmp/cache"),false,true).unwrap();
        assert!(p.html.contains("<strong>你好</strong>"));
        let items = p.rich["contents"][0]["text"]["items"].as_array().unwrap();
        assert_eq!(items[1]["type"], "newLine");
        assert_eq!(items[2]["style"]["italic"], true);
    }
    #[test]
    fn invalid_runs_fall_back_to_text() {
        let p = build(
            vec![json!({"type":"text","text":"safe","runs":[{"text":"different"}]})],
            "wechat",
            Path::new("/tmp/cache"),
            false,
            true,
        )
        .unwrap();
        assert!(p.html.contains("safe"));
        assert!(!p.html.contains("different"));
    }
    #[test]
    fn windows_html_has_paragraphs() {
        let p = build(
            vec![json!({"type":"text","text":"a\nb"})],
            "dingtalk",
            Path::new("C:/cache"),
            true,
            false,
        )
        .unwrap();
        assert_eq!(p.html.matches("<p>").count(), 2);
        assert_eq!(p.plain, "a\nb");
    }
    fn windows_cangjie(html: &str) -> Value {
        let encoded = html
            .split_once("data-clipboard-cangjie=\"")
            .expect("Windows DingTalk requires the Cangjie fragment")
            .1
            .split_once('"')
            .unwrap()
            .0;
        serde_json::from_str(
            &encoded
                .replace("&quot;", "\"")
                .replace("&gt;", ">")
                .replace("&lt;", "<")
                .replace("&amp;", "&"),
        )
        .unwrap()
    }
    #[test]
    fn windows_dingtalk_embeds_ordered_images_in_cangjie() {
        let image = image::DynamicImage::new_rgba8(8, 4);
        let src = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(crate::images::encode_png(&image).unwrap())
        );
        let second = format!(
            "data:image/png;base64,{}",
            STANDARD
                .encode(crate::images::encode_png(&image::DynamicImage::new_rgba8(6, 3)).unwrap())
        );
        let directory =
            std::env::temp_dir().join(format!("md2chat-cangjie-{}", uuid::Uuid::new_v4()));
        let p = build(vec![
            json!({"type":"text","text":"前文"}),
            json!({"type":"image","src":src,"sourceUrl":"https://example.invalid/private","displayWidth":4}),
            json!({"type":"text","text":"中间"}),
            json!({"type":"image","src":second}),
            json!({"type":"text","text":"结尾"}),
        ], "dingtalk", &directory, true, false).unwrap();
        if directory.exists() {
            std::fs::remove_dir_all(&directory).unwrap();
        }
        let tree = windows_cangjie(&p.html);
        assert_eq!(tree[0], "root");
        assert_eq!(tree[1]["copyFrom"], "im-native");
        assert_eq!(tree.as_array().unwrap().len(), 7);
        assert_eq!(tree[2][2][2][2], "前文");
        assert_eq!(tree[4][2][2][2], "中间");
        assert_eq!(tree[6][2][2][2], "结尾");
        for (index, dimensions) in [(3, (8, 4)), (5, (6, 3))] {
            assert_eq!(tree[index][0], "p");
            assert_eq!(tree[index][2][0], "img");
            let embedded = tree[index][2][1]["src"].as_str().unwrap();
            let (_, width, height) = crate::images::normalized_png(embedded).unwrap();
            assert_eq!((width, height), dimensions);
        }
        assert_eq!(tree[3][2][1]["width"], 4.0);
        assert_eq!(tree[3][2][1]["height"], 2.0);
        assert_eq!(p.images, 2);
        assert_eq!(p.plain, "前文\n[图片]\n中间\n[图片]\n结尾");
        assert!(!p.html.contains("file:"));
        assert!(!p.html.contains("example.invalid"));
    }
    #[test]
    fn windows_dingtalk_cangjie_escapes_text_and_preserves_blank_lines() {
        let text = "中文😀\n\n\"<&quot;>&\n";
        let p = build(
            vec![json!({"type":"text","text":text})],
            "dingtalk",
            Path::new("unused-cache"),
            true,
            false,
        )
        .unwrap();
        let tree = windows_cangjie(&p.html);
        assert_eq!(tree[2][2][2][2], "中文😀");
        assert_eq!(tree[3][2][2][2], "");
        assert_eq!(tree[4][2][2][2], "\"<&quot;>&");
        assert_eq!(tree[5][2][2][2], "");
        assert_eq!(p.plain, text);
        let other = build(
            vec![json!({"type":"text","text":text})],
            "wechat",
            Path::new("unused-cache"),
            true,
            false,
        )
        .unwrap();
        assert!(!other.html.contains("data-clipboard-cangjie"));
    }
    #[test]
    fn windows_dingtalk_cangjie_keeps_runs_across_paragraphs() {
        let p = build(
            vec![json!({"type":"text","text":"ab\nc","runs":[
                {"text":"a","bold":true},
                {"text":"b\n","italic":true},
                {"text":"c","strikethrough":true}
            ]})],
            "dingtalk",
            Path::new("unused-cache"),
            true,
            false,
        )
        .unwrap();
        let tree = windows_cangjie(&p.html);
        assert_eq!(tree.as_array().unwrap().len(), 4);
        assert_eq!(tree[2][2][2][2], "a");
        assert_eq!(tree[2][3][2][2], "b");
        assert_eq!(tree[3][2][2][2], "c");
        assert!(p.html.contains("<strong>a</strong>"));
        assert!(p.html.contains("<em>b</em>"));
        assert!(p.html.contains("<s>c</s>"));
    }
    #[test]
    fn feishu_styles_and_image_entities() {
        let path = std::env::temp_dir().join("test.png");
        let fragment = make_fragment(&[
            json!({"type":"text","text":"中文😀","runs":[{"text":"中文😀","bold":true}]}),
            json!({"type":"image","path":path,"width":123,"height":45}),
        ])
        .unwrap();
        let ops = fragment["deltas"]["0"]["ops"].as_array().unwrap();
        assert_eq!(ops[0]["attributes"]["bold"], "true");
        assert_eq!(ops[1]["insert"], "\n");
        assert_eq!(ops[2]["attributes"]["entityType"], "image");
        let image: Value =
            serde_json::from_str(ops[2]["attributes"]["image"].as_str().unwrap()).unwrap();
        assert_eq!(image["src"], json!(path));
        assert_eq!(image["width"], 123);
    }
    #[test]
    fn windows_feishu_builds_fragment_with_cached_image() {
        let directory =
            std::env::temp_dir().join(format!("md2chat-windows-feishu-{}", uuid::Uuid::new_v4()));
        let image = image::DynamicImage::new_rgba8(8, 4);
        let src = format!(
            "data:image/png;base64,{}",
            STANDARD.encode(crate::images::encode_png(&image).unwrap())
        );
        let payload = build(
            vec![
                json!({"type":"text","text":"前文","runs":[{"text":"前文","bold":true}]}),
                json!({"type":"image","src":src}),
                json!({"type":"text","text":"后文"}),
            ],
            "feishu",
            &directory,
            true,
            false,
        )
        .unwrap();
        let ops = payload.fragment["deltas"]["0"]["ops"].as_array().unwrap();
        assert_eq!(ops[0]["attributes"]["bold"], "true");
        assert_eq!(ops[2]["attributes"]["entityType"], "image");
        let entity: Value =
            serde_json::from_str(ops[2]["attributes"]["image"].as_str().unwrap()).unwrap();
        assert_eq!(entity["imageState"], "INITIAL");
        assert!(Path::new(entity["src"].as_str().unwrap()).is_file());
        assert_eq!(ops[4]["insert"], "后文");
        assert!(!encode_feishu(&payload.fragment).unwrap().is_empty());
        std::fs::remove_dir_all(directory).unwrap();
    }
    #[test]
    fn feishu_rejects_relative_image_paths() {
        assert!(make_fragment(&[json!({"type":"image","path":"relative.png"})]).is_err());
    }
    #[test]
    fn feishu_bounds_utf16_encoded_data() {
        assert!(encode_feishu(&json!({"text":"😀".repeat(3*1024*1024)})).is_err());
    }
}
