//! The unified telemetry envelope (brief §3.3). Both capture agents (local PTY,
//! browser extension, in-VM daemon, plugins) emit this exact shape, so Modules 2–4
//! never need to know where an event came from. The daemon is the single owner that
//! normalizes clocks and re-redacts on receipt.

use serde::Serialize;

#[derive(Serialize)]
pub struct Provenance {
    /// 1.0 for exact shell-hook boundaries, ~0.7 for stream-inferred ones (§3.3).
    pub boundary_confidence: f64,
    /// "termios" | "regex" | "none" — how stdin masking was applied.
    pub redaction_method: String,
    /// host -> vm -> container provenance, e.g. "host" or "cloud:htb:pwnbox".
    pub context_path: String,
    /// the capturing surface, e.g. "conpty" | "unix-pty" | "ttyd".
    pub platform: String,
}

#[derive(Serialize, Default)]
pub struct Payload {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cmd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub text: Option<String>,
    /// number of output lines after VT cleaning — a machine-bound signal downstream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line_count: Option<u64>,
}

#[derive(Serialize)]
pub struct TelemetryEvent {
    /// "local_pty" | "browser_ext" | "in_vm_daemon" | "plugin".
    pub source: String,
    pub session_uuid: String,
    pub seq: u64,
    /// UTC microseconds — the daemon tracks per-source skew before joining.
    pub ts_utc_us: u64,
    /// "command" | "output" | "stdin_masked".
    pub kind: String,
    pub payload: Payload,
    pub provenance: Provenance,
}

impl TelemetryEvent {
    pub fn command(
        session: &str,
        seq: u64,
        ts: u64,
        cmd: &str,
        exit: Option<i64>,
        confidence: f64,
        platform: &str,
    ) -> Self {
        TelemetryEvent {
            source: "local_pty".into(),
            session_uuid: session.into(),
            seq,
            ts_utc_us: ts,
            kind: "command".into(),
            payload: Payload {
                cmd: Some(cmd.into()),
                // exit_code comes from the OSC 133 D marker (1.0 confidence) when present.
                exit_code: exit,
                ..Default::default()
            },
            provenance: Provenance {
                boundary_confidence: confidence,
                redaction_method: "none".into(),
                context_path: "host".into(),
                platform: platform.into(),
            },
        }
    }

    /// A session lifecycle marker (session_start | session_end | session_flag). seq 0; the
    /// note carries the label (start) or reason (end). These bracket the command/output stream
    /// so the store can stamp session boundaries and the report a target.
    pub fn session(kind: &str, session: &str, at_us: u64, note: &str, platform: &str) -> Self {
        TelemetryEvent {
            source: "local_pty".into(),
            session_uuid: session.into(),
            seq: 0,
            ts_utc_us: at_us,
            kind: kind.into(),
            payload: Payload { text: Some(note.into()), ..Default::default() },
            provenance: Provenance {
                boundary_confidence: 1.0,
                redaction_method: "none".into(),
                context_path: "host".into(),
                platform: platform.into(),
            },
        }
    }

    pub fn output(session: &str, seq: u64, ts: u64, text: &str, masked: bool, confidence: f64, platform: &str) -> Self {
        let line_count = if text.is_empty() { 0 } else { text.lines().count() as u64 };
        TelemetryEvent {
            source: "local_pty".into(),
            session_uuid: session.into(),
            seq,
            ts_utc_us: ts,
            kind: if masked { "stdin_masked".into() } else { "output".into() },
            payload: Payload {
                stream: Some("stdout".into()),
                text: Some(if masked { "[redacted: password prompt detected]".into() } else { text.into() }),
                line_count: Some(line_count),
                ..Default::default()
            },
            provenance: Provenance {
                boundary_confidence: confidence,
                redaction_method: if masked { "heuristic".into() } else { "none".into() },
                context_path: "host".into(),
                platform: platform.into(),
            },
        }
    }
}
