//! watcher-daemon — the single SQLCipher owner. Three modes:
//!
//!   --listen <addr>        long-running service: accept plugin/agent connections (newline-JSON
//!                          §3.3 envelopes) on a TCP socket, persist live. The standalone daemon.
//!   --native-messaging     Chrome Native Messaging host (u32-LE framed stdin) — how the browser
//!                          extension connects.
//!   (default)              batch: read NDJSON from --ndjson/stdin, persist, print a summary.
//!
//! All three share one pipeline: re-redact → SessionController → stamp → encrypted store.

use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use uuid::Uuid;
use watcher_core::SessionConfig;
use std::sync::mpsc::Sender;

use watcher_daemon::{
    apply_capabilities, ingest_batch_summary, parse_event, parse_handshake, read_nm_message, run_consumer,
    StreamProcessor,
};
use watcher_store::{open, RawEvent};

fn arg(name: &str) -> Option<String> {
    let a: Vec<String> = std::env::args().collect();
    a.iter().position(|x| x == name).and_then(|i| a.get(i + 1).cloned())
}

fn cfg() -> SessionConfig {
    SessionConfig { auto_start: true, ..Default::default() }
}
fn gen() -> Box<dyn FnMut() -> String + Send> {
    Box::new(|| Uuid::new_v4().to_string())
}

/// One plugin/agent connection: an optional leading capability handshake, then §3.3 envelopes
/// (newline-JSON). The handshake fills provenance the plugin can't provide (brief §5.4).
fn handle_connection<R: BufRead>(reader: R, tx: Sender<RawEvent>) {
    let mut hs = None;
    let mut first = true;
    for line in reader.lines().map_while(Result::ok) {
        if first {
            first = false;
            if let Some(h) = parse_handshake(&line) {
                eprintln!(
                    "[daemon] ⌁ plugin '{}' ({}) — exit_codes={} stdin={} boundary={} redaction={}",
                    h.plugin, h.class, h.capabilities.has_exit_codes, h.capabilities.has_stdin,
                    h.capabilities.boundary_confidence, h.capabilities.redaction
                );
                hs = Some(h);
                continue;
            }
        }
        if let Some(mut ev) = parse_event(&line) {
            if let Some(h) = &hs {
                apply_capabilities(&mut ev, h);
            }
            let _ = tx.send(ev);
        }
    }
}

/// Long-running TCP service. One consumer owns the store; each connection is a source thread.
fn serve(addr: &str, db: &str, key: &str) -> Result<(), Box<dyn std::error::Error>> {
    let listener = TcpListener::bind(addr)?;
    eprintln!("[watcher-daemon] listening on {addr} → {db} (newline-JSON §3.3 envelopes)");

    let (tx, rx) = mpsc::channel::<RawEvent>();
    let conn = open(db, key)?;
    let consumer = thread::spawn(move || run_consumer(rx, conn, cfg(), gen()));

    for stream in listener.incoming() {
        let stream = match stream {
            Ok(s) => s,
            Err(_) => continue,
        };
        let tx = tx.clone();
        thread::spawn(move || handle_connection(BufReader::new(stream), tx));
    }

    drop(tx);
    let _ = consumer.join();
    Ok(())
}

