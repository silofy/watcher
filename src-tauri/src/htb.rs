//! HackTheBox API integration — pull the official write-up for a *retired* box to seed the golden
//! path. The API token is a bearer credential: it lives only in ~/.watcher/config.json on this
//! machine (never in the JS bundle, never in the repo) and is never returned to the webview. Every
//! call is the user's own authenticated, personal-use request against the HTB v4 API.

use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use serde_json::Value;

const API: &str = "https://labs.hackthebox.com/api/v4";

fn config_path() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("config.json")
}

/// Read the stored HTB token from a config file, if a non-empty one is present.
fn read_token_from(path: &Path) -> Option<String> {
    let s = fs::read_to_string(path).ok()?;
    let v: Value = serde_json::from_str(&s).ok()?;
    let t = v.get("htb_token")?.as_str()?.trim().to_string();
    if t.is_empty() {
        None
    } else {
        Some(t)
    }
}

/// Merge a token into the config file, preserving any other keys already there.
fn write_token_to(path: &Path, token: &str) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    let mut v: Value = fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| serde_json::json!({}));
    v["htb_token"] = Value::String(token.trim().to_string());
    fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| e.to_string())
}

/// Remove the token, leaving any other config keys intact.
fn clear_token_at(path: &Path) -> Result<(), String> {
    if let Ok(s) = fs::read_to_string(path) {
        if let Ok(mut v) = serde_json::from_str::<Value>(&s) {
            if let Some(obj) = v.as_object_mut() {
                obj.remove("htb_token");
            }
            return fs::write(path, serde_json::to_string_pretty(&v).unwrap_or_default()).map_err(|e| e.to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn set_htb_token(token: String) -> Result<(), String> {
    if token.trim().is_empty() {
        return Err("empty token".into());
    }
    write_token_to(&config_path(), &token)
}

#[tauri::command]
pub fn has_htb_token() -> bool {
    read_token_from(&config_path()).is_some()
}

#[tauri::command]
pub fn clear_htb_token() -> Result<(), String> {
    clear_token_at(&config_path())
}

fn agent() -> Result<ureq::Agent, String> {
    let tls = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
    Ok(ureq::builder().tls_connector(Arc::new(tls)).build())
}

/// A GET against the HTB API with the bearer token, mapping the common failures to plain guidance.
fn api_get(agent: &ureq::Agent, url: &str, token: &str) -> Result<ureq::Response, String> {
    agent
        .get(url)
        .set("Authorization", &format!("Bearer {token}"))
        .set("User-Agent", "Watcher")
        .call()
        .map_err(|e| match e {
            ureq::Error::Status(401, _) => "HTB rejected the token (401) — regenerate it in your HTB profile and re-enter it.".into(),
            ureq::Error::Status(403, _) => "HTB denied this (403) — the official write-up download needs a VIP subscription.".into(),
            ureq::Error::Status(404, _) => "HTB has no machine by that name (404).".into(),
            ureq::Error::Status(c, _) => format!("HTB API returned {c}."),
            other => other.to_string(),
        })
}

/// Resolve a box name to its (id, retired) via the profile endpoint. The machine is usually wrapped
/// under an "info" object; fall back to the root if not.
fn machine_info(agent: &ureq::Agent, name: &str, token: &str) -> Result<(i64, bool), String> {
    let url = format!("{API}/machine/profile/{name}");
    let body = api_get(agent, &url, token)?.into_string().map_err(|e| e.to_string())?;
    let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
    let info = v.get("info").unwrap_or(&v);
    let id = info.get("id").and_then(|x| x.as_i64()).ok_or("HTB response had no machine id.")?;
    let retired = match info.get("retired") {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
        _ => false,
    };
    Ok((id, retired))
}

/// HTB write-ups download as PDF; pull the text layer out for the local model.
fn extract_pdf_text(bytes: &[u8]) -> Result<String, String> {
    let text = pdf_extract::extract_text_from_mem(bytes).map_err(|e| format!("couldn't read the write-up PDF: {e}"))?;
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Err("the write-up PDF had no extractable text (scanned or password-protected).".into());
    }
    Ok(trimmed.to_string())
}

/// Pull the official HTB write-up for a retired box and return its extracted text. Personal use only:
/// this downloads *your* VIP-entitled copy; redistribution and active-machine PDFs are off-limits.
#[tauri::command]
pub fn fetch_htb_writeup(name: String) -> Result<String, String> {
    let token = read_token_from(&config_path()).ok_or("No HTB token set — add it in settings first.")?;
    let agent = agent()?;
    let (id, retired) = machine_info(&agent, &name, &token)?;
    if !retired {
        return Err(format!("{name} isn't retired yet — official write-ups are only available once a box retires."));
    }
    let resp = api_get(&agent, &format!("{API}/machine/writeup/{id}"), &token)?;
    let mut bytes = Vec::new();
    resp.into_reader().take(25_000_000).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
    extract_pdf_text(&bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("watcher-htb-{name}")).join("config.json");
        let _ = fs::remove_dir_all(p.parent().unwrap());
        p
    }

    #[test]
    fn token_roundtrips_and_trims() {
        let p = temp("roundtrip");
        write_token_to(&p, "  abc123  ").unwrap();
        assert_eq!(read_token_from(&p).as_deref(), Some("abc123"));
    }

    #[test]
    fn missing_or_empty_reads_as_none() {
        let p = temp("missing");
        assert_eq!(read_token_from(&p), None); // file doesn't exist
        write_token_to(&p, "   ").unwrap();
        assert_eq!(read_token_from(&p), None); // whitespace-only is not a token
    }

    #[test]
    fn clear_removes_token_but_keeps_other_config() {
        let p = temp("clear");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, r#"{"other":"keep","htb_token":"secret"}"#).unwrap();
        clear_token_at(&p).unwrap();
        assert_eq!(read_token_from(&p), None);
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["other"], "keep"); // unrelated keys survive
    }

    #[test]
    fn write_preserves_other_config_keys() {
        let p = temp("preserve");
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(&p, r#"{"other":1}"#).unwrap();
        write_token_to(&p, "tok").unwrap();
        let v: Value = serde_json::from_str(&fs::read_to_string(&p).unwrap()).unwrap();
        assert_eq!(v["other"], 1);
        assert_eq!(v["htb_token"], "tok");
    }
}
