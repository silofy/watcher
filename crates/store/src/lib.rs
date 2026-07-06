//! The Watcher encrypted store (brief §8). SQLCipher gives transparent AES-256 page
//! encryption — the whole file (indexes, WAL included) is opaque at rest. The daemon is
//! the single owner of this DB; both capture agents feed it the §3.3 telemetry envelope,
//! and it re-redacts on receipt (never trusts an upstream's scrubbing).
//!
//! Key handling here takes a passphrase for the POC; in production the DB key is random,
//! held in the OS keychain (macOS Keychain / Linux Secret Service), and derived with
//! Argon2id — so the file alone is worthless if exfiltrated.

use rusqlite::{Connection, OptionalExtension};
use serde::Deserialize;

/// Re-exported so downstream crates (the daemon) can name the connection type without taking
/// their own rusqlite dependency (which would link SQLCipher twice).
pub use rusqlite::Connection as SqlConnection;

/// The unified telemetry envelope (§3.3), as received from any capture agent.
#[derive(Debug, Deserialize)]
pub struct RawEvent {
    pub source: String,
    pub session_uuid: String,
    #[serde(default)]
    pub seq: i64,
    pub ts_utc_us: i64,
    pub kind: String,
    #[serde(default)]
    pub payload: Payload,
    #[serde(default)]
    pub provenance: Provenance,
}

#[derive(Debug, Default, Deserialize)]
pub struct Payload {
    pub cmd: Option<String>,
    pub exit_code: Option<i64>,
    pub stream: Option<String>,
    pub text: Option<String>,
    pub line_count: Option<i64>,
    // --- web fields (http_request / http_response) ---
    pub method: Option<String>,
    pub url: Option<String>,
    pub status: Option<i64>,
    pub req_headers: Option<String>,
    pub req_body: Option<String>,
    pub resp_headers: Option<String>,
    pub resp_body: Option<String>,
    pub mime: Option<String>,
    pub pair_id: Option<String>,
}

#[derive(Debug, Default, Deserialize)]
pub struct Provenance {
    pub boundary_confidence: Option<f64>,
    pub context_path: Option<String>,
    pub platform: Option<String>,
}

const SCHEMA: &str = r#"
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, started_at INTEGER, ended_at INTEGER,
  shell TEXT, hostname TEXT, initial_cwd TEXT, target_scope TEXT,
  source TEXT, origin_meta TEXT, platform TEXT, schema_ver INTEGER );

CREATE TABLE IF NOT EXISTS commands (
  id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
  seq INTEGER, raw_command TEXT, cwd TEXT, context_path TEXT,
  started_at INTEGER, ended_at INTEGER, duration_ms INTEGER, exit_code INTEGER,
  was_echo_off INTEGER DEFAULT 0, binary TEXT, boundary_confidence REAL,
  phase_id INTEGER, UNIQUE(session_id, seq) );

CREATE TABLE IF NOT EXISTS output_blocks (
  id INTEGER PRIMARY KEY, command_id INTEGER REFERENCES commands(id),
  stream INTEGER, started_at INTEGER, content BLOB, raw_replay BLOB,
  line_count INTEGER, byte_count INTEGER, was_summarized INTEGER DEFAULT 0,
  summary TEXT, fidelity TEXT );

CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY, command_id INTEGER REFERENCES commands(id),
  kind TEXT, value TEXT, confidence REAL, created_at INTEGER );

CREATE TABLE IF NOT EXISTS redactions (
  id INTEGER PRIMARY KEY, command_id INTEGER REFERENCES commands(id),
  location TEXT, rule TEXT, redaction_method TEXT,
  span_start INTEGER, span_len INTEGER, redacted_at INTEGER );

CREATE TABLE IF NOT EXISTS phases (
  id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
  mitre_tactic TEXT, label TEXT, started_at INTEGER, ended_at INTEGER );

CREATE TABLE IF NOT EXISTS http_exchanges (
  id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
  pair_id TEXT, method TEXT, url TEXT, req_headers TEXT, req_body TEXT,
  status INTEGER, resp_headers TEXT, resp_body TEXT, mime TEXT,
  started_at INTEGER, ended_at INTEGER, context_path TEXT,
  UNIQUE(session_id, pair_id) );

CREATE INDEX IF NOT EXISTS idx_cmd_session ON commands(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_cmd_binary  ON commands(binary);
CREATE INDEX IF NOT EXISTS idx_out_cmd     ON output_blocks(command_id);
CREATE INDEX IF NOT EXISTS idx_art_kind    ON artifacts(kind, value);
CREATE INDEX IF NOT EXISTS idx_http_session ON http_exchanges(session_id);
"#;

/// Open (or create) an encrypted DB and ensure the schema exists. The key must be set
/// before any other statement — a wrong key on an existing DB fails here.
pub fn open(path: &str, key: &str) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "key", key)?;
    conn.pragma_update(None, "cipher_compatibility", 4)?; // AES-256-CBC, HMAC-SHA512
    // Force a read so a wrong key fails immediately rather than later.
    conn.query_row("SELECT count(*) FROM sqlite_master", [], |r| r.get::<_, i64>(0))?;
    conn.execute_batch(SCHEMA)?;
    // Additive migration for stores created before platform existed. A fresh DB already has the
    // column (from SCHEMA) so this errors with "duplicate column" — intentionally ignored.
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN platform TEXT", []);
    Ok(conn)
}

