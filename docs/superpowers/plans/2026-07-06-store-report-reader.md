# Store→Report Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the SQLCipher store drive a full graded report by adding a Rust `export_envelopes` that reconstructs the §3.3 NDJSON stream from the store's rows and feeds the existing TS report pipeline.

**Architecture:** The store is Rust's domain and the deterministic report pipeline lives in TS and is already proven, so the seam is a Rust exporter → §3.3 NDJSON → the existing `parseEnvelopes → envelopesToRawCommands → assembleReport`. No report logic is duplicated. An additive `platform` column makes the store self-describing so the export is faithful.

**Tech Stack:** Rust (`rusqlite`/SQLCipher, `serde`/`serde_json`), TypeScript (vite-node script, Vitest).

## Global Constraints

- **Additive & backward-compatible:** the only schema change is a new nullable `sessions.platform` column added via `SCHEMA` + a guarded idempotent `ALTER TABLE`; existing stores open unchanged and the existing file-based `ingest` path is untouched.
- **Determinism:** `export_envelopes` is a pure function of the rows; identical store → identical NDJSON via a stable `ORDER BY ts_utc_us, seq`.
- **Reuse the pipeline:** store → §3.3 NDJSON → the *existing* `assembleReport`. No re-implementation of segmentation/MITRE/CWE/metrics in Rust.
- **Redaction:** rows were redacted at ingest; the exporter does NOT re-redact. Downstream `redactText` still runs (idempotent on already-masked text).
- **Session selection:** explicit `--session <uuid>`, else the most-recently-started session.
- **Key handling:** existing `--key` mechanism only (default `watcher-dev-key`). No keychain.
- **Green gate (every task):** `npm test`, `npm run typecheck`, `npm run build`, and `cargo test` (store crate) all pass; output pristine.
- **Non-goals:** do not retire the NDJSON tee, change capture/bridge defaults, add multi-session merge, or make store-driven reports the app default.

---

## File Structure

- `crates/store/src/lib.rs` — add `platform` to `sessions` (SCHEMA + migration in `open()`), persist it at ingest, `Serialize` on `RawEvent`/`Payload`/`Provenance`, and `export_envelopes` + `export_ndjson`.
- `crates/store/src/main.rs` — a `--export [--session <uuid>]` CLI dispatch.
- `crates/store/tests/export_cli.rs` — integration test running the built binary's `--export`.
- `scripts/ingest-capture.tsx` — a `--from-store --db/--key/--session` mode that spawns the exporter and feeds the existing pipeline.
- `src/lib/pipeline/from-store.test.ts` — a TS test proving a store-export-shaped NDJSON grades to a web episode with CWE.
- `package.json` — a `report:from-store` script.
- `docs/store-report.md` — the flow + the manual two-step pipe + the observable verify walkthrough.

---

## Task 1: Store self-describing — persist `platform`

**Files:**
- Modify: `crates/store/src/lib.rs` (`SCHEMA` sessions table; `open()`; the sessions `INSERT` at ~line 139)
- Test: inline `#[cfg(test)]`

**Interfaces:**
- Produces: `sessions.platform TEXT` (nullable) is persisted from `RawEvent.provenance.platform` at ingest; `open()` idempotently migrates pre-existing stores. `schema_ver` for new sessions is `2`.

- [ ] **Step 1: Write the failing test**

In `crates/store/src/lib.rs` tests module:

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-store persists_platform_on_session`
Expected: FAIL — `no such column: platform`.

- [ ] **Step 3: Add the column, migration, and persist it**

In `SCHEMA`, add `platform TEXT` to the sessions table:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY, uuid TEXT UNIQUE, started_at INTEGER, ended_at INTEGER,
  shell TEXT, hostname TEXT, initial_cwd TEXT, target_scope TEXT,
  source TEXT, origin_meta TEXT, platform TEXT, schema_ver INTEGER );
```

In `open()`, after `conn.execute_batch(SCHEMA)?;`, add the idempotent migration:

```rust
    conn.execute_batch(SCHEMA)?;
    // Additive migration for stores created before platform existed. A fresh DB already has the
    // column (from SCHEMA) so this errors with "duplicate column" — intentionally ignored.
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN platform TEXT", []);
    Ok(conn)
```

