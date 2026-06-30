//! The Watcher daemon core — the single SQLCipher owner. Every source (local PTY capture, plugins
//! over a local socket) feeds it §3.3 envelopes; the daemon:
//!   1. **re-redacts on receipt** (`watcher_core::redact`) — never trusts an upstream's scrubbing,
//!   2. **owns session boundaries** (`watcher_core::SessionController`) — honors upstream
//!      session_start/session_end, auto-starts/closes otherwise, surfaces flag nudges,
//!   3. **stamps + persists** command/output to the encrypted store under the active session.
//!
//! `StreamProcessor` is a pure, incremental transform (no DB) so it is fully testable; a single
//! consumer owns the store connection (the "single SQLCipher owner") and many sources feed it.

use std::sync::mpsc::Receiver;

use serde::Deserialize;
use watcher_core::{redact, EndReason, SessionConfig, SessionController, SessionEvent};
use watcher_store::{ingest, parse_ndjson, RawEvent, SqlConnection};

// ---- Plugin capability handshake (brief §5.4) ----

#[derive(Debug, Deserialize)]
pub struct Capabilities {
    pub has_exit_codes: bool,
    pub has_stdin: bool,
    pub boundary_confidence: String, // "exact" | "inferred"
    pub redaction: String,           // "none" | "regex" | "termios"
}

/// The first message on a plugin connection — declares the fidelity the core is ingesting so it
/// can weight events and fill what the plugin can't provide.
#[derive(Debug, Deserialize)]
pub struct Handshake {
    pub watcher_handshake: String,
    pub plugin: String,
    pub class: String,
    pub capabilities: Capabilities,
    pub context_template: Option<String>,
}

/// Parse a handshake line, or None if it isn't one.
pub fn parse_handshake(line: &str) -> Option<Handshake> {
    let t = line.trim();
    if t.is_empty() {
        return None;
    }
    serde_json::from_str::<Handshake>(t).ok()
}

/// Apply a plugin's declared capabilities to an envelope: fill provenance the plugin omitted
/// (context from its template, confidence from its declared boundary fidelity, platform = plugin).
/// Re-redaction in the pipeline is unconditional regardless of the declared `redaction`.
pub fn apply_capabilities(ev: &mut RawEvent, hs: &Handshake) {
    if ev.provenance.context_path.is_none() {
        if let Some(t) = &hs.context_template {
            ev.provenance.context_path = Some(t.clone());
        }
    }
    if ev.provenance.boundary_confidence.is_none() {
        ev.provenance.boundary_confidence = Some(if hs.capabilities.boundary_confidence == "exact" { 1.0 } else { 0.7 });
    }
    if ev.provenance.platform.is_none() {
        ev.provenance.platform = Some(hs.plugin.clone());
    }
}

#[derive(Debug, Default, PartialEq)]
pub struct Summary {
    pub sessions: usize,
    pub commands: usize,
    pub outputs: usize,
    pub nudges: usize,
    pub redactions: usize,
}

/// The outcome of handling one envelope: what to persist, the lifecycle events it triggered, and
/// whether any field was re-redacted.
pub struct Handled {
    pub store: Option<RawEvent>,
    pub session_events: Vec<SessionEvent>,
    pub redacted: bool,
}

/// Incremental processor: re-redact → drive session boundaries → stamp. Holds only the session
/// controller (no DB), so it can be unit-tested in isolation.
pub struct StreamProcessor {
    ctrl: SessionController,
}

impl StreamProcessor {
    pub fn new(cfg: SessionConfig, id_gen: Box<dyn FnMut() -> String + Send>) -> Self {
        StreamProcessor { ctrl: SessionController::new(cfg, id_gen) }
    }

