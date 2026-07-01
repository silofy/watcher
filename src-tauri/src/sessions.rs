//! Live-session bridge (the read side). The daemon writes per-spawn report JSON into
//! ~/.watcher/sessions/; the webview polls this command and merges new/updated sessions into the
//! report — so a box you spawn in the browser appears in the window without a manual step.

use std::fs;
use std::path::PathBuf;

fn sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("sessions")
}

fn ssh_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("ssh")
}

/// One file the SSH capture tap wrote — an `<id>.in` transcript or its `<id>.meta` sidecar.
#[derive(serde::Serialize)]
pub struct SshLogFile {
    pub name: String,
    pub content: String,
}

/// Return the tap's captured SSH session files (input transcripts + meta), for the frontend to fold
/// into the matching report as on-target commands. Named `<session-uuid>-<ts>.in|.meta`.
#[tauri::command]
pub fn list_ssh_logs() -> Vec<SshLogFile> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(ssh_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            let ext = p.extension().and_then(|x| x.to_str());
            if matches!(ext, Some("in") | Some("out") | Some("meta")) {
                if let (Some(name), Ok(content)) = (p.file_name().and_then(|n| n.to_str()), fs::read_to_string(&p)) {
                    out.push(SshLogFile { name: name.to_string(), content });
                }
            }
        }
    }
    out
}

/// Return the raw JSON of every session report the daemon has written (the frontend parses them).
#[tauri::command]
pub fn list_sessions() -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(entries) = fs::read_dir(sessions_dir()) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) == Some("json") {
                if let Ok(s) = fs::read_to_string(&p) {
                    out.push(s);
                }
            }
        }
    }
    out
}