Change the sessions `INSERT` (currently `INSERT INTO sessions (uuid, started_at, source, schema_ver) VALUES (?1, ?2, ?3, 1)`) to:

```rust
                    tx.execute(
                        "INSERT INTO sessions (uuid, started_at, source, platform, schema_ver) VALUES (?1, ?2, ?3, ?4, 2)",
                        rusqlite::params![e.session_uuid, e.ts_utc_us, e.source, e.provenance.platform],
                    )?;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p watcher-store persists_platform_on_session`
Expected: PASS.

- [ ] **Step 5: Run the store suite**

Run: `cargo test -p watcher-store`
Expected: PASS (existing tests unaffected).

- [ ] **Step 6: Commit**

```bash
git add crates/store/src/lib.rs
git commit -m "feat(store): persist session platform (additive column + guarded migration)"
```

---

## Task 2: `export_envelopes` — reconstruct the §3.3 stream

**Files:**
- Modify: `crates/store/src/lib.rs` (add `Serialize`; add `export_envelopes` + `export_ndjson`)
- Test: inline `#[cfg(test)]`

**Interfaces:**
- Consumes: the store schema incl. `platform` (Task 1), `RawEvent`/`Payload`/`Provenance`.
- Produces:
  - `pub fn export_envelopes(conn: &Connection, session: Option<&str>) -> rusqlite::Result<Vec<RawEvent>>`
  - `pub fn export_ndjson(conn: &Connection, session: Option<&str>) -> Result<String, Box<dyn std::error::Error>>`
  - `RawEvent`/`Payload`/`Provenance` also derive `Serialize` with `#[serde(skip_serializing_if = "Option::is_none")]` on every `Option` field.

- [ ] **Step 1: Write the failing test**

```rust
#[test]
fn export_roundtrips_commands_output_and_http() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("t.db"); let p = p.to_str().unwrap();
    let mut conn = open(p, "k").unwrap();
    let stream = r#"{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"id","exit_code":0},"provenance":{"platform":"htb","context_path":"host","boundary_confidence":1.0}}
{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":150,"kind":"output","payload":{"stream":"stdout","text":"uid=0","line_count":1}}
{"source":"plugin","session_uuid":"s1","seq":2,"ts_utc_us":200,"kind":"http_request","payload":{"method":"GET","url":"http://t/a","pair_id":"p1"},"provenance":{"context_path":"web:burp"}}
{"source":"plugin","session_uuid":"s1","seq":3,"ts_utc_us":250,"kind":"http_response","payload":{"status":200,"resp_body":"ok","pair_id":"p1"}}"#;
    ingest(&mut conn, &parse_ndjson(stream)).unwrap();

    let evs = export_envelopes(&conn, None).unwrap(); // None => latest session
    let kinds: Vec<&str> = evs.iter().map(|e| e.kind.as_str()).collect();
    assert_eq!(kinds, vec!["command", "output", "http_request", "http_response"]); // ts-ordered
    let cmd = evs.iter().find(|e| e.kind == "command").unwrap();
    assert_eq!(cmd.payload.cmd.as_deref(), Some("id"));
    assert_eq!(cmd.provenance.platform.as_deref(), Some("htb")); // platform round-trips
    let req = evs.iter().find(|e| e.kind == "http_request").unwrap();
    assert_eq!(req.payload.pair_id.as_deref(), Some("p1"));
    let resp = evs.iter().find(|e| e.kind == "http_response").unwrap();
    assert_eq!(resp.payload.status, Some(200));

    // NDJSON serialization is parseable and omits None fields
    let nd = export_ndjson(&conn, None).unwrap();
    assert_eq!(nd.lines().count(), 4);
    assert!(!nd.contains("\"cmd\":null"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-store export_roundtrips`
Expected: FAIL — `cannot find function export_envelopes`.

- [ ] **Step 3: Add `Serialize` to the types**

Change the derives and add skip-serializing to keep emitted JSON clean:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, Serialize)]
pub struct RawEvent { /* unchanged fields */ }

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Payload {
    #[serde(skip_serializing_if = "Option::is_none")] pub cmd: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub exit_code: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub stream: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub text: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub line_count: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub method: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub status: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub req_headers: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub req_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub resp_headers: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub resp_body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub mime: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub pair_id: Option<String>,
}

