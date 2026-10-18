use serde_json::Value;
use std::future::Future;

// Keep the caller's native busy guard alive until the checked write finishes.
// The renderer is a closure so it cannot allocate before the clipboard snapshot.
pub(crate) async fn run<G, R, W>(
    _guard: G,
    snapshot: impl Future<Output = Result<u64, String>>,
    render: impl FnOnce() -> R,
    write: impl FnOnce(Value, u64) -> W,
) -> Result<Value, String>
where
    R: Future<Output = Result<Vec<Value>, String>>,
    W: Future<Output = Result<Value, String>>,
{
    let sequence = snapshot.await?;
    let mut parts = render().await?;
    if parts.len() != 1 || parts[0]["type"] != "image" {
        return Err("转图片未生成完整 PNG，请重试。".into());
    }
    write(parts.remove(0), sequence).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    struct Guard(Arc<AtomicBool>);
    impl Drop for Guard {
        fn drop(&mut self) {
            self.0.store(false, Ordering::SeqCst);
        }
    }

    #[test]
    fn reserves_before_render_and_holds_through_checked_write() {
        let busy = Arc::new(AtomicBool::new(true));
        let result = tauri::async_runtime::block_on(run(
            Guard(busy.clone()),
            async {
                assert!(busy.load(Ordering::SeqCst));
                Ok(7)
            },
            || async {
                assert!(busy.load(Ordering::SeqCst));
                Ok(vec![json!({"type":"image"})])
            },
            |image, expected| {
                let busy = &busy;
                async move {
                    assert!(busy.load(Ordering::SeqCst));
                    assert_eq!(expected, 7);
                    assert_eq!(image["type"], "image");
                    Ok(json!({"type":"image"}))
                }
            },
        ));
        assert!(result.is_ok());
        assert!(!busy.load(Ordering::SeqCst));
    }

    #[test]
    fn snapshot_render_and_write_failures_release_the_guard() {
        for phase in ["snapshot", "render", "write", "invalid"] {
            let busy = Arc::new(AtomicBool::new(true));
            let result = tauri::async_runtime::block_on(run(
                Guard(busy.clone()),
                async {
                    if phase == "snapshot" {
                        Err("snapshot".into())
                    } else {
                        Ok(7)
                    }
                },
                || async {
                    assert_ne!(phase, "snapshot");
                    if phase == "render" {
                        Err("render".into())
                    } else if phase == "invalid" {
                        Ok(vec![json!({"type":"text"})])
                    } else {
                        Ok(vec![json!({"type":"image"})])
                    }
                },
                |_, _| async {
                    assert_eq!(phase, "write");
                    Err("write".into())
                },
            ));
            assert!(result.is_err());
            assert!(!busy.load(Ordering::SeqCst), "{phase}");
        }
    }

    #[test]
    fn changes_while_rendering_preserve_new_clipboard_content() {
        let busy = Arc::new(AtomicBool::new(true));
        let sequence = std::cell::Cell::new(7);
        let clipboard = std::cell::Cell::new("old");
        let result = tauri::async_runtime::block_on(run(
            Guard(busy.clone()),
            async { Ok(sequence.get()) },
            || async {
                clipboard.set("new");
                sequence.set(8);
                Ok(vec![json!({"type":"image"})])
            },
            |_, expected| {
                let sequence = &sequence;
                let clipboard = &clipboard;
                async move {
                    if expected != sequence.get() {
                        return Err(crate::clipboard::CHANGED.into());
                    }
                    clipboard.set("PNG");
                    Ok(Value::Null)
                }
            },
        ));
        assert_eq!(result, Err(crate::clipboard::CHANGED.into()));
        assert_eq!(clipboard.get(), "new");
        assert!(!busy.load(Ordering::SeqCst));
    }

    #[test]
    fn cancelling_a_render_releases_the_guard_without_writing() {
        let busy = Arc::new(AtomicBool::new(true));
        tauri::async_runtime::block_on(async {
            let result = tokio::time::timeout(
                std::time::Duration::from_millis(1),
                run(
                    Guard(busy.clone()),
                    async { Ok(7) },
                    || std::future::pending::<Result<Vec<Value>, String>>(),
                    |_, _| async { panic!("cancelled image must never reach clipboard writer") },
                ),
            )
            .await;
            assert!(result.is_err());
        });
        assert!(!busy.load(Ordering::SeqCst));
    }
}
