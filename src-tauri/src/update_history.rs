//! Optional release-note data. It never participates in installer verification.
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, time::Duration};

const ERROR: &str = "历史更新暂未完整加载，当前仅显示本版摘要。仍可下载更新。";
const INDEX_LIMIT: usize = 2 * 1024 * 1024;
const CHUNK_LIMIT: usize = 256 * 1024;

#[derive(Clone, Deserialize)]
pub struct Reference {
    file: String,
    bytes: usize,
    sha256: String,
}
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Index {
    schema_version: u64,
    target_version: String,
    chunks: Vec<Chunk>,
}
#[derive(Clone, Deserialize)]
struct Chunk {
    versions: Vec<String>,
    files: HashMap<String, Reference>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Payload {
    schema_version: u64,
    target_version: String,
    locale: String,
    releases: Vec<Release>,
}
#[derive(Deserialize)]
struct Release {
    version: String,
    summary: Vec<String>,
    important: Option<Vec<String>>,
}

#[derive(Default)]
pub struct Cache {
    key: String,
    index: Option<Index>,
    chunks: HashMap<String, Vec<Value>>,
    cached_bytes: usize,
}

fn version(value: &str) -> Option<[u64; 3]> {
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut output = [0; 3];
    for (i, part) in parts.iter().enumerate() {
        if part.is_empty()
            || (part.len() > 1 && part.starts_with('0'))
            || !part.bytes().all(|b| b.is_ascii_digit())
        {
            return None;
        }
        output[i] = part.parse().ok()?;
        if output[i] > 9_007_199_254_740_991 {
            return None;
        }
    }
    Some(output)
}
fn asset_url(target: &str, file: &str) -> Result<String, String> {
    if version(target).is_none()
        || !file.starts_with("update-history-v1")
        || !file.ends_with(".json")
        || !file
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-._".contains(&b))
    {
        return Err(ERROR.into());
    }
    Ok(format!(
        "https://github.com/forgeturl/md2chat/releases/download/v{target}/{file}"
    ))
}
fn verified(bytes: &[u8], reference: &Reference, limit: usize) -> Result<(), String> {
    if reference.bytes == 0
        || reference.bytes > limit
        || bytes.len() != reference.bytes
        || reference.sha256 != format!("{:x}", Sha256::digest(bytes))
    {
        return Err(ERROR.into());
    }
    Ok(())
}
async fn fetch(
    client: &reqwest::Client,
    target: &str,
    reference: &Reference,
    limit: usize,
) -> Result<Vec<u8>, String> {
    if reference.bytes == 0 || reference.bytes > limit {
        return Err(ERROR.into());
    }
    let mut response = client
        .get(asset_url(target, &reference.file)?)
        .send()
        .await
        .map_err(|_| ERROR)?
        .error_for_status()
        .map_err(|_| ERROR)?;
    if response
        .content_length()
        .is_some_and(|len| len > limit as u64)
    {
        return Err(ERROR.into());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|_| ERROR)? {
        if bytes.len() + chunk.len() > limit {
            return Err(ERROR.into());
        }
        bytes.extend_from_slice(&chunk);
    }
    verified(&bytes, reference, limit)?;
    Ok(bytes)
}
fn parse_index(bytes: &[u8], target: &str) -> Result<Index, String> {
    let index: Index = serde_json::from_slice(bytes).map_err(|_| ERROR)?;
    if index.schema_version != 1 || index.target_version != target || index.chunks.is_empty() {
        return Err(ERROR.into());
    }
    let mut previous = None;
    for chunk in &index.chunks {
        if chunk.versions.is_empty() || chunk.versions.len() > 50 {
            return Err(ERROR.into());
        }
        let first = version(&chunk.versions[0]).ok_or(ERROR)?;
        for entry in &chunk.versions {
            let current = version(entry).ok_or(ERROR)?;
            if current[..2] != first[..2]
                || current[2] / 50 != first[2] / 50
                || previous.is_some_and(|prev| current >= prev)
            {
                return Err(ERROR.into());
            }
            previous = Some(current);
        }
    }
    if index.chunks[0].versions[0] != target {
        return Err(ERROR.into());
    }
    Ok(index)
}
fn in_range(value: &str, current: &str, target: &str) -> bool {
    match (version(value), version(current), version(target)) {
        (Some(v), Some(c), Some(t)) => c < v && v <= t,
        _ => false,
    }
}
fn lines_valid(lines: &[String]) -> bool {
    (1..=3).contains(&lines.len())
        && lines.iter().all(|line| {
            !line.trim().is_empty()
                && line.chars().count() <= 180
                && !line.contains(['\r', '\n', '<', '>'])
        })
}
fn parse_chunk(
    bytes: &[u8],
    chunk: &Chunk,
    target: &str,
    locale: &str,
) -> Result<Vec<Value>, String> {
    let data: Payload = serde_json::from_slice(bytes).map_err(|_| ERROR)?;
    if data.schema_version != 1
        || data.target_version != target
        || data.locale != locale
        || data
            .releases
            .iter()
            .map(|entry| &entry.version)
            .ne(chunk.versions.iter())
    {
        return Err(ERROR.into());
    }
    data.releases
        .into_iter()
        .map(|entry| {
            if !lines_valid(&entry.summary)
                || entry
                    .important
                    .as_ref()
                    .is_some_and(|lines| !lines_valid(lines))
            {
                return Err(ERROR.into());
            }
            let mut result = json!({"version":entry.version,"summary":{(locale):entry.summary}});
            if let Some(lines) = entry.important {
                result["important"] = json!({(locale):lines});
            }
            Ok(result)
        })
        .collect()
}
pub async fn load(
    metadata: &Value,
    current: &str,
    target: &str,
    locale: &str,
    cache: &tokio::sync::Mutex<Cache>,
    timeout: Duration,
) -> Result<Value, String> {
    tokio::time::timeout(timeout, async {
        let mut cache = cache.lock().await;
        let client = reqwest::Client::builder()
            .timeout(Duration::from_secs(12))
            .user_agent("md2chat-update-notes")
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() < 5
                    && attempt.url().scheme() == "https"
                    && matches!(
                        attempt.url().host_str(),
                        Some(
                            "github.com"
                                | "release-assets.githubusercontent.com"
                                | "objects.githubusercontent.com"
                        )
                    )
                {
                    attempt.follow()
                } else {
                    attempt.stop()
                }
            }))
            .build()
            .map_err(|_| ERROR)?;
        load_with(
            metadata,
            current,
            target,
            locale,
            &mut cache,
            |reference, limit| {
                let client = client.clone();
                let target = target.to_owned();
                async move { fetch(&client, &target, &reference, limit).await }
            },
        )
        .await
    })
    .await
    .map_err(|_| ERROR.to_owned())?
}
async fn load_with<F, Fut>(
    metadata: &Value,
    current: &str,
    target: &str,
    locale: &str,
    cache: &mut Cache,
    mut reader: F,
) -> Result<Value, String>
where
    F: FnMut(Reference, usize) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<u8>, String>>,
{
    if metadata["schemaVersion"] != 1
        || metadata["current"]["version"] != target
        || !crate::locale::valid(locale)
        || locale == "auto"
        || !in_range(target, current, target)
    {
        return Err(ERROR.into());
    }
    let reference: Reference =
        serde_json::from_value(metadata["history"].clone()).map_err(|_| ERROR)?;
    if reference.file != "update-history-v1.json" {
        return Err(ERROR.into());
    }
    let key = format!("{target}:{}", reference.sha256);
    if cache.key != key {
        *cache = Cache {
            key,
            ..Cache::default()
        };
    }
    if cache.index.is_none() {
        let bytes = reader(reference.clone(), INDEX_LIMIT).await?;
        verified(&bytes, &reference, INDEX_LIMIT)?;
        cache.index = Some(parse_index(&bytes, target)?);
    }
    let index = cache.index.as_ref().ok_or(ERROR)?.clone();
    let mut releases = Vec::new();
    for chunk in &index.chunks {
        if !chunk.versions.iter().any(|v| in_range(v, current, target)) {
            continue;
        }
        let reference = chunk.files.get(locale).ok_or(ERROR)?;
        if !cache.chunks.contains_key(&reference.file) {
            let bytes = reader(reference.clone(), CHUNK_LIMIT).await?;
            verified(&bytes, reference, CHUNK_LIMIT)?;
            if cache.cached_bytes + bytes.len() > 4 * 1024 * 1024 {
                cache.chunks.clear();
                cache.cached_bytes = 0;
            }
            cache.cached_bytes += bytes.len();
            cache.chunks.insert(
                reference.file.clone(),
                parse_chunk(&bytes, chunk, target, locale)?,
            );
        }
        for release in cache.chunks.get(&reference.file).ok_or(ERROR)? {
            if release["version"]
                .as_str()
                .is_some_and(|v| in_range(v, current, target))
            {
                releases.push(release.clone());
            }
        }
    }
    if releases.is_empty() {
        return Err(ERROR.into());
    }
    Ok(
        json!({"schemaVersion":1,"version":target,"locale":locale,"complete":true,"releases":releases}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../tests/fixtures/update-history-v1.json")).unwrap()
    }
    fn bytes(data: &Value, reference: &Reference) -> Vec<u8> {
        data["payloads"][&reference.file]
            .as_str()
            .unwrap()
            .as_bytes()
            .to_vec()
    }
    #[test]
    fn request_deadline_includes_waiting_for_another_languages_cache_lock() {
        tauri::async_runtime::block_on(async {
            let data = fixture();
            let cache = tokio::sync::Mutex::new(Cache::default());
            let held = cache.lock().await;
            let result = tokio::time::timeout(
                Duration::from_secs(1),
                load(
                    &data["metadata"],
                    "0.6.49",
                    "0.7.0",
                    "en",
                    &cache,
                    Duration::from_millis(10),
                ),
            )
            .await
            .expect("waiting for the cache must respect the request deadline");
            assert_eq!(result.unwrap_err(), ERROR);
            assert!(
                held.index.is_none(),
                "a timed-out waiter must not modify the cache"
            );
            drop(held);
            assert!(cache.try_lock().is_ok());
        });
    }
    #[test]
    fn published_node_protocol_loads_only_the_requested_range_and_language_and_reuses_cache() {
        tauri::async_runtime::block_on(async {
            let data = fixture();
            let mut cache = Cache::default();
            let mut calls = Vec::new();
            let result = load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "en",
                &mut cache,
                |reference, _| {
                    calls.push(reference.file.clone());
                    std::future::ready(Ok(bytes(&data, &reference)))
                },
            )
            .await
            .unwrap();
            assert_eq!(calls.len(), 3);
            assert!(calls
                .iter()
                .all(|file| file == "update-history-v1.json" || file.contains("-en-")));
            assert_eq!(result["releases"][0]["version"], "0.7.0");
            assert_eq!(result["releases"][1]["version"], "0.6.50");
            assert_eq!(
                result["releases"][1]["important"]["en"][0],
                "Save your settings."
            );
            assert_eq!(result["releases"].as_array().unwrap().len(), 2);
            let mut cached_requests = 0;
            let again = load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "en",
                &mut cache,
                |_, _| {
                    cached_requests += 1;
                    std::future::ready(Err(ERROR.into()))
                },
            )
            .await
            .unwrap();
            assert_eq!(again, result);
            assert_eq!(cached_requests, 0);
            calls.clear();
            let japanese = load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "ja",
                &mut cache,
                |reference, _| {
                    calls.push(reference.file.clone());
                    std::future::ready(Ok(bytes(&data, &reference)))
                },
            )
            .await
            .unwrap();
            assert_eq!(calls.len(), 2);
            assert!(calls.iter().all(|file| file.contains("-ja-")));
            assert_eq!(
                japanese["releases"][0]["summary"]["ja"][0],
                "ja update 0.7.0"
            );
        });
    }
    #[test]
    fn a_failed_chunk_never_becomes_complete_and_retry_reuses_verified_partial_data() {
        tauri::async_runtime::block_on(async {
            let data = fixture();
            let mut cache = Cache::default();
            let failed = load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "en",
                &mut cache,
                |reference, _| {
                    std::future::ready(if reference.file.contains("0.6-1") {
                        Err("offline".into())
                    } else {
                        Ok(bytes(&data, &reference))
                    })
                },
            )
            .await;
            assert!(failed.is_err());
            let mut requests = 0;
            let result = load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "en",
                &mut cache,
                |reference, _| {
                    requests += 1;
                    std::future::ready(Ok(bytes(&data, &reference)))
                },
            )
            .await
            .unwrap();
            assert_eq!(requests, 1);
            assert_eq!(result["complete"], true);
        });
    }
    #[test]
    fn unknown_schemas_bad_hashes_and_mismatched_payloads_fall_back_without_complete_results() {
        tauri::async_runtime::block_on(async {
            let data = fixture();
            let mut future = data["metadata"].clone();
            future["schemaVersion"] = json!(2);
            let mut cache = Cache::default();
            assert!(
                load_with(&future, "0.6.49", "0.7.0", "en", &mut cache, |_, _| {
                    std::future::ready(Err("must not fetch".into()))
                })
                .await
                .is_err()
            );
            assert!(load_with(
                &data["metadata"],
                "0.6.49",
                "0.7.0",
                "en",
                &mut cache,
                |reference, _| {
                    let mut content = bytes(&data, &reference);
                    content.push(b' ');
                    std::future::ready(Ok(content))
                }
            )
            .await
            .is_err());
            let index_ref: Reference =
                serde_json::from_value(data["metadata"]["history"].clone()).unwrap();
            let index = parse_index(&bytes(&data, &index_ref), "0.7.0").unwrap();
            let chunk = &index.chunks[0];
            let raw = bytes(&data, chunk.files.get("en").unwrap());
            assert!(parse_chunk(&raw, chunk, "0.7.0", "ja").is_err());
            assert!(parse_chunk(&raw, chunk, "0.8.0", "en").is_err());
            let mut extra: Value = serde_json::from_slice(&raw).unwrap();
            extra["futureField"] = json!(true);
            assert!(
                parse_chunk(&serde_json::to_vec(&extra).unwrap(), chunk, "0.7.0", "en").is_ok()
            );
        });
    }
    #[test]
    fn asset_requests_are_version_pinned_and_responses_are_bounded() {
        assert_eq!(
            asset_url("0.7.0", "update-history-v1.json").unwrap(),
            "https://github.com/forgeturl/md2chat/releases/download/v0.7.0/update-history-v1.json"
        );
        for file in [
            "../notes.json",
            "https://evil.test/notes.json",
            "update-history-v1/notes.json",
        ] {
            assert!(asset_url("0.7.0", file).is_err());
        }
        assert!(asset_url("0.7.0/../latest", "update-history-v1.json").is_err());
        assert!(verified(
            b"x",
            &Reference {
                file: "update-history-v1.json".into(),
                bytes: INDEX_LIMIT + 1,
                sha256: String::new()
            },
            INDEX_LIMIT
        )
        .is_err());
        assert!(in_range("0.6.10", "0.6.9", "0.6.11"));
        assert!(!in_range("0.6.9", "0.6.9", "0.6.11"));
    }
}