#[derive(Debug, Default, Deserialize, Serialize)]
pub struct Provenance {
    #[serde(skip_serializing_if = "Option::is_none")] pub boundary_confidence: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")] pub context_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")] pub platform: Option<String>,
}
```

(Keep the existing `#[serde(default)]` on `RawEvent.seq/payload/provenance`.)

- [ ] **Step 4: Implement `export_envelopes` + `export_ndjson`**

Add to `crates/store/src/lib.rs`:

```rust
/// Reconstruct the §3.3 envelope stream for one session (explicit uuid, or the most-recently-started
/// session when `None`), time-ordered. Rows were redacted at ingest, so this does not re-redact.
pub fn export_envelopes(conn: &Connection, session: Option<&str>) -> rusqlite::Result<Vec<RawEvent>> {
    let (session_id, uuid, source, platform): (i64, String, Option<String>, Option<String>) = match session {
        Some(u) => conn.query_row(
            "SELECT id, uuid, source, platform FROM sessions WHERE uuid = ?1",
            [u], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?,
        None => conn.query_row(
            "SELECT id, uuid, source, platform FROM sessions ORDER BY started_at DESC, id DESC LIMIT 1",
            [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?,
    };
    let platform = platform.unwrap_or_else(|| "local".into());
    let src = source.unwrap_or_else(|| "local_pty".into());
    let mut events: Vec<RawEvent> = Vec::new();

    let mut cs = conn.prepare(
        "SELECT seq, raw_command, started_at, exit_code, boundary_confidence, context_path
         FROM commands WHERE session_id = ?1 ORDER BY started_at, seq")?;
    for row in cs.query_map([session_id], |r| Ok((
        r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, i64>(2)?,
        r.get::<_, Option<i64>>(3)?, r.get::<_, Option<f64>>(4)?, r.get::<_, Option<String>>(5)?,
    )))? {
        let (seq, cmd, ts, exit, conf, ctx) = row?;
        events.push(RawEvent {
            source: src.clone(), session_uuid: uuid.clone(), seq, ts_utc_us: ts, kind: "command".into(),
            payload: Payload { cmd: Some(cmd), exit_code: exit, ..Default::default() },
            provenance: Provenance { boundary_confidence: conf, context_path: ctx, platform: Some(platform.clone()) },
        });
    }

    let mut os = conn.prepare(
        "SELECT c.seq, o.content, o.line_count, o.started_at, o.fidelity
         FROM output_blocks o JOIN commands c ON o.command_id = c.id WHERE c.session_id = ?1")?;
    for row in os.query_map([session_id], |r| Ok((
        r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, Option<i64>>(2)?,
        r.get::<_, i64>(3)?, r.get::<_, Option<String>>(4)?,
    )))? {
        let (seq, content, lc, ts, fidelity) = row?;
        let masked = fidelity.as_deref() == Some("masked");
        events.push(RawEvent {
            source: src.clone(), session_uuid: uuid.clone(), seq, ts_utc_us: ts,
            kind: if masked { "stdin_masked".into() } else { "output".into() },
            payload: Payload { stream: Some("stdout".into()), text: Some(content), line_count: lc, ..Default::default() },
            provenance: Provenance { boundary_confidence: None, context_path: None, platform: Some(platform.clone()) },
        });
    }

    let mut hs = conn.prepare(
        "SELECT pair_id, method, url, req_headers, req_body, status, resp_headers, resp_body, mime, started_at, ended_at, context_path
         FROM http_exchanges WHERE session_id = ?1")?;
    for row in hs.query_map([session_id], |r| Ok((
        r.get::<_, Option<String>>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, Option<String>>(2)?,
        r.get::<_, Option<String>>(3)?, r.get::<_, Option<String>>(4)?, r.get::<_, Option<i64>>(5)?,
        r.get::<_, Option<String>>(6)?, r.get::<_, Option<String>>(7)?, r.get::<_, Option<String>>(8)?,
        r.get::<_, Option<i64>>(9)?, r.get::<_, Option<i64>>(10)?, r.get::<_, Option<String>>(11)?,
    )))? {
        let (pair_id, method, url, req_h, req_b, status, resp_h, resp_b, mime, started, ended, ctx) = row?;
        let start = started.unwrap_or(0);
        events.push(RawEvent {
            source: "plugin".into(), session_uuid: uuid.clone(), seq: 0, ts_utc_us: start, kind: "http_request".into(),
            payload: Payload { pair_id: pair_id.clone(), method, url, req_headers: req_h, req_body: req_b, ..Default::default() },
            provenance: Provenance { boundary_confidence: Some(1.0), context_path: ctx.clone(), platform: Some(platform.clone()) },
        });
        events.push(RawEvent {
            source: "plugin".into(), session_uuid: uuid.clone(), seq: 0, ts_utc_us: ended.unwrap_or(start), kind: "http_response".into(),
            payload: Payload { pair_id, status, resp_headers: resp_h, resp_body: resp_b, mime, ..Default::default() },
            provenance: Provenance { boundary_confidence: Some(1.0), context_path: ctx, platform: Some(platform.clone()) },
        });
    }

    events.sort_by(|a, b| a.ts_utc_us.cmp(&b.ts_utc_us).then(a.seq.cmp(&b.seq)));
    Ok(events)
}

/// Serialize the exported stream as NDJSON (one §3.3 envelope per line).
pub fn export_ndjson(conn: &Connection, session: Option<&str>) -> Result<String, Box<dyn std::error::Error>> {
    let mut out = String::new();
    for e in export_envelopes(conn, session)? {
        out.push_str(&serde_json::to_string(&e)?);
        out.push('\n');
    }
    Ok(out)
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p watcher-store export_roundtrips && cargo test -p watcher-store`
Expected: PASS (all store tests).