fn binary_of(cmd: &str) -> String {
    cmd.trim().split_whitespace().next().unwrap_or("").to_string()
}

/// Ingest a batch of telemetry envelopes into the store, re-joining command + output by
/// (session, seq). Returns (commands_inserted, output_blocks_inserted).
pub fn ingest(conn: &mut Connection, events: &[RawEvent]) -> rusqlite::Result<(usize, usize)> {
    let tx = conn.transaction()?;
    let mut cmds = 0usize;
    let mut outs = 0usize;

    for e in events {
        // upsert the session, get its id
        let session_id: i64 = {
            let existing: Option<i64> = tx
                .query_row("SELECT id FROM sessions WHERE uuid = ?1", [&e.session_uuid], |r| r.get(0))
                .optional()?;
            match existing {
                Some(id) => id,
                None => {
                    tx.execute(
                        "INSERT INTO sessions (uuid, started_at, source, platform, schema_ver) VALUES (?1, ?2, ?3, ?4, 2)",
                        rusqlite::params![e.session_uuid, e.ts_utc_us, e.source, e.provenance.platform],
                    )?;
                    tx.last_insert_rowid()
                }
            }
        };

        match e.kind.as_str() {
            "command" => {
                let cmd = e.payload.cmd.clone().unwrap_or_default();
                tx.execute(
                    "INSERT OR IGNORE INTO commands
                       (session_id, seq, raw_command, started_at, exit_code, binary, boundary_confidence, context_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        session_id,
                        e.seq,
                        cmd,
                        e.ts_utc_us,
                        e.payload.exit_code,
                        binary_of(&cmd),
                        e.provenance.boundary_confidence,
                        e.provenance.context_path,
                    ],
                )?;
                cmds += 1;
            }
            "output" | "stdin_masked" => {
                let command_id: Option<i64> = tx
                    .query_row(
                        "SELECT id FROM commands WHERE session_id = ?1 AND seq = ?2",
                        rusqlite::params![session_id, e.seq],
                        |r| r.get(0),
                    )
                    .optional()?;
                if let Some(cid) = command_id {
                    let text = e.payload.text.clone().unwrap_or_default();
                    tx.execute(
                        "INSERT INTO output_blocks (command_id, started_at, content, line_count, byte_count, fidelity)
                         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                        rusqlite::params![
                            cid,
                            e.ts_utc_us,
                            text,
                            e.payload.line_count,
                            text.len() as i64,
                            if e.kind == "stdin_masked" { "masked" } else { "clean" },
                        ],
                    )?;
                    // also mark the command's end time
                    tx.execute(
                        "UPDATE commands SET ended_at = ?1 WHERE id = ?2",
                        rusqlite::params![e.ts_utc_us, cid],
                    )?;
                    outs += 1;
                }
            }
            "http_request" => {
                tx.execute(
                    "INSERT OR IGNORE INTO http_exchanges
                       (session_id, pair_id, method, url, req_headers, req_body, started_at, context_path)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        session_id, e.payload.pair_id, e.payload.method, e.payload.url,
                        e.payload.req_headers, e.payload.req_body, e.ts_utc_us,
                        e.provenance.context_path,
                    ],
                )?;
            }
            "http_response" => {
                tx.execute(
                    "UPDATE http_exchanges SET status=?1, resp_headers=?2, resp_body=?3, mime=?4, ended_at=?5
                     WHERE session_id=?6 AND pair_id=?7",
                    rusqlite::params![
                        e.payload.status, e.payload.resp_headers, e.payload.resp_body,
                        e.payload.mime, e.ts_utc_us, session_id, e.payload.pair_id,
                    ],
                )?;
            }
            _ => {}
        }
    }

    tx.commit()?;
    Ok((cmds, outs))
}

