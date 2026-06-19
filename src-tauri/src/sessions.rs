//! Live-session bridge (the read side). The daemon writes per-spawn report JSON into
//! ~/.watcher/sessions/; the webview polls this command and merges new/updated sessions into the
//! report — so a box you spawn in the browser appears in the window without a manual step.

use std::fs;
use std::path::PathBuf;

fn sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("sessions")
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