- [ ] **Step 6: Commit**

```bash
git add crates/store/src/lib.rs
git commit -m "feat(store): export_envelopes reconstructs the §3.3 stream from stored rows"
```

---

## Task 3: `watcher-store --export` CLI + integration test

**Files:**
- Modify: `crates/store/src/main.rs`
- Create: `crates/store/tests/export_cli.rs`

**Interfaces:**
- Consumes: `export_ndjson` (Task 2), the existing `open`/`arg` in `main.rs`.
- Produces: `watcher-store --db <p> --key <k> --export [--session <uuid>]` prints reconstructed NDJSON to stdout and exits before the ingest path.

- [ ] **Step 1: Write the failing integration test** `crates/store/tests/export_cli.rs`:

```rust
use std::process::Command;

#[test]
fn export_cli_prints_ndjson() {
    let dir = tempfile::tempdir().unwrap();
    let db = dir.path().join("t.db");
    let db = db.to_str().unwrap();
    let bin = env!("CARGO_BIN_EXE_watcher-store");

    // ingest a command via stdin
    let stream = r#"{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"whoami"},"provenance":{"platform":"htb"}}"#;
    let mut ingest = Command::new(bin).args(["--db", db, "--key", "k"])
        .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::null())
        .spawn().unwrap();
    use std::io::Write;
    ingest.stdin.take().unwrap().write_all(stream.as_bytes()).unwrap();
    assert!(ingest.wait().unwrap().success());

    // export
    let out = Command::new(bin).args(["--db", db, "--key", "k", "--export"]).output().unwrap();
    assert!(out.status.success());
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert!(stdout.contains("\"kind\":\"command\""));
    assert!(stdout.contains("\"cmd\":\"whoami\""));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-store --test export_cli`
Expected: FAIL — the `--export` output is empty / the binary runs the ingest path instead.

- [ ] **Step 3: Add the `--export` dispatch** in `crates/store/src/main.rs`, after `open()` and before the ingest/`--dump` logic:

```rust
    if std::env::args().any(|a| a == "--export") {
        let session = arg("--session");
        print!("{}", watcher_store::export_ndjson(&conn, session.as_deref())?);
        return Ok(());
    }
```

