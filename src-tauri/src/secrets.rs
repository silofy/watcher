//! Local API-key storage for the cloud coaching providers. Keys are bearer credentials: they live
//! only in ~/.watcher/config.json on this machine (never in the JS bundle, never in the repo) and are
//! never returned to the webview — the UI only learns whether one is set. Shares the config file the
//! HTB token uses. The provider name is checked against a fixed allowlist so the webview can't write
//! arbitrary keys into the config.

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

fn config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("config.json")
}

/// The config field a provider's key is stored under, or None for an unknown provider.
fn key_field(provider: &str) -> Option<&'static str> {
    match provider {
        "anthropic" => Some("anthropic_key"),
        "openai" => Some("openai_key"),
        "gemini" => Some("gemini_key"),
        "openrouter" => Some("openrouter_key"),
        _ => None,
    }
}

fn read_key_from(path: &Path, field: &str) -> Option<String> {
    let s = fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&s).ok()?;
    let t = v.get(field)?.as_str()?.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

fn write_key_to(path: &Path, field: &str, key: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut v: Value = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    v[field] = Value::String(key.trim().to_string());
    fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| e.to_string())
}

fn clear_key_at(path: &Path, field: &str) -> Result<(), String> {
    if let Ok(s) = fs::read_to_string(path) {
        if let Ok(mut v) = serde_json::from_str::<Value>(&s) {
            if let Some(obj) = v.as_object_mut() {
                obj.remove(field);
            }
            return fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| e.to_string());
        }
    }
    Ok(())
}

/// Read a provider's stored key (server-side only). None if unknown provider or unset.
pub(crate) fn api_key(provider: &str) -> Option<String> {
    read_key_from(&config_path(), key_field(provider)?)
}

#[tauri::command]
pub fn set_api_key(provider: String, key: String) -> Result<(), String> {
    let field = key_field(&provider).ok_or("unknown provider")?;
    if key.trim().is_empty() {
        return Err("empty key".into());
    }
    write_key_to(&config_path(), field, &key)
}

#[tauri::command]
pub fn has_api_key(provider: String) -> bool {
    key_field(&provider).map(|f| read_key_from(&config_path(), f).is_some()).unwrap_or(false)
}

#[tauri::command]
pub fn clear_api_key(provider: String) -> Result<(), String> {
    let field = key_field(&provider).ok_or("unknown provider")?;
    clear_key_at(&config_path(), field)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("watcher-secrets-{name}")).join("config.json");
        let _ = fs::remove_dir_all(p.parent().unwrap());
        p
    }

    #[test]
    fn key_roundtrips_and_trims() {
        let p = temp("roundtrip");
        write_key_to(&p, "anthropic_key", "  sk-ant-xyz  ").unwrap();
        assert_eq!(read_key_from(&p, "anthropic_key").as_deref(), Some("sk-ant-xyz"));
    }

    #[test]
    fn unknown_provider_has_no_field() {
        assert_eq!(key_field("anthropic"), Some("anthropic_key"));
        assert_eq!(key_field("openai"), Some("openai_key"));
        assert_eq!(key_field("gemini"), Some("gemini_key"));
        assert_eq!(key_field("openrouter"), Some("openrouter_key"));
        assert_eq!(key_field("evil"), None); // allowlist blocks arbitrary keys
    }

    #[test]
    fn providers_are_independent_and_clear_is_scoped() {
        let p = temp("independent");
        write_key_to(&p, "anthropic_key", "a").unwrap();
        write_key_to(&p, "openai_key", "o").unwrap();
        clear_key_at(&p, "anthropic_key").unwrap();
        assert_eq!(read_key_from(&p, "anthropic_key"), None);
        assert_eq!(read_key_from(&p, "openai_key").as_deref(), Some("o")); // untouched
    }

    #[test]
    fn write_preserves_the_htb_token() {
        let p = temp("coexist");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, r#"{"htb_token":"keep"}"#).unwrap();
        write_key_to(&p, "openai_key", "o").unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["htb_token"], "keep"); // shares the config file, doesn't clobber it
        assert_eq!(v["openai_key"], "o");
    }
}
