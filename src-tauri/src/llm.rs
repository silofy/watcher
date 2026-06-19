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
        Some((200, body)) => LlmStatus { available: true, version: extract_version(&body) },
        _ => LlmStatus { available: false, version: None },
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_version_from_body() {
        assert_eq!(extract_version(r#"{"version":"0.5.1"}"#).as_deref(), Some("0.5.1"));
        assert_eq!(extract_version("{}"), None);
    }
}