    pub fn handle(&mut self, mut ev: RawEvent) -> Handled {
        let now = ev.ts_utc_us.max(0) as u64;
        let kind = ev.kind.clone();
        let mut session_events = Vec::new();

        // 1) drive session boundaries on the ORIGINAL text — flag detection must see the
        //    unredacted flag, so this happens before re-redaction.
        match kind.as_str() {
            "session_start" => {
                let label = ev.payload.text.clone().unwrap_or_default();
                session_events = self.ctrl.start_with(ev.session_uuid.clone(), &label, now);
            }
            "session_end" => {
                if let Some(e) = self.ctrl.stop(now, EndReason::Manual) {
                    session_events = e;
                }
            }
            "session_flag" => {}
            "command" => {
                let cmd = ev.payload.cmd.clone().unwrap_or_default();
                session_events = self.ctrl.observe(true, &cmd, "", now);
            }
            "output" | "stdin_masked" => {
                let text = ev.payload.text.clone().unwrap_or_default();
                session_events = self.ctrl.observe(false, &text, "", now);
            }
            _ => {}
        }

        // 2) re-redact for storage (never trust the upstream's scrubbing).
        let mut redacted = false;
        if let Some(t) = ev.payload.text.as_mut() {
            let r = redact(t);
            if &r != t {
                redacted = true;
            }
            *t = r;
        }
        if let Some(c) = ev.payload.cmd.as_mut() {
            let r = redact(c);
            if &r != c {
                redacted = true;
            }
            *c = r;
        }

        // 3) stamp command/output with the active session and hand off for persistence.
        let mut store = None;
        if matches!(kind.as_str(), "command" | "output" | "stdin_masked") {
            if let Some(u) = self.ctrl.active_uuid() {
                ev.session_uuid = u.to_string();
                store = Some(ev);
            }
        }

        Handled { store, session_events, redacted }
    }
}

fn tally(summary: &mut Summary, h: &Handled) {
    if h.redacted {
        summary.redactions += 1;
    }
    for se in &h.session_events {
        match se {
            SessionEvent::Start { .. } => summary.sessions += 1,
            SessionEvent::Flag { .. } => summary.nudges += 1,
            _ => {}
        }
    }
}

pub struct Processed {
    pub summary: Summary,
    pub events: Vec<RawEvent>,
}

/// Batch transform (no DB): the whole stream through one StreamProcessor.
pub fn process(input: Vec<RawEvent>, cfg: SessionConfig, id_gen: Box<dyn FnMut() -> String + Send>) -> Processed {
    let mut sp = StreamProcessor::new(cfg, id_gen);
    let mut summary = Summary::default();
    let mut events = Vec::new();
    for ev in input {
        let h = sp.handle(ev);
        tally(&mut summary, &h);
        if let Some(e) = h.store {
            if e.kind == "command" {
                summary.commands += 1;
            } else {
                summary.outputs += 1;
            }
            events.push(e);
        }
    }
    Processed { summary, events }
}

/// Parse a single §3.3 envelope line (reuses the store's parser; no extra serde dep here).
pub fn parse_event(line: &str) -> Option<RawEvent> {
    parse_ndjson(line).into_iter().next()
}

/// Batch convenience for the CLI: process an NDJSON string and persist into the store.
pub fn ingest_batch_summary(
    ndjson: &str,
    cfg: SessionConfig,
    id_gen: Box<dyn FnMut() -> String + Send>,
    conn: &mut SqlConnection,
) -> Result<Summary, Box<dyn std::error::Error>> {
    let processed = process(parse_ndjson(ndjson), cfg, id_gen);
    ingest(conn, &processed.events)?;
    Ok(processed.summary)
}

