use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, Deserialize, Eq, Ord, PartialEq, PartialOrd, Serialize)]
pub(crate) enum Modifier {
    Control,
    Alt,
    Shift,
    Meta,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Binding {
    pub modifiers: Vec<Modifier>,
    pub key: String,
}

impl Binding {
    pub fn accelerator(&self) -> String {
        self.modifiers
            .iter()
            .map(|modifier| match modifier {
                Modifier::Control => "Control",
                Modifier::Alt => "Alt",
                Modifier::Shift => "Shift",
                Modifier::Meta => "Super",
            })
            .chain(std::iter::once(self.key.as_str()))
            .collect::<Vec<_>>()
            .join("+")
    }
}

#[derive(Clone, Debug, Default, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields, default)]
pub(crate) struct Configuration {
    pub enabled: bool,
    pub bindings: BTreeMap<String, Binding>,
}

pub(crate) const INVALID: &str = "请使用一至两个修饰键和一个字母或数字。";
pub(crate) const RESERVED: &str = "此组合用于常用编辑或系统操作，请更换快捷键。";
pub(crate) const DUPLICATE: &str = "此快捷键已绑定其他格式，请使用不同的组合。";

impl Configuration {
    pub fn validate(mut self, mac: bool) -> Result<Self, String> {
        let mut seen = BTreeSet::new();
        if self.bindings.len() > crate::preferences::TARGETS.len() {
            return Err(INVALID.into());
        }
        for (target, binding) in &mut self.bindings {
            if !crate::preferences::TARGETS.contains(&target.as_str()) {
                return Err("不支持的快捷键目标格式。".into());
            }
            binding.modifiers.sort();
            let count = binding.modifiers.len();
            binding.modifiers.dedup();
            let valid_key = (binding.key.len() == 4
                && binding.key.starts_with("Key")
                && binding.key.as_bytes()[3].is_ascii_uppercase())
                || (binding.key.len() == 6
                    && binding.key.starts_with("Digit")
                    && binding.key.as_bytes()[5].is_ascii_digit());
            if !(1..=2).contains(&count)
                || binding.modifiers.len() != count
                || !valid_key
                || (!mac && binding.modifiers.contains(&Modifier::Meta))
            {
                return Err(INVALID.into());
            }
            // Shift / Option alone produce text on many keyboard layouts.
            if !binding.modifiers.contains(&Modifier::Control)
                && !(mac && binding.modifiers.contains(&Modifier::Meta))
            {
                return Err("快捷键需要包含 Ctrl 或 Command，避免影响正常输入。".into());
            }
            let editing = [
                "KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "KeyY", "KeyQ", "KeyW", "KeyS", "KeyP",
                "KeyO", "KeyN", "KeyF",
            ];
            if ((binding.modifiers == [Modifier::Control]
                || (mac && binding.modifiers == [Modifier::Meta]))
                && editing.contains(&binding.key.as_str()))
                || (mac
                    && binding.modifiers == [Modifier::Control, Modifier::Meta]
                    && binding.key == "KeyQ")
                || (binding.modifiers == [Modifier::Control, Modifier::Shift]
                    && ["KeyZ", "KeyV", "KeyC"].contains(&binding.key.as_str()))
                || (mac
                    && binding.modifiers == [Modifier::Shift, Modifier::Meta]
                    && ["KeyZ", "KeyV", "KeyC", "KeyQ", "Digit3", "Digit4", "Digit5"]
                        .contains(&binding.key.as_str()))
            {
                return Err(RESERVED.into());
            }
            if !seen.insert(binding.accelerator()) {
                return Err(DUPLICATE.into());
            }
        }
        Ok(self)
    }

    pub fn desired(&self) -> BTreeSet<String> {
        if self.enabled {
            self.bindings.values().map(Binding::accelerator).collect()
        } else {
            BTreeSet::new()
        }
    }
}

// A damaged new setting must not reset a user's existing tray/language settings.
pub(crate) fn deserialize_saved<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Configuration, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value::<Configuration>(value)
        .ok()
        .and_then(|value| value.validate(cfg!(target_os = "macos")).ok())
        .unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validation_normalizes_order_and_rejects_duplicates_reserved_and_invalid_keys() {
        let parse = |value| serde_json::from_value::<Configuration>(value).unwrap();
        let config =
            parse(json!({"bindings":{"email":{"modifiers":["Alt","Control"],"key":"Digit7"}}}))
                .validate(false)
                .unwrap();
        assert_eq!(config.bindings["email"].accelerator(), "Control+Alt+Digit7");
        for modifiers in [
            json!([]),
            json!(["Shift"]),
            json!(["Meta"]),
            json!(["Control", "Control"]),
            json!(["Control", "Alt", "Shift"]),
        ] {
            assert!(
                parse(json!({"bindings":{"email":{"modifiers":modifiers,"key":"KeyB"}}}))
                    .validate(false)
                    .is_err()
            );
        }
        for key in ["KeyC", "Space", "F12", "Keyé", "Digit88", "keyB"] {
            assert!(
                parse(json!({"bindings":{"email":{"modifiers":["Control"],"key":key}}}))
                    .validate(false)
                    .is_err()
            );
        }
        assert!(parse(json!({"bindings":{
            "email":{"modifiers":["Control","Alt"],"key":"Digit7"},
            "image":{"modifiers":["Alt","Control"],"key":"Digit7"}
        }}))
        .validate(false)
        .unwrap_err()
        .contains("已绑定"));
        assert!(
            parse(json!({"bindings":{"email":{"modifiers":["Meta","Alt"],"key":"Digit7"}}}))
                .validate(true)
                .is_ok()
        );
        assert!(
            parse(json!({"bindings":{"email":{"modifiers":["Meta","Shift"],"key":"Digit4"}}}))
                .validate(true)
                .is_err()
        );
    }
}
