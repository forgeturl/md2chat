use super::config::Configuration;
use std::collections::BTreeSet;

pub(crate) const UNAVAILABLE: &str = "快捷键注册失败，可能已被占用或被系统保留。请更换组合。";
pub(crate) const RELEASE_FAILED: &str = "部分旧快捷键未能释放，请重试关闭或重启 md2chat。";

pub(crate) trait Backend {
    fn register(&mut self, accelerator: &str) -> Result<(), String>;
    fn unregister(&mut self, accelerator: &str) -> Result<(), String>;
}

#[derive(Clone, Default)]
pub(crate) struct Registry {
    pub configuration: Configuration,
    pub registered: BTreeSet<String>,
    pub warning: Option<String>,
}

impl Registry {
    fn release<B: Backend>(&mut self, keys: &BTreeSet<String>, backend: &mut B) {
        for key in keys {
            if backend.unregister(key).is_ok() {
                self.registered.remove(key);
            }
        }
        self.warning = self
            .registered
            .difference(&self.configuration.desired())
            .next()
            .map(|_| RELEASE_FAILED.to_owned());
    }

    pub fn apply<B: Backend>(
        &mut self,
        next: Configuration,
        backend: &mut B,
        persist: impl FnOnce(&Configuration) -> Result<(), String>,
    ) -> Result<(), String> {
        let desired = next.desired();
        let additions: BTreeSet<_> = desired.difference(&self.registered).cloned().collect();
        let mut acquired = BTreeSet::new();
        for key in &additions {
            if backend.register(key).is_err() {
                self.release(&acquired, backend);
                return Err(UNAVAILABLE.into());
            }
            self.registered.insert(key.clone());
            acquired.insert(key.clone());
        }
        if let Err(error) = persist(&next) {
            self.release(&acquired, backend);
            return Err(error);
        }
        // Keep old keys until both registration and persistence have succeeded.
        self.configuration = next;
        let obsolete = self.registered.difference(&desired).cloned().collect();
        self.release(&obsolete, backend);
        Ok(())
    }

    pub fn restore<B: Backend>(&mut self, backend: &mut B) {
        // Independent startup failures must not disable the remaining shortcuts.
        for key in self
            .configuration
            .desired()
            .difference(&self.registered)
            .cloned()
            .collect::<Vec<_>>()
        {
            if backend.register(&key).is_ok() {
                self.registered.insert(key);
            }
        }
        let obsolete = self
            .registered
            .difference(&self.configuration.desired())
            .cloned()
            .collect();
        self.release(&obsolete, backend);
    }