/// The single-owner consumer: drains envelopes from the merged channel, persists each to the
/// encrypted store as it arrives, and logs session boundaries live. Returns when all senders drop.
pub fn run_consumer(
    rx: Receiver<RawEvent>,
    mut conn: SqlConnection,
    cfg: SessionConfig,
    id_gen: Box<dyn FnMut() -> String + Send>,
) -> Summary {
    let mut sp = StreamProcessor::new(cfg, id_gen);
    let mut summary = Summary::default();
    for ev in rx {
        let h = sp.handle(ev);
        tally(&mut summary, &h);
        for se in &h.session_events {
            match se {
                SessionEvent::Start { uuid, label, .. } => eprintln!("[daemon] ▶ session_start {uuid} ({label})"),
                SessionEvent::Flag { uuid, .. } => eprintln!("[daemon] ⚑ flag nudge — wrap up {uuid}?"),
                SessionEvent::End { uuid, reason, .. } => eprintln!("[daemon] ■ session_end {uuid} ({})", reason.as_str()),
            }
        }
        if let Some(e) = h.store {
            if e.kind == "command" {
                summary.commands += 1;
            } else {
                summary.outputs += 1;
            }
            let _ = ingest(&mut conn, std::slice::from_ref(&e));
        }
    }
    summary
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use watcher_store::{open, parse_ndjson};

    fn counter() -> Box<dyn FnMut() -> String + Send> {
        let mut n = 0;
        Box::new(move || {
            n += 1;
            format!("sess-{n}")
        })
    }

    const STREAM: &str = r#"{"source":"local_pty","session_uuid":"ext-1","seq":0,"ts_utc_us":1000,"kind":"session_start","payload":{"text":"HTB :: Optimum"}}
{"source":"local_pty","session_uuid":"run-x","seq":1,"ts_utc_us":2000,"kind":"command","payload":{"cmd":"nmap -sV 10.10.10.8"}}
{"source":"local_pty","session_uuid":"run-x","seq":1,"ts_utc_us":3000,"kind":"output","payload":{"stream":"stdout","text":"root.txt 0123456789abcdef0123456789abcdef on 10.10.10.8","line_count":1}}
{"source":"local_pty","session_uuid":"run-x","seq":0,"ts_utc_us":4000,"kind":"session_end","payload":{"text":"manual"}}"#;

    #[test]
    fn re_redacts_stamps_and_nudges() {
        let p = process(parse_ndjson(STREAM), SessionConfig { auto_start: true, ..Default::default() }, counter());
        assert_eq!(p.summary.sessions, 1);
        assert_eq!(p.summary.commands, 1);
        assert_eq!(p.summary.outputs, 1);
        assert_eq!(p.summary.nudges, 1);
        assert!(p.events.iter().all(|e| e.session_uuid == "ext-1"));
        let cmd = p.events.iter().find(|e| e.kind == "command").unwrap();
        assert_eq!(cmd.payload.cmd.as_deref(), Some("nmap -sV x.x.x.x"));
        let out = p.events.iter().find(|e| e.kind == "output").unwrap();
        let text = out.payload.text.as_deref().unwrap();
        assert!(text.contains("[redacted-flag]"));
        assert!(!text.contains("10.10.10.8"));
    }

    #[test]
    fn auto_starts_a_session_for_a_raw_stream() {
        let raw = r#"{"source":"local_pty","session_uuid":"r","seq":1,"ts_utc_us":1,"kind":"command","payload":{"cmd":"whoami"}}"#;
        let p = process(parse_ndjson(raw), SessionConfig { auto_start: true, ..Default::default() }, counter());
        assert_eq!(p.summary.sessions, 1);
        assert_eq!(p.events[0].session_uuid, "sess-1");
    }

    #[test]
    fn consumer_persists_to_the_encrypted_store() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("svc.db");
        let p = path.to_str().unwrap();

        let (tx, rx) = mpsc::channel();
        for ev in parse_ndjson(STREAM) {
            tx.send(ev).unwrap();
        }
        drop(tx); // close the channel so the consumer returns

        let conn = open(p, "k").unwrap();
        let summary = run_consumer(rx, conn, SessionConfig { auto_start: true, ..Default::default() }, counter());
        assert_eq!((summary.commands, summary.outputs, summary.nudges), (1, 1, 1));

        // reopen and confirm the stamped, redacted rows landed
        let conn = open(p, "k").unwrap();
        let stored: i64 = conn.query_row("SELECT count(*) FROM commands WHERE binary='nmap'", [], |r| r.get(0)).unwrap();
        assert_eq!(stored, 1);
        let sid: String = conn.query_row("SELECT uuid FROM sessions LIMIT 1", [], |r| r.get(0)).unwrap();
        assert_eq!(sid, "ext-1");
    }

    const HANDSHAKE: &str = r#"{"watcher_handshake":"1.0","plugin":"aws-cloudshell","class":"source","capabilities":{"has_exit_codes":false,"has_stdin":true,"boundary_confidence":"inferred","redaction":"none"},"context_template":"cloud:aws:cloudshell"}"#;

    #[test]
    fn parses_a_capability_handshake() {
        let hs = parse_handshake(HANDSHAKE).unwrap();
        assert_eq!(hs.plugin, "aws-cloudshell");
        assert_eq!(hs.class, "source");
        assert!(!hs.capabilities.has_exit_codes);
        assert_eq!(hs.capabilities.boundary_confidence, "inferred");
        assert!(parse_handshake(r#"{"source":"plugin","session_uuid":"x","ts_utc_us":1,"kind":"command"}"#).is_none());
    }

    #[test]
    fn capabilities_fill_provenance_the_plugin_omitted() {
        let hs = parse_handshake(HANDSHAKE).unwrap();
        let mut ev = parse_ndjson(r#"{"source":"plugin","session_uuid":"x","seq":1,"ts_utc_us":1,"kind":"command","payload":{"cmd":"aws s3 ls"}}"#)
            .pop()
            .unwrap();
        apply_capabilities(&mut ev, &hs);
        assert_eq!(ev.provenance.context_path.as_deref(), Some("cloud:aws:cloudshell"));
        assert_eq!(ev.provenance.boundary_confidence, Some(0.7)); // "inferred"
        assert_eq!(ev.provenance.platform.as_deref(), Some("aws-cloudshell"));
    }
}
