//! Ollama sidecar management (brief §5.1). The offline LLM runs as a local Ollama server; the Tauri
//! shell probes it and can start it. Doing this from Rust avoids the webview's CORS restrictions on
//! localhost. A dependency-free raw HTTP GET keeps the shell lean — nothing leaves the machine.

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde::Serialize;

const OLLAMA: &str = "127.0.0.1:11434";

#[derive(Serialize)]
pub struct LlmStatus {
    pub available: bool,
    pub version: Option<String>,
    /// Installed model names (e.g. "llama3.2:latest"). Empty when the server is up but no model is
    /// pulled yet — the case the setup flow has to catch, since "reachable" alone still can't coach.
    pub models: Vec<String>,
}

/// Parse the model names out of Ollama's `/api/tags` body.
fn list_models(body: &str) -> Vec<String> {
    serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| v.get("models").and_then(|m| m.as_array()).cloned())
        .map(|arr| arr.iter().filter_map(|m| m.get("name").and_then(|n| n.as_str()).map(String::from)).collect())
        .unwrap_or_default()
}

fn http_get(path: &str) -> Option<(u16, String)> {
    let mut stream = TcpStream::connect(OLLAMA).ok()?; // refused -> None (fast, no hang)
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(800)));
    write!(stream, "GET {path} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n").ok()?;
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf); // closes after response; timeout-safe
    let code = buf.lines().next().and_then(|l| l.split_whitespace().nth(1)).and_then(|c| c.parse::<u16>().ok())?;
    let body = buf.split("\r\n\r\n").nth(1).unwrap_or("").to_string();
    Some((code, body))
}

fn extract_version(body: &str) -> Option<String> {
    let i = body.find("\"version\"")?;
    let rest = &body[i + "\"version\"".len()..];
    let q1 = rest.find('"')?;
    let after = &rest[q1 + 1..];
    let q2 = after.find('"')?;
    Some(after[..q2].to_string())
}

/// Probe the local Ollama server. Returns availability + version, or unavailable (rules-only).
#[tauri::command]
pub fn ollama_status() -> LlmStatus {
    match http_get("/api/version") {
        Some((200, body)) => {
            let models = http_get("/api/tags")
                .and_then(|(c, b)| (c == 200).then(|| list_models(&b)))
                .unwrap_or_default();
            LlmStatus { available: true, version: extract_version(&body), models }
        }
        _ => LlmStatus { available: false, version: None, models: vec![] },
    }
}

/// Start the Ollama sidecar (`ollama serve`) if it is on PATH. The app manages it as a sidecar.
#[tauri::command]
pub fn start_ollama() -> Result<bool, String> {
    std::process::Command::new("ollama")
        .arg("serve")
        .spawn()
        .map(|_| true)
        .map_err(|e| format!("could not start ollama: {e}"))
}

/// Pull a model with `ollama pull <model>` (blocks until done). The model is passed as an argument,
/// never through a shell, so there's no injection surface. Progress streaming is a later refinement;
/// for now the UI shows a busy state and re-checks status when this returns.
#[tauri::command]
pub fn pull_model(model: String) -> Result<bool, String> {
    let model = model.trim();
    if model.is_empty() {
        return Err("no model specified".into());
    }
    let status = std::process::Command::new("ollama")
        .arg("pull")
        .arg(model)
        .status()
        .map_err(|e| format!("could not run ollama (is it installed?): {e}"))?;
    if status.success() {
        Ok(true)
    } else {
        Err(format!("ollama pull {model} failed"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_from_body() {
        assert_eq!(extract_version(r#"{"version":"0.5.1"}"#).as_deref(), Some("0.5.1"));
        assert_eq!(extract_version("{}"), None);
    }

    #[test]
    fn parses_model_names_from_tags() {
        let body = r#"{"models":[{"name":"llama3.2:latest","size":1}, {"name":"qwen2.5:7b"}]}"#;
        assert_eq!(list_models(body), vec!["llama3.2:latest", "qwen2.5:7b"]);
        assert!(list_models("{}").is_empty()); // server up, nothing pulled
        assert!(list_models("not json").is_empty());
    }
}