fn iso_micros(ts_us: i64) -> String {
    chrono::DateTime::from_timestamp_micros(ts_us).map(|d| d.to_rfc3339()).unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

/// A minimal, schema-shaped report for a just-spawned box (no episodes yet) — the live bridge the
/// report window polls. Rewritten when identity (name/avatar) lands via session_enrich.
fn write_live_report(dir: &std::path::Path, v: &serde_json::Value, recording: bool) {
    let uuid = v.get("session_uuid").and_then(|x| x.as_str()).unwrap_or("live").to_string();
    let started = iso_micros(v.get("ts_utc_us").and_then(|x| x.as_i64()).unwrap_or(0));
    let target = v.get("target_scope").and_then(|x| x.as_str()).unwrap_or("Live session").to_string();
    let machine = v.get("machine").cloned().unwrap_or(serde_json::Value::Null);
    let report = serde_json::json!({
        "schema_version": "1.0",
        "session": { "uuid": uuid, "started_at": started, "ended_at": started, "target_scope": target,
                     "context_path": "cloud:htb:pwnbox", "shell": "", "source": "browser_ext", "machine": machine },
        "episodes": [], "phases": [], "golden_dag": [],
        "metrics": { "efficiency_pct": 0, "time_waster": { "productive_ms": 0, "detour_ms": 0, "stuck_ms": 0, "loop_ms": 0, "t_active_ms": 0 },
                     "stealth_score": 100, "objective_coverage_pct": 0, "technique_breadth": 0 },
        "coaching": { "skill_radar": { "recon": 0, "web": 0, "exploit": 0, "privesc": 0, "opsec": 0 },
                      "next_steps": [{ "action": "Recording. Capture commands by SSHing from a watched terminal, or run the in-VM agent inside the box.", "why": "", "category": "Recap", "evidence_seq": null }] },
        "redaction_profile": "full",
        "recording": recording
    });
    let _ = std::fs::create_dir_all(dir);
    let _ = std::fs::write(dir.join(format!("{uuid}.json")), serde_json::to_string_pretty(&report).unwrap_or_default());
}

/// Fetch a write-up by URL (presigned S3 PDF, or an HTML page) and return its text. The presigned
/// URL needs no auth; SChannel (native-tls) handles HTTPS without an OpenSSL/ring build.
fn fetch_writeup_text(url: &str) -> Option<String> {
    use std::io::Read;
    let tls = native_tls::TlsConnector::new().ok()?;
    let agent = ureq::builder().tls_connector(std::sync::Arc::new(tls)).build();
    let resp = agent.get(url).call().ok()?;
    let ct = resp.header("content-type").unwrap_or("").to_lowercase();
    let mut bytes = Vec::new();
    resp.into_reader().take(25_000_000).read_to_end(&mut bytes).ok()?;
    if ct.contains("pdf") || url.to_lowercase().contains(".pdf") {
        pdf_extract::extract_text_from_mem(&bytes).ok()
    } else {
        Some(String::from_utf8_lossy(&bytes).into_owned())
    }
}

/// Merge a write-up the extension pulled from HTB into the live report (Layer-2 source). The
/// extension sends either inline `text` (community HTML, already stripped) or a `url` (presigned-S3
/// official PDF) we fetch + extract here. The app auto-extracts a golden DAG from `writeup_text`.
fn merge_writeup(dir: &std::path::Path, v: &serde_json::Value) {
    let uuid = v.get("session_uuid").and_then(|x| x.as_str()).unwrap_or("live").to_string();
    let mut text = v.get("text").and_then(|x| x.as_str()).unwrap_or("").to_string();
    if text.trim().is_empty() {
        if let Some(url) = v.get("url").and_then(|x| x.as_str()) {
            text = fetch_writeup_text(url).unwrap_or_default();
        }
    }
    if text.trim().is_empty() {
        return;
    }
    let path = dir.join(format!("{uuid}.json"));
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Ok(mut r) = serde_json::from_str::<serde_json::Value>(&s) {
            r["writeup_text"] = serde_json::json!(text);
            let _ = std::fs::write(&path, serde_json::to_string_pretty(&r).unwrap_or_default());
        }
    }
}

/// Flip an existing live report to ended (recording = false) on session_end.
fn end_live_report(dir: &std::path::Path, v: &serde_json::Value) {
    let uuid = v.get("session_uuid").and_then(|x| x.as_str()).unwrap_or("live").to_string();
    let path = dir.join(format!("{uuid}.json"));
    if let Ok(s) = std::fs::read_to_string(&path) {
        if let Ok(mut r) = serde_json::from_str::<serde_json::Value>(&s) {
            r["recording"] = serde_json::json!(false);
            r["session"]["ended_at"] = serde_json::json!(chrono::Utc::now().to_rfc3339());
            let _ = std::fs::write(&path, serde_json::to_string_pretty(&r).unwrap_or_default());
        }
    }
}

