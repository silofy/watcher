//! Pwnbox SSH auto-pull. You hack in Pwnbox (a cloud box behind NAT), the in-Pwnbox agent writes
//! exports to a folder there, and The Watcher `scp`-pulls them into ~/.watcher/sessions/ on a timer.
//! From there the existing live-bridge poll ingests them — no manual file move, nothing through a
//! third party. Auth reuses the user's own SSH key (the way HTB Pwnbox SSH already works).

use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use std::process::Command;

fn sessions_dir() -> PathBuf {
    let home = std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).unwrap_or_default();
    PathBuf::from(home).join(".watcher").join("sessions")
}

fn json_names(dir: &PathBuf) -> HashSet<String> {
    let mut s = HashSet::new();
    if let Ok(rd) = fs::read_dir(dir) {
        for e in rd.flatten() {
            if e.path().extension().and_then(|x| x.to_str()) == Some("json") {
                if let Some(n) = e.file_name().to_str() {
                    s.insert(n.to_string());
                }
            }
        }
    }
    s
}

/// scp every export from Pwnbox into the local sessions dir; return the names that are newly here.
/// `identity`/`port`/`remote_dir` are optional; auth is non-interactive (BatchMode) so a missing key
/// fails fast instead of hanging on a prompt.
#[tauri::command]
pub fn pull_pwnbox(
    host: String,
    user: String,
    port: Option<u16>,
    identity: Option<String>,
    remote_dir: Option<String>,
) -> Result<Vec<String>, String> {
    if host.trim().is_empty() || user.trim().is_empty() {
        return Err("host and user are required".into());
    }
    let dest = sessions_dir();
    let _ = fs::create_dir_all(&dest);
    let before = json_names(&dest);

    let remote_dir = remote_dir.unwrap_or_else(|| "~/.watcher-exports".to_string());
    let target = format!("{user}@{host}:{remote_dir}/*.json");

    let mut cmd = Command::new("scp");
    cmd.args(["-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=8"]);
    if let Some(p) = port {
        cmd.arg("-P").arg(p.to_string());
    }
    if let Some(i) = identity.as_deref().filter(|i| !i.trim().is_empty()) {
        cmd.arg("-i").arg(i);
    }
    cmd.arg(&target).arg(&dest);

    let out = cmd.output().map_err(|e| format!("could not run scp (is the OpenSSH client installed?): {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        // an empty export dir / no matches yet is normal, not an error
        if err.contains("No such file") || err.contains("not a regular file") || err.contains("matching") {
            return Ok(vec![]);
        }
        return Err(err.trim().to_string());
    }

    let after = json_names(&dest);
    Ok(after.difference(&before).cloned().collect())
}
