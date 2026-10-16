//! Lexical, bounded diagnostics. Never return clipboard strings, file names,
//! URLs, arbitrary attributes, or arbitrary tag/format names to the renderer.
use regex::Regex;
use serde_json::{json, Value};
fn tag(name: &str) -> &str {
    if "a article aside b blockquote body br caption code col colgroup div em figure figcaption footer h1 h2 h3 h4 h5 h6 head header hr html i img li main ol p pre s section span strong sub sup table tbody td th thead tr u ul".split(' ').any(|v|v==name){name}else{"other"}
}
pub fn html(input: &str) -> Value {
    let original_length = input.len();
    let max = 8 * 1024 * 1024;
    let mut end = input.len().min(max);
    while !input.is_char_boundary(end) {
        end -= 1;
    }
    let input = &input[..end];
    let mut summary = json!({"images":[],"imageCount":0,"tableCount":0,"tags":{},"fragment":{"start":false,"end":false},"truncated":end<original_length});
    // Raw sections are skipped before the ordinary token scanner.
    let raw=Regex::new(r"(?is)<(script|style|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)\b[^>]*>").unwrap();
    let ordinary =
        Regex::new(r#"(?is)<!--.*?-->|<(/?)([a-z][a-z0-9:_-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>"#)
            .unwrap();
    let attributes =
        Regex::new(r#"(?is)([a-z_:][a-z0-9_:.-]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?"#)
            .unwrap();
    let mut position = 0;
    let mut ancestors: Vec<String> = Vec::new();
    while let Some(c) = ordinary.captures(&input[position..]) {
        let whole = c.get(0).unwrap();
        let start = position + whole.start();
        position += whole.end();
        if whole.as_str().starts_with("<!--") {
            let body = whole
                .as_str()
                .trim_start_matches("<!--")
                .trim_end_matches("-->")
                .trim();
            if body == "StartFragment" {
                summary["fragment"]["start"] = json!(true);
            }
            if body == "EndFragment" {
                summary["fragment"]["end"] = json!(true);
            }
            continue;
        }
        let name = c[2].to_ascii_lowercase();
        let closing = &c[1] == "/";
        if closing {
            if let Some(index) = ancestors.iter().rposition(|a| a == &name) {
                ancestors.truncate(index);
            }
            continue;
        }
        let safe = tag(&name).to_owned();
        let count = summary["tags"][&safe].as_u64().unwrap_or(0) + 1;
        summary["tags"][&safe] = json!(count);
        if name == "table" {
            let n = summary["tableCount"].as_u64().unwrap() + 1;
            summary["tableCount"] = json!(n);
        }
        if name == "img" {
            let n = summary["imageCount"].as_u64().unwrap() + 1;
            summary["imageCount"] = json!(n);
            if n > 20 {
                summary["truncated"] = json!(true);
            } else {
                let mut names = Vec::new();
                let mut src = "";
                let mut width = Value::Null;
                let mut height = Value::Null;
                let mut srcset = false;
                for (index, a) in attributes.captures_iter(&c[3]).enumerate() {
                    if index >= 128 {
                        summary["truncated"] = json!(true);
                        break;
                    }
                    let key = a[1].to_ascii_lowercase();
                    let value = a
                        .get(2)
                        .or(a.get(3))
                        .or(a.get(4))
                        .map(|v| v.as_str())
                        .unwrap_or("");
                    let safe_key=if "src srcset sizes width height alt title class id style align border loading decoding crossorigin referrerpolicy role aria-label aria-hidden draggable contenteditable data-type data-media-id data-width data-height data-src".split(' ').any(|k|k==key){key.as_str()}else{"other"};
                    if !names.iter().any(|n| n == safe_key) {
                        names.push(safe_key.to_owned());
                    }
                    match key.as_str() {
                        "src" => src = value,
                        "srcset" => srcset = true,
                        "width" | "height" => {
                            let number = value
                                .trim()
                                .trim_end_matches("px")
                                .parse::<f64>()
                                .ok()
                                .filter(|n| n.is_finite() && *n >= 0.0 && *n <= 1_000_000.0)
                                .map_or(Value::Null, |n| json!(n));
                            if key == "width" {
                                width = number;
                            } else {
                                height = number;
                            }
                        }
                        _ => {}
                    }
                }
                let source = source(src);
                summary["images"].as_array_mut().unwrap().push(json!({"source":source,"attributes":names,"width":width,"height":height,"ancestors":ancestors.iter().rev().take(4).map(|n|tag(n)).collect::<Vec<_>>(),"srcset":srcset}));
            }
        }
        if raw.find(&input[start..]).is_some_and(|m| m.start() == 0) {
            if name == "plaintext" {
                break;
            }
            let close = Regex::new(&format!(r"(?is)</{}\s*>", regex::escape(&name))).unwrap();
            if let Some(close) = close.find(&input[position..]) {
                position += close.end();
            } else {
                break;
            }
            continue;
        }
        if ![
            "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param",
            "source", "track", "wbr",
        ]
        .contains(&name.as_str())
        {
            if ancestors.len() == 256 {
                ancestors.remove(0);
                summary["truncated"] = json!(true);
            }
            ancestors.push(name);
        }
    }
    summary
}
fn source(value: &str) -> Value {
    let value = value.trim();
    let scheme = value.split_once(':').map(|x| x.0.to_ascii_lowercase());
    let kind = if value.is_empty() {
        "empty"
    } else if let Some(s) = &scheme {
        if ["data", "https", "http", "file", "blob", "cid"].contains(&s.as_str()) {
            s.as_str()
        } else {
            "other"
        }
    } else {
        "relative"
    };
    let mut out = json!({"kind":kind,"query":value.contains('?'),"fragment":value.contains('#'),"mime":"other","base64":false,"bytes":null});
    if kind == "data" {
        if let Some((header, body)) = value.get(5..).and_then(|v| v.split_once(',')) {
            let mime = header.split(';').next().unwrap_or("").to_ascii_lowercase();
            if [
                "image/png",
                "image/jpeg",
                "image/gif",
                "image/webp",
                "image/bmp",
                "image/tiff",
                "image/svg+xml",
                "image/avif",
            ]
            .contains(&mime.as_str())
            {
                out["mime"] = json!(mime);
            }
            let base64 = header
                .split(';')
                .any(|part| part.eq_ignore_ascii_case("base64"));
            out["base64"] = json!(base64);
            if base64 {
                let clean = body
                    .bytes()
                    .filter(|b| !b.is_ascii_whitespace())
                    .collect::<Vec<_>>();
                if clean
                    .iter()
                    .all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(b))
                    && clean.len() % 4 != 1
                {
                    let padding = clean.iter().rev().take_while(|b| **b == b'=').count();
                    if padding <= 2 && (padding == 0 || clean.len() % 4 == 0) {
                        if let Some(bytes) = (clean.len() * 3 / 4).checked_sub(padding) {
                            out["bytes"] = json!(bytes);
                        }
                    }
                }
            }
        }
    }
    out
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn diagnostic_does_not_return_sensitive_content() {
        let value=html("<div secret=\"token\"><img src=\"file:///secret/image.png\" alt=\"private\"><table></table><script>'<img src=\"https://secret\">'</script></div>");
        let serialized = value.to_string();
        assert!(!serialized.contains("/secret"));
        assert!(!serialized.contains("private"));
        assert_eq!(value["imageCount"], 1);
        assert_eq!(value["tableCount"], 1);
        assert_eq!(value["images"][0]["source"]["kind"], "file");
    }
}