(Import path: `export_ndjson` is `pub` in the crate lib; reference it as `watcher_store::export_ndjson` matching the existing `use watcher_store::{...}` style — add it to that `use` if preferred. `main`'s return type is `Result<(), Box<dyn std::error::Error>>`, which absorbs `export_ndjson`'s error type via `?`.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p watcher-store --test export_cli`
Expected: PASS.

- [ ] **Step 5: Run the store suite**

Run: `cargo test -p watcher-store`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/store/src/main.rs crates/store/tests/export_cli.rs
git commit -m "feat(store): --export CLI mode prints reconstructed NDJSON"
```

---

## Task 4: `--from-store` report generation

**Files:**
- Modify: `scripts/ingest-capture.tsx`
- Modify: `package.json` (add `report:from-store`)
- Create: `src/lib/pipeline/from-store.test.ts`

**Interfaces:**
- Consumes: `watcher-store --export` (Task 3); the existing `parseEnvelopes`/`envelopesToRawCommands`/`assembleReport`.
- Produces: `vite-node scripts/ingest-capture.tsx --from-store --db <p> [--key <k>] [--session <uuid>]` builds a report from the store; npm `report:from-store`.

- [ ] **Step 1: Write the failing test** `src/lib/pipeline/from-store.test.ts` (proves a store-export-shaped stream grades to a web episode — the downstream guarantee):

```ts
import { describe, it, expect } from "vitest";
import { parseEnvelopes, envelopesToRawCommands } from "./ingest";
import { runPipeline } from "./index";

describe("store-exported stream grades to episodes", () => {
  it("produces a web episode with CWE from an exported NDJSON", () => {
    // Shape emitted by `watcher-store --export`: a command + an http exchange pair.
    const nd = [
      `{"source":"local_pty","session_uuid":"s1","seq":1,"ts_utc_us":100,"kind":"command","payload":{"cmd":"nmap -sV t"},"provenance":{"platform":"htb"}}`,
      `{"source":"plugin","session_uuid":"s1","seq":0,"ts_utc_us":200,"kind":"http_request","payload":{"method":"GET","url":"http://t/item?id=1'","pair_id":"p1"},"provenance":{"context_path":"web:burp"}}`,
      `{"source":"plugin","session_uuid":"s1","seq":0,"ts_utc_us":250,"kind":"http_response","payload":{"status":500,"resp_body":"SQL syntax error","pair_id":"p1"}}`,
    ].join("\n");
    const raw = envelopesToRawCommands(parseEnvelopes(nd));
    const { episodes } = runPipeline(raw, { golden: [] });
    const web = episodes.find((e) => e.context_path === "web:burp");
    expect(web).toBeDefined();
    expect(web!.frameworks?.cwe).toContain("CWE-89");
  });
});
```

- [ ] **Step 2: Run test to verify it fails / passes**

Run: `npx vitest run src/lib/pipeline/from-store.test.ts`
Expected: this asserts the downstream contract; if the pipeline already grades it, it PASSES on first run (a regression guard for the store→report path). If it fails, the pipeline is not honoring web episodes and must be fixed before wiring — but Web Capture Phase 1 makes it pass.

- [ ] **Step 3: Wire `--from-store` in `scripts/ingest-capture.tsx`**

Add the import at the top:

```ts
import { execFileSync } from "node:child_process";
```

Replace the block that sets `ndjsonText` (the `let ndjsonText = readFileSync(ndjsonPath, "utf8");` and the web-sink merge that follows) with:

```ts
function ndjsonFromStore(): string {
  const db = arg("db", "");
  if (!db) { console.error("--from-store requires --db <path>"); process.exit(1); }
  const key = arg("key", "watcher-dev-key");
  const session = arg("session", "");
  const candidates = [
    resolve("crates/store/target/release/watcher-store"),
    resolve("crates/store/target/debug/watcher-store"),
    resolve("target/release/watcher-store"),
    resolve("target/debug/watcher-store"),
  ];
  const bin = candidates.find((c) => existsSync(c));
  if (!bin) { console.error("watcher-store not built. Run: cargo build -p watcher-store --release"); process.exit(1); }
  const a = ["--db", db, "--key", key, "--export"];
  if (session) a.push("--session", session);
  try {
    return execFileSync(bin, a, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    console.error(`watcher-store --export failed (bad db/key?):\n${(e as Error).message}`);
    process.exit(1);
  }
}

let ndjsonText: string;
if (process.argv.includes("--from-store")) {
  ndjsonText = ndjsonFromStore();
} else {
  ndjsonText = readFileSync(ndjsonPath, "utf8");
  if (existsSync(webNdjsonPath)) {
    const webText = readFileSync(webNdjsonPath, "utf8");
    ndjsonText = ndjsonText.replace(/\n?$/, "\n") + webText;
  }
}
```

(This preserves the existing file-based behavior exactly when `--from-store` is absent, including the web-sink merge. Do not remove the surrounding `assembleReport` call that consumes `ndjsonText`.)

- [ ] **Step 4: Add the npm script** to `package.json` `scripts`:

```json
    "report:from-store": "vite-node scripts/ingest-capture.tsx --from-store",
```

- [ ] **Step 5: Run the gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS (the new test green; existing ingest behavior unchanged).

- [ ] **Step 6: Commit**

```bash
git add scripts/ingest-capture.tsx package.json src/lib/pipeline/from-store.test.ts
git commit -m "feat(report): --from-store builds a graded report from the store via the exporter"
```

---

## Task 5: Docs + observable verification demo

**Files:**
- Create: `docs/store-report.md`
- Modify: `README.md` (a pointer near "How it works" / "Layout")

**Interfaces:** none (documentation + a runnable walkthrough).

- [ ] **Step 1: Write `docs/store-report.md`** covering: what the exporter does (store → §3.3 NDJSON → existing report pipeline); the CLI (`watcher-store --db <p> --key <k> --export [--session <uuid>]`); the integrated path (`npm run report:from-store -- --db <p> --key <k>`); and the manual two-step pipe:

```sh
# build a store, then rebuild its graded report straight from the store
cd crates/store && cargo build --release
./target/release/watcher-store --db /tmp/run.db --key testkey --ndjson some-capture.ndjson   # ingest
./target/release/watcher-store --db /tmp/run.db --key testkey --export | \
  npx vite-node scripts/ingest-capture.tsx --ndjson /dev/stdin --out dist/report-from-store.json
```

State plainly: the report built from the store matches the report built from the original capture (the round-trip property Task 2 asserts), and this does NOT replace the NDJSON path — it's an additional source.

- [ ] **Step 2: Add the observable verification walkthrough** to `docs/store-report.md` — a numbered "verify it yourself" section: (1) ingest the bundled sample stream containing an HTTP exchange into a throwaway store, (2) `--export` it and observe the reconstructed `http_request`/`http_response` lines printed, (3) `--from-store` (or the pipe) into a report and confirm the web episode with its CWE appears. This is the "here's it working" artifact.

- [ ] **Step 3: Add a README pointer** near the "How it works" section:

```markdown
A run persisted to the optional encrypted store can be rebuilt into the same graded report straight
from the store — see [docs/store-report.md](docs/store-report.md).
```

- [ ] **Step 4: Commit**

```bash
git add docs/store-report.md README.md
git commit -m "docs: store→report reader guide + observable verification walkthrough"
```

---

## Self-Review

**Spec coverage:**
- §4 exporter (`export_envelopes`/`export_ndjson`, session selection, reconstruction, ordering, redaction note) → Task 2. ✓
- §5 fidelity/schema (platform column + migration + persist + export) → Task 1 (persist/migrate) + Task 2 (export stamps platform; default `"local"`). ✓
- §6 report-gen wiring (`--from-store`, npm script, actionable error, existing path untouched) → Task 4. ✓
- §7 testing (Rust round-trip, TS e2e, observable demo) → Task 2 (round-trip), Task 4 (TS), Task 5 (demo); CLI integration → Task 3. ✓
- §3 architecture (store → NDJSON → existing pipeline) → Tasks 2–4. ✓
- §8 non-goals → no tasks (correct). ✓

**Placeholder scan:** No TBD/TODO. Task 4 Step 2 notes the test is a regression guard that should pass on first run given Phase 1 — that is an explicit expected-state note, not a placeholder.

**Type consistency:** `export_envelopes(conn, Option<&str>) -> Vec<RawEvent>` and `export_ndjson(conn, Option<&str>) -> Result<String, Box<dyn Error>>` are used identically in Tasks 2, 3, 4. The `platform` column name, the `--export`/`--session`/`--from-store`/`--db`/`--key` flags, and the `web:burp` context_path are consistent across Rust, the CLI, and the TS script. `RawEvent`/`Payload`/`Provenance` field names match the store's existing struct (Deserialize) with `Serialize` added in Task 2.