/// Read back a human-readable summary of an encrypted store (sessions + their commands).
pub fn dump(conn: &Connection) -> rusqlite::Result<String> {
    let mut out = String::new();
    let mut st = conn.prepare("SELECT id, uuid, source FROM sessions ORDER BY id")?;
    let sessions: Vec<(i64, String, Option<String>)> = st
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?
        .collect::<Result<_, _>>()?;
    for (sid, uuid, source) in sessions {
        out.push_str(&format!("session {uuid}  (source={})\n", source.unwrap_or_default()));
        let mut cs = conn.prepare("SELECT seq, binary, exit_code, raw_command FROM commands WHERE session_id = ?1 ORDER BY seq")?;
        let cmds: Vec<(i64, Option<String>, Option<i64>, String)> = cs
            .query_map([sid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?
            .collect::<Result<_, _>>()?;
        for (seq, bin, exit, cmd) in cmds {
            let exit = exit.map(|e| e.to_string()).unwrap_or_else(|| "-".into());
            out.push_str(&format!("  #{seq} [{}] exit={exit}  {cmd}\n", bin.unwrap_or_default()));
        }
    }
    Ok(out)
}

/// Parse a newline-delimited telemetry stream.
pub fn parse_ndjson(s: &str) -> Vec<RawEvent> {
    s.lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|l| serde_json::from_str::<RawEvent>(l).ok())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Read;

    const SAMPLE: &str = r#"{"source":"local_pty","session_uuid":"3de5c2f2-38c5-4014-ac11-e87935b2641e","seq":1,"ts_utc_us":1000,"kind":"command","payload":{"cmd":"nmap -sV 10.0.0.1","exit_code":1},"provenance":{"boundary_confidence":1.0,"context_path":"host"}}
{"source":"local_pty","session_uuid":"3de5c2f2-38c5-4014-ac11-e87935b2641e","seq":1,"ts_utc_us":2000,"kind":"output","payload":{"stream":"stdout","text":"22,80 open","line_count":1}}
{"source":"local_pty","session_uuid":"3de5c2f2-38c5-4014-ac11-e87935b2641e","seq":2,"ts_utc_us":3000,"kind":"command","payload":{"cmd":"sudo -l","exit_code":0},"provenance":{"boundary_confidence":1.0}}"#;

    #[test]
    fn ingests_envelopes_into_schema() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("t.db");
        let p = path.to_str().unwrap();

        let events = parse_ndjson(SAMPLE);
        {
            let mut conn = open(p, "test-key").unwrap();
            let (c, o) = ingest(&mut conn, &events).unwrap();
            assert_eq!((c, o), (2, 1));
        }

        // reopen with the right key and verify the join
        let conn = open(p, "test-key").unwrap();
        let n_cmds: i64 = conn.query_row("SELECT count(*) FROM commands", [], |r| r.get(0)).unwrap();
        assert_eq!(n_cmds, 2);
        let nmap_exit: i64 = conn
            .query_row("SELECT exit_code FROM commands WHERE binary='nmap'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(nmap_exit, 1);
        let out: String = conn
            .query_row(
                "SELECT o.content FROM output_blocks o JOIN commands c ON o.command_id=c.id WHERE c.binary='nmap'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(out, "22,80 open");
    }

    #[test]
    fn file_is_actually_encrypted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("enc.db");
        let p = path.to_str().unwrap();
        {
            let mut conn = open(p, "secret").unwrap();
            ingest(&mut conn, &parse_ndjson(SAMPLE)).unwrap();
        }
        // The file must NOT start with the plaintext SQLite magic header.
        let mut head = [0u8; 16];
        std::fs::File::open(p).unwrap().read_exact(&mut head).unwrap();
        assert_ne!(&head, b"SQLite format 3\0");
    }

    #[test]
    fn wrong_key_is_rejected() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("k.db");
        let p = path.to_str().unwrap();
        {
            let mut conn = open(p, "correct-horse").unwrap();
            ingest(&mut conn, &parse_ndjson(SAMPLE)).unwrap();
        }
        assert!(open(p, "wrong-key").is_err());
    }

    #[test]
    fn parses_http_envelope_fields() {
        let line = r#"{"source":"plugin","session_uuid":"s1","seq":5,"ts_utc_us":10,"kind":"http_request","payload":{"method":"POST","url":"http://t/login?id=1","pair_id":"p1","req_body":"u=a&p=b"}}"#;
        let evs = parse_ndjson(line);
        assert_eq!(evs.len(), 1);
        assert_eq!(evs[0].kind, "http_request");
        assert_eq!(evs[0].payload.method.as_deref(), Some("POST"));
        assert_eq!(evs[0].payload.pair_id.as_deref(), Some("p1"));
    }

    #[test]
    fn ingests_http_exchange_pair() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db"); let p = p.to_str().unwrap();
        let mut conn = open(p, "k").unwrap();
        let stream = r#"{"source":"plugin","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"http_request","payload":{"method":"POST","url":"http://t/login","pair_id":"p1","req_body":"u=a"}}
{"source":"plugin","session_uuid":"s1","seq":2,"ts_utc_us":200,"kind":"http_response","payload":{"status":200,"pair_id":"p1","resp_body":"welcome","mime":"text/html"}}"#;
        ingest(&mut conn, &parse_ndjson(stream)).unwrap();
        let (method, status, body): (String, i64, String) = conn.query_row(
            "SELECT method, status, resp_body FROM http_exchanges WHERE pair_id='p1'", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!(method, "POST");
        assert_eq!(status, 200);
        assert_eq!(body, "welcome");
    }

    #[test]
    fn persists_platform_on_session() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("t.db"); let p = p.to_str().unwrap();
        let mut conn = open(p, "k").unwrap();
        let line = r#"{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"id"},"provenance":{"platform":"htb","context_path":"host"}}"#;
        ingest(&mut conn, &parse_ndjson(line)).unwrap();
        let plat: Option<String> = conn.query_row(
            "SELECT platform FROM sessions WHERE uuid='s1'", [], |r| r.get(0)).unwrap();
        assert_eq!(plat.as_deref(), Some("htb"));
    }
}