    pub fn suspend<B: Backend>(&mut self, backend: &mut B) -> Result<(), String> {
        for key in self.registered.clone() {
            if backend.unregister(&key).is_err() {
                self.restore(backend);
                return Err(RELEASE_FAILED.into());
            }
            self.registered.remove(&key);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::cell::RefCell;
    use std::rc::Rc;

    #[derive(Default)]
    struct Fake {
        calls: Rc<RefCell<Vec<String>>>,
        reject: BTreeSet<String>,
        reject_release: bool,
    }
    impl Backend for Fake {
        fn register(&mut self, key: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("register:{key}"));
            if self.reject.contains(key) {
                Err("occupied".into())
            } else {
                Ok(())
            }
        }
        fn unregister(&mut self, key: &str) -> Result<(), String> {
            self.calls.borrow_mut().push(format!("unregister:{key}"));
            if self.reject_release {
                Err("failed".into())
            } else {
                Ok(())
            }
        }
    }
    fn config(enabled: bool, targets: &[(&str, &str)]) -> Configuration {
        serde_json::from_value(json!({"enabled":enabled,"bindings": targets.iter().map(|(target,key)|
            (target.to_string(), json!({"modifiers":["Control","Alt"],"key":key}))).collect::<serde_json::Map<_,_>>() })).unwrap()
    }

    #[test]
    fn disabled_defaults_edits_restore_and_unrelated_saves_never_touch_backend() {
        let mut registry = Registry::default();
        let mut backend = Fake::default();
        registry.restore(&mut backend);
        registry
            .apply(config(false, &[("email", "Digit7")]), &mut backend, |_| {
                Ok(())
            })
            .unwrap();
        registry.restore(&mut backend);
        assert!(backend.calls.borrow().is_empty());
        assert!(registry.registered.is_empty());
    }

    #[test]
    fn registers_before_persisting_and_releases_old_keys_only_after_commit() {
        let mut registry = Registry::default();
        let mut backend = Fake::default();
        registry
            .apply(config(true, &[("email", "Digit7")]), &mut backend, |_| {
                Ok(())
            })
            .unwrap();
        backend.calls.borrow_mut().clear();
        let calls = backend.calls.clone();
        registry
            .apply(config(true, &[("email", "Digit8")]), &mut backend, |_| {
                calls.borrow_mut().push("persist".into());
                Ok(())
            })
            .unwrap();
        assert_eq!(
            *backend.calls.borrow(),
            [
                "register:Control+Alt+Digit8",
                "persist",
                "unregister:Control+Alt+Digit7"
            ]
        );
        registry
            .apply(config(false, &[("email", "Digit8")]), &mut backend, |_| {
                Ok(())
            })
            .unwrap();
        assert!(registry.registered.is_empty());
    }

    #[test]
    fn registration_and_disk_failures_preserve_old_configuration_and_registration() {
        for disk_failure in [false, true] {
            let mut registry = Registry::default();
            let mut backend = Fake::default();
            let old = config(true, &[("email", "Digit7")]);
            registry
                .apply(old.clone(), &mut backend, |_| Ok(()))
                .unwrap();
            if !disk_failure {
                backend.reject.insert("Control+Alt+Digit9".into());
            }
            assert!(registry
                .apply(
                    config(true, &[("email", "Digit8"), ("image", "Digit9")]),
                    &mut backend,
                    |_| if disk_failure {
                        Err("disk".into())
                    } else {
                        panic!("must not save")
                    }
                )
                .is_err());
            assert_eq!(registry.configuration, old);
            assert_eq!(
                registry.registered,
                BTreeSet::from(["Control+Alt+Digit7".into()])
            );
        }
    }

    #[test]
    fn swaps_reuse_existing_registrations_and_startup_recovers_each_target_independently() {
        let mut registry = Registry {
            configuration: config(true, &[("email", "Digit7"), ("image", "Digit8")]),
            ..Registry::default()
        };
        let mut backend = Fake::default();
        backend.reject.insert("Control+Alt+Digit7".into());
        registry.restore(&mut backend);
        assert_eq!(
            registry.registered,
            BTreeSet::from(["Control+Alt+Digit8".into()])
        );
        backend.reject.clear();
        registry.restore(&mut backend);
        backend.calls.borrow_mut().clear();
        registry
            .apply(
                config(true, &[("image", "Digit7"), ("email", "Digit8")]),
                &mut backend,
                |_| Ok(()),
            )
            .unwrap();
        assert!(backend.calls.borrow().is_empty());
    }

    #[test]
    fn recording_releases_and_restores_keys_and_failed_release_remains_visible() {
        let mut registry = Registry {
            configuration: config(true, &[("email", "Digit7")]),
            ..Registry::default()
        };
        let mut backend = Fake::default();
        registry.restore(&mut backend);
        registry.suspend(&mut backend).unwrap();
        assert!(registry.registered.is_empty());
        registry.restore(&mut backend);
        assert_eq!(registry.registered.len(), 1);
        backend.reject_release = true;
        registry
            .apply(Configuration::default(), &mut backend, |_| Ok(()))
            .unwrap();
        assert!(!registry.configuration.enabled);
        assert_eq!(registry.warning.as_deref(), Some(RELEASE_FAILED));
        backend.reject_release = false;
        registry
            .apply(Configuration::default(), &mut backend, |_| Ok(()))
            .unwrap();
        assert!(registry.registered.is_empty());
        assert!(registry.warning.is_none());
    }
}