/// Chrome Native Messaging host: one envelope per framed message on stdin. Chrome owns this
/// process's stdio and hides its stderr, so we also append a human-readable line per message to a
/// log file you can `tail` to watch the extension's spawns arrive.
fn native_messaging(db: &str, key: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::io::Write as _;
    let log_path = std::env::temp_dir().join("watcher-daemon.log");
    let mut log = std::fs::OpenOptions::new().create(true).append(true).open(&log_path).ok();
    let mut logln = |s: &str| {
        if let Some(f) = log.as_mut() {
            let _ = writeln!(f, "{s}");
            let _ = f.flush();
        }
    };
    logln(&format!("[watcher-daemon] native-messaging host up -> {db}"));

    // live-bridge: per-spawn report files the report window polls (sibling 'sessions' dir of the db)
    let sessions_dir = std::path::Path::new(db)
        .parent()
        .map(|p| p.join("sessions"))
        .unwrap_or_else(|| std::env::temp_dir().join("watcher-sessions"));

    let mut conn = open(db, key)?;
    let mut sp = StreamProcessor::new(cfg(), gen());
    let mut stdin = std::io::stdin().lock();
    while let Some(msg) = read_nm_message(&mut stdin)? {
        let trimmed: String = msg.chars().take(180).collect();
        logln(&format!("recv {trimmed}"));

        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&msg) {
            match v.get("kind").and_then(|k| k.as_str()) {
                Some("session_start") | Some("session_enrich") => {
                    write_live_report(&sessions_dir, &v, true);
                    logln("  wrote live report");
                }
                Some("session_end") => end_live_report(&sessions_dir, &v),
                Some("writeup") => {
                    merge_writeup(&sessions_dir, &v);
                    logln("  merged write-up");
                }
                _ => {}
            }
        }

        if let Some(ev) = parse_event(&msg) {
            let h = sp.handle(ev);
            for se in &h.session_events {
                logln(&format!("  → {se:?}"));
            }
            if let Some(e) = h.store {
                let _ = watcher_store::ingest(&mut conn, std::slice::from_ref(&e));
            }
        }
    }
    Ok(())
}

fn batch(db: &str, key: &str) -> Result<(), Box<dyn std::error::Error>> {
    let input = match arg("--ndjson") {
        Some(p) => std::fs::read_to_string(p)?,
        None => {
            let mut s = String::new();
            std::io::stdin().read_to_string(&mut s)?;
            s
        }
    };
    let mut conn = open(db, key)?;
    let s = ingest_batch_summary(&input, cfg(), gen(), &mut conn)?;
    eprintln!(
        "[watcher-daemon] {db}: {} session(s), {} commands + {} outputs stored, {} re-redactions, {} flag nudge(s) (AES-256)",
        s.sessions, s.commands, s.outputs, s.redactions, s.nudges
    );
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Self-test: extract text from a local PDF (proves the write-up PDF→text path, no network).
    if let Some(p) = arg("--extract-pdf") {
        let bytes = std::fs::read(&p)?;
        let text = pdf_extract::extract_text_from_mem(&bytes)?;
        println!("--- extracted {} chars ---\n{}", text.len(), text);
        return Ok(());
    }

    let db = arg("--db").ok_or("missing --db <path>")?;
    let key = arg("--key").unwrap_or_else(|| "watcher-dev-key".to_string());

    if let Some(addr) = arg("--listen") {
        serve(&addr, &db, &key)
    } else if std::env::args().any(|a| a == "--native-messaging") {
        native_messaging(&db, &key)
    } else {
        batch(&db, &key)
    }
}
