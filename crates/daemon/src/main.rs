//! watcher-daemon — the single SQLCipher owner. Two modes:
//!
//!   --listen <addr>        long-running service: accept plugin/agent connections (newline-JSON
//!                          §3.3 envelopes) on a TCP socket, persist live. The standalone daemon.
//!   (default)              batch: read NDJSON from --ndjson/stdin, persist, print a summary.
//!
//! Both share one pipeline: re-redact → SessionController → stamp → encrypted store.

use std::io::{BufRead, BufReader, Read};
use std::net::TcpListener;
use std::sync::mpsc;
use std::thread;

use uuid::Uuid;
use watcher_core::SessionConfig;
use std::sync::mpsc::Sender;

use watcher_daemon::{
    apply_capabilities, ingest_batch_summary, parse_event, parse_handshake, run_consumer,
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
    let db = arg("--db").ok_or("missing --db <path>")?;
    let key = arg("--key").unwrap_or_else(|| "watcher-dev-key".to_string());

    if let Some(addr) = arg("--listen") {
        serve(&addr, &db, &key)
    } else {
        batch(&db, &key)
    }
}
