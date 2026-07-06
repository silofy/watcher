//! The unified telemetry envelope (brief §3.3). Every source (local PTY, in-VM daemon,
//! plugins) emits this exact shape, so Modules 2–4 never need to know where an event came
//! from. The daemon is the single owner that normalizes clocks and re-redacts on receipt.

use serde::Serialize;

#[derive(Serialize)]
pub struct Provenance {
    /// 1.0 for exact shell-hook boundaries, ~0.7 for stream-inferred ones (§3.3).
    pub boundary_confidence: f64,
    /// "termios" | "regex" | "none" — how stdin masking was applied.
    pub redaction_method: String,
    /// host -> vm -> container provenance, e.g. "host" or "cloud:htb:pwnbox".
    pub context_path: String,
    /// the neutral CTF/lab platform this capture belongs to (from `--platform`), e.g.
    /// "htb" | "thm" | "offsec" | "immersive" | "local" (default).
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
    // --- web fields (http_request / http_response) ---
    #[serde(skip_serializing_if = "Option::is_none")]
    pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub req_headers: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub req_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resp_headers: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub resp_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pair_id: Option<String>,
}

#[derive(Serialize)]
pub struct TelemetryEvent {
    /// "local_pty" | "in_vm_daemon" | "plugin".
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

    pub fn http_request(session: &str, seq: u64, ts: u64, pair_id: &str,
        method: &str, url: &str, req_headers: &str, req_body: &str, platform: &str) -> Self {
        TelemetryEvent {
            source: "plugin".into(), session_uuid: session.into(), seq, ts_utc_us: ts,
            kind: "http_request".into(),
            payload: Payload {
                pair_id: Some(pair_id.into()), method: Some(method.into()), url: Some(url.into()),
                req_headers: Some(req_headers.into()), req_body: Some(req_body.into()),
                ..Default::default()
            },
            provenance: Provenance {
                boundary_confidence: 1.0, redaction_method: "none".into(),
                context_path: "web:burp".into(), platform: platform.into(),
            },
        }
    }

    pub fn http_response(session: &str, seq: u64, ts: u64, pair_id: &str,
        status: i64, resp_headers: &str, resp_body: &str, mime: &str, platform: &str) -> Self {
        TelemetryEvent {
            source: "plugin".into(), session_uuid: session.into(), seq, ts_utc_us: ts,
            kind: "http_response".into(),
            payload: Payload {
                pair_id: Some(pair_id.into()), status: Some(status),
                resp_headers: Some(resp_headers.into()), resp_body: Some(resp_body.into()),
                mime: Some(mime.into()),
                ..Default::default()
            },
            provenance: Provenance {
                boundary_confidence: 1.0, redaction_method: "none".into(),
                context_path: "web:burp".into(), platform: platform.into(),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constructs_http_request_envelope() {
        let req = TelemetryEvent::http_request(
            "session1", 1, 1000, "pair1",
            "POST", "http://example.com/api", "header1: value1", "body content", "htb"
        );
        assert_eq!(req.kind, "http_request");
        assert_eq!(req.source, "plugin");
        assert_eq!(req.payload.method.as_deref(), Some("POST"));
        assert_eq!(req.payload.url.as_deref(), Some("http://example.com/api"));
        assert_eq!(req.payload.pair_id.as_deref(), Some("pair1"));
    }

    #[test]
    fn constructs_http_response_envelope() {
        let resp = TelemetryEvent::http_response(
            "session1", 2, 2000, "pair1",
            200, "content-type: application/json", "{\"status\": \"ok\"}", "application/json", "htb"
        );
        assert_eq!(resp.kind, "http_response");
        assert_eq!(resp.source, "plugin");
        assert_eq!(resp.payload.status, Some(200));
        assert_eq!(resp.payload.mime.as_deref(), Some("application/json"));
        assert_eq!(resp.payload.pair_id.as_deref(), Some("pair1"));
    }
}
