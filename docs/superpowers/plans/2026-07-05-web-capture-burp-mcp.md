# Web Capture (Phase 1: Burp via MCP) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ingest Burp proxy history near-live over MCP and grade each HTTP exchange as a first-class attack event (MITRE tactic/technique + CWE) on the same timeline as terminal commands.

**Architecture:** A Python **bridge plugin** connects to Burp's MCP server, polls proxy history, and streams `http_request`/`http_response` §3.3 envelopes to the existing daemon socket. The Rust daemon re-redacts (web-aware) and persists them to a new `http_exchanges` table. The TS pipeline joins the exchange pair into a `RawCommand` carrying a `web` payload, and a new pure `web.ts` classifier assigns `(tactic, technique, cwe, confidence)` so web episodes flow through the unchanged segment → align → frameworks → metrics pipeline.

**Tech Stack:** Rust (`rusqlite`/SQLCipher, `regex`, `serde`), Python 3 (existing `watcher_sdk` + `mcp` client package), TypeScript (Vitest, the `src/lib/pipeline` deterministic pipeline).

## Global Constraints

- **Backward-compatible & additive:** telemetry envelope, store schema, and report types gain **optional** fields only. Every existing capture and report loads and behaves identically. (Store `schema_ver` stays readable; new table is `CREATE TABLE IF NOT EXISTS`.)
- **Determinism is sacred:** web→technique/CWE classification is a pure function of the exchange; identical input → identical output. No model in the grading loop.
- **Redaction before persistence:** the daemon re-redacts every field on receipt via `watcher_core::redact`; it never trusts the bridge's scrubbing. Known secrets must never reach the store.
- **Strictly additive to the run:** if web capture is off or Burp/MCP is unreachable, terminal capture is byte-for-byte unchanged and never blocked.
- **Off by default:** enabled only by the bare `--web` flag (or a persisted config toggle). Scope-limited to Burp-in-scope hosts.
- **UX binding rule:** if using web capture requires learning a new concept, reading a doc before the first run, or editing a config file, the UX has failed. One flag, one place in the report, one status signal.
- **Green gate (every task's final step):** `npm test`, `npm run typecheck`, `npm run build`, and `cargo test` (for tasks touching Rust) all pass before the task is done.
- **Neutral platform id** comes from `--platform` (`htb | thm | offsec | immersive | local`); web events carry `context_path: "web:burp"`.

---

## File Structure

**Rust**
- `crates/capture/src/envelope.rs` — add `http_request`/`http_response` kinds + web `Payload` fields (envelope producer side; also the canonical field list).
- `crates/store/src/lib.rs` — add `Payload` web fields to `RawEvent`, an `http_exchanges` table, and an ingest branch.
- `crates/core/src/redact.rs` — add `redact_headers` + extend body/query redaction for web secrets.
- `crates/daemon/src/lib.rs` — ensure web kinds route through re-redaction (extend the redacted-fields set).

**Python**
- `plugins/sdk/watcher_sdk.py` — add `http_request()` / `http_response()` envelope helpers.
- `plugins/burp-bridge/bridge.py` — the poll loop, cursor, dedup, scope filter, graceful degradation.
- `plugins/burp-bridge/burp_mcp.py` — thin MCP-client adapter around Burp's proxy-history tool (the one Burp-specific seam).
- `plugins/burp-bridge/requirements.txt` — pins the `mcp` client dep.
- `plugins/burp-bridge/test_bridge.py` — bridge poll/cursor/dedup/scope against a mock MCP.

**TypeScript**
- `src/lib/pipeline/web.ts` — pure `classifyExchange` + the ordered lookup table. Peer of `mitre.ts`.
- `src/lib/pipeline/web.test.ts` — fixture exchanges → expected priors.
- `src/lib/pipeline/types.ts` — add `WebExchange` interface and optional `web?: WebExchange` on `RawCommand`.
- `src/lib/pipeline/ingest.ts` — extend `TelemetryEvent` type; join `http_request`+`http_response` by `pair_id` into web `RawCommand`s.
- `src/lib/pipeline/segment.ts` — when a `RawCommand` carries `web`, classify via `classifyExchange` and attach `frameworks.cwe`.
- `src/components/AttackTimeline.tsx` — render an HTTP episode row.
- `src/lib/preflight.ts` — preflight/detect-and-nudge message strings (pure, testable).

**Docs**
- `docs/web-capture.md` + a README pointer near "Try it".

---

## Task 1: Envelope + store fields (Rust, no behavior change yet)

**Files:**
- Modify: `crates/capture/src/envelope.rs` (`Payload`, add `http_request`/`http_response` constructors)
- Modify: `crates/store/src/lib.rs:35-42` (`Payload` struct)
- Test: inline `#[cfg(test)]` in each file

**Interfaces:**
- Produces: `Payload` gains `method, url, status, req_headers, req_body, resp_headers, resp_body, mime, pair_id` (all `Option`). Two new `kind` strings: `"http_request"`, `"http_response"`. Store `RawEvent.payload` deserializes these fields (ignored by ingest until Task 2).

- [ ] **Step 1: Write the failing test** (store round-trip of a web envelope)

In `crates/store/src/lib.rs` tests module:

```rust
#[test]
fn parses_http_envelope_fields() {
    let line = r#"{"source":"plugin","session_uuid":"s1","seq":5,"ts_utc_us":10,"kind":"http_request","payload":{"method":"POST","url":"http://t/login?id=1","pair_id":"p1","req_body":"u=a&p=b"}}"#;
    let evs = parse_ndjson(line);
    assert_eq!(evs.len(), 1);
    assert_eq!(evs[0].kind, "http_request");
    assert_eq!(evs[0].payload.method.as_deref(), Some("POST"));
    assert_eq!(evs[0].payload.pair_id.as_deref(), Some("p1"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-store parses_http_envelope_fields`
Expected: FAIL — `no field 'method' on Payload`.

- [ ] **Step 3: Add the fields to the store `Payload`**

In `crates/store/src/lib.rs`, extend the `Payload` struct:

```rust
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
```

- [ ] **Step 4: Mirror the fields on the producer `Payload`** in `crates/capture/src/envelope.rs` (add the same nine `Option` fields with `#[serde(skip_serializing_if = "Option::is_none")]`), and add two constructors:

```rust
impl TelemetryEvent {
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cargo test -p watcher-store parses_http_envelope_fields && cargo test -p watcher-capture`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/store/src/lib.rs crates/capture/src/envelope.rs
git commit -m "feat(envelope): http_request/http_response kinds + web payload fields"
```

---

## Task 2: Store `http_exchanges` table + ingest branch (Rust)

**Files:**
- Modify: `crates/store/src/lib.rs` (`SCHEMA`, `ingest` match arms)
- Test: inline tests module

**Interfaces:**
- Consumes: web `Payload` fields (Task 1).
- Produces: `ingest` now persists `http_request`/`http_response` into `http_exchanges(session_id, pair_id, ...)`, joining the response onto the request row by `(session_id, pair_id)`. Returns are unchanged `(cmds, outs)` — web rows are counted separately by a new returned field is NOT added (keep signature stable); assert via a direct query in tests.

- [ ] **Step 1: Write the failing test**

```rust
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-store ingests_http_exchange_pair`
Expected: FAIL — `no such table: http_exchanges`.

- [ ] **Step 3: Add the table to `SCHEMA`** (append inside the `SCHEMA` const, before the indexes):

```sql
CREATE TABLE IF NOT EXISTS http_exchanges (
  id INTEGER PRIMARY KEY, session_id INTEGER REFERENCES sessions(id),
  pair_id TEXT, method TEXT, url TEXT, req_headers TEXT, req_body TEXT,
  status INTEGER, resp_headers TEXT, resp_body TEXT, mime TEXT,
  started_at INTEGER, ended_at INTEGER, context_path TEXT,
  UNIQUE(session_id, pair_id) );
```

and add an index line: `CREATE INDEX IF NOT EXISTS idx_http_session ON http_exchanges(session_id);`

- [ ] **Step 4: Add ingest branches** in `ingest`'s `match e.kind.as_str()` (before the `_ => {}` arm):

```rust
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
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cargo test -p watcher-store ingests_http_exchange_pair`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/store/src/lib.rs
git commit -m "feat(store): http_exchanges table + request/response ingest join by pair_id"
```

---

## Task 3: Web-aware re-redaction (Rust)

**Files:**
- Modify: `crates/core/src/redact.rs`
- Modify: `crates/daemon/src/lib.rs` (apply redaction to web fields on receipt)
- Test: inline tests in `redact.rs` + a daemon-level test

**Interfaces:**
- Consumes: `redact(&str) -> String` (existing).
- Produces: `redact_headers(&str) -> String` — masks `Authorization`, `Cookie`, `Set-Cookie`, and `X-API-Key`-class header values line-by-line; and `redact` extended to mask bearer/`sk-` token-shaped values in bodies/query strings.

- [ ] **Step 1: Write the failing test** in `redact.rs`:

```rust
#[test]
fn masks_auth_headers_and_cookies() {
    let h = "Host: t\r\nAuthorization: Bearer sk-abc123\r\nCookie: session=deadbeef; a=b\r\nAccept: */*";
    let out = redact_headers(h);
    assert!(out.contains("Host: t"));
    assert!(out.contains("Accept: */*"));
    assert!(!out.contains("sk-abc123"));
    assert!(!out.contains("deadbeef"));
    assert!(out.contains("Authorization: [redacted]"));
    assert!(out.contains("Cookie: [redacted]"));
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p watcher-core masks_auth_headers`
Expected: FAIL — `cannot find function redact_headers`.

- [ ] **Step 3: Implement `redact_headers`** in `redact.rs`:

```rust
/// Mask credential-bearing HTTP header values, preserving header names and structure.
pub fn redact_headers(headers: &str) -> String {
    let sensitive = |name: &str| {
        let n = name.trim().to_ascii_lowercase();
        n == "authorization" || n == "cookie" || n == "set-cookie"
            || n == "x-api-key" || n == "x-auth-token" || n.ends_with("-api-key")
    };
    headers
        .split("\r\n")
        .map(|line| match line.split_once(':') {
            Some((name, _)) if sensitive(name) => format!("{}: [redacted]", name),
            _ => line.to_string(),
        })
        .collect::<Vec<_>>()
        .join("\r\n")
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cargo test -p watcher-core masks_auth_headers`
Expected: PASS.

- [ ] **Step 5: Apply web redaction on receipt in the daemon.** In `crates/daemon/src/lib.rs`, wherever the pipeline re-redacts a `RawEvent`'s text/cmd fields, add: when `kind` is `http_request`/`http_response`, run `redact_headers` over `req_headers`/`resp_headers` and `redact` over `url`, `req_body`, `resp_body`. Add a test asserting a bearer token in `req_headers` never survives a round-trip through the daemon's handle path into the store. (Follow the existing per-field redaction call site; mirror the `output` field handling.)

- [ ] **Step 6: Run the green gate**

Run: `cargo test`
Expected: PASS (all crates).

- [ ] **Step 7: Commit**

```bash
git add crates/core/src/redact.rs crates/daemon/src/lib.rs
git commit -m "feat(redact): web-aware header/body redaction on receipt"
```

---

## Task 4: `web.ts` — pure exchange classifier (TypeScript)

**Files:**
- Create: `src/lib/pipeline/web.ts`
- Create: `src/lib/pipeline/web.test.ts`
- Modify: `src/lib/pipeline/types.ts` (add `WebExchange`)

**Interfaces:**
- Produces:
  - `interface WebExchange { method: string; url: string; req_body?: string; status?: number; resp_body?: string; mime?: string; }`
  - `interface WebPrior { tactic: string; technique: string; cwe?: string; confidence: number; }`
  - `function classifyExchange(ex: WebExchange): WebPrior`
- Consumed by: `segment.ts` (Task 6).

- [ ] **Step 1: Write the failing test** `src/lib/pipeline/web.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { classifyExchange } from "./web";

describe("classifyExchange", () => {
  it("flags SQLi from a quote-tampered param + SQL error in the response", () => {
    const p = classifyExchange({
      method: "GET", url: "http://t/item?id=1'",
      status: 500, resp_body: "You have an error in your SQL syntax near",
    });
    expect(p.technique).toBe("T1190");
    expect(p.cwe).toBe("CWE-89");
  });

  it("flags path traversal from ../ in a param", () => {
    const p = classifyExchange({ method: "GET", url: "http://t/get?file=../../etc/passwd" });
    expect(p.cwe).toBe("CWE-22");
  });

  it("flags brute force on repeated auth POSTs", () => {
    const p = classifyExchange({ method: "POST", url: "http://t/login", req_body: "user=admin&pass=x" });
    expect(p.tactic).toBe("TA0001");
    expect(p.technique).toBe("T1110");
  });

  it("falls back to recon for a plain GET", () => {
    const p = classifyExchange({ method: "GET", url: "http://t/", status: 200 });
    expect(p.tactic).toBe("TA0007");
    expect(p.confidence).toBeLessThan(0.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pipeline/web.test.ts`
Expected: FAIL — cannot find module `./web`.

- [ ] **Step 3: Add `WebExchange` to `types.ts`:**

```ts
/** A joined HTTP request/response, the web analogue of RawCommand's shell hook. */
export interface WebExchange {
  method: string;
  url: string;
  req_body?: string;
  status?: number;
  resp_body?: string;
  mime?: string;
}
```

- [ ] **Step 4: Implement `web.ts`** (ordered table, first match wins — mirrors `mitre.ts`):

```ts
/**
 * Web exchange → (tactic, technique, cwe) prior — the deterministic pass-1 table for
 * HTTP traffic, peer of pipeline/mitre.ts. Keyed on request/response *features*
 * (params, payload shape, response signal), never on live secret values.
 */
import type { WebExchange } from "./types";

export interface WebPrior {
  tactic: string;
  technique: string;
  cwe?: string;
  confidence: number;
}

const SQL_ERROR = /sql syntax|mysql_fetch|ORA-\d|unclosed quotation|pg_query|sqlite_/i;
const SQLI_PROBE = /('|%27|\bUNION\b|\bOR\b\s+1=1|--\s|%20OR%20)/i;
const TRAVERSAL = /(\.\.\/|\.\.%2f|%2e%2e\/|\/etc\/passwd)/i;
const XSS_PROBE = /<script|onerror=|javascript:/i;

export function classifyExchange(ex: WebExchange): WebPrior {
  const url = ex.url ?? "";
  const query = url.includes("?") ? url.slice(url.indexOf("?") + 1) : "";
  const body = ex.req_body ?? "";
  const resp = ex.resp_body ?? "";
  const authy = /\b(login|signin|auth|token|session)\b/i.test(url);

  if (SQLI_PROBE.test(query) || SQLI_PROBE.test(body)) {
    const confirmed = SQL_ERROR.test(resp);
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-89", confidence: confirmed ? 0.9 : 0.7 };
  }
  if (TRAVERSAL.test(query) || TRAVERSAL.test(body)) {
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-22", confidence: 0.8 };
  }
  if (XSS_PROBE.test(query) || (XSS_PROBE.test(body) && XSS_PROBE.test(resp))) {
    return { tactic: "TA0001", technique: "T1190", cwe: "CWE-79", confidence: 0.7 };
  }
  if (ex.method === "POST" && authy) {
    return { tactic: "TA0001", technique: "T1110", cwe: undefined, confidence: 0.6 };
  }
  // plain browsing / content discovery — low-confidence recon prior
  return { tactic: "TA0007", technique: "T1595", cwe: undefined, confidence: 0.4 };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/lib/pipeline/web.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/web.ts src/lib/pipeline/web.test.ts src/lib/pipeline/types.ts
git commit -m "feat(pipeline): pure HTTP exchange -> tactic/technique/CWE classifier"
```

---

## Task 5: Join web envelopes into RawCommands (TypeScript)

**Files:**
- Modify: `src/lib/pipeline/types.ts` (add `web?: WebExchange` to `RawCommand`)
- Modify: `src/lib/pipeline/ingest.ts` (`TelemetryEvent` type + join logic)
- Test: `src/lib/pipeline/ingest.test.ts` (add a case)

**Interfaces:**
- Consumes: `WebExchange` (Task 4), `envelopesToRawCommands` (existing).
- Produces: `envelopesToRawCommands` also emits, for each `pair_id`, one `RawCommand` with `web` set, `cmd` = `"<METHOD> <path>"`, timestamps from request/response, redacted.

- [ ] **Step 1: Write the failing test** in `src/lib/pipeline/ingest.test.ts`:

```ts
it("joins http_request+http_response into a web RawCommand", () => {
  const nd = [
    `{"source":"plugin","session_uuid":"s","seq":1,"ts_utc_us":1000,"kind":"http_request","payload":{"method":"GET","url":"http://t/item?id=1'","pair_id":"p1"}}`,
    `{"source":"plugin","session_uuid":"s","seq":2,"ts_utc_us":2000,"kind":"http_response","payload":{"status":500,"resp_body":"SQL syntax error","pair_id":"p1"}}`,
  ].join("\n");
  const raw = envelopesToRawCommands(parseEnvelopes(nd));
  const web = raw.find((r) => r.web);
  expect(web).toBeDefined();
  expect(web!.web!.method).toBe("GET");
  expect(web!.web!.status).toBe(500);
  expect(web!.cmd).toContain("GET");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pipeline/ingest.test.ts -t "web RawCommand"`
Expected: FAIL — `web` is not read / undefined.

- [ ] **Step 3: Extend the `TelemetryEvent` type** in `ingest.ts`:

```ts
  kind: "command" | "output" | "stdin_masked" | "http_request" | "http_response";
  payload: {
    cmd?: string; exit_code?: number | null; stream?: string; text?: string; line_count?: number;
    method?: string; url?: string; status?: number; req_headers?: string; req_body?: string;
    resp_headers?: string; resp_body?: string; mime?: string; pair_id?: string;
  };
```

- [ ] **Step 4: Add `web?` to `RawCommand`** in `types.ts`:

```ts
  /** present when this record is an HTTP exchange rather than a shell command. */
  web?: import("./types").WebExchange; // (self-import avoided: declare inline — see note)
```

Note: place `web?: WebExchange;` directly in the `RawCommand` interface (same file, no import needed).

- [ ] **Step 5: Emit web RawCommands** — in `envelopesToRawCommands`, after the existing command join, add:

```ts
  // join http exchanges by pair_id
  const reqs = new Map<string, TelemetryEvent>();
  const resps = new Map<string, TelemetryEvent>();
  for (const e of events) {
    const pid = e.payload.pair_id;
    if (!pid) continue;
    if (e.kind === "http_request") reqs.set(pid, e);
    else if (e.kind === "http_response") resps.set(pid, e);
  }
  const webCmds: RawCommand[] = [...reqs.keys()].map((pid) => {
    const q = reqs.get(pid)!;
    const r = resps.get(pid);
    const startMs = Math.floor(q.ts_utc_us / 1000);
    const endMs = r ? Math.floor(r.ts_utc_us / 1000) : startMs;
    const url = redactText(q.payload.url ?? "");
    const path = (() => { try { return new URL(url).pathname + new URL(url).search; } catch { return url; } })();
    return {
      cmd: `${q.payload.method ?? "GET"} ${path}`,
      started_at_ms: startMs,
      ended_at_ms: Math.max(startMs, endMs),
      exit_code: null,
      output_line_count: 0,
      context_path: q.provenance?.context_path ?? "web:burp",
      web: {
        method: q.payload.method ?? "GET",
        url,
        req_body: q.payload.req_body != null ? redactText(q.payload.req_body) : undefined,
        status: r?.payload.status,
        resp_body: r?.payload.resp_body != null ? redactText(r.payload.resp_body) : undefined,
        mime: r?.payload.mime,
      },
    } satisfies RawCommand;
  });
```

and change the final `return` to `return [...commandRaw, ...webCmds].sort((a, b) => a.started_at_ms - b.started_at_ms);` (rename the existing mapped array to `commandRaw`).

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run src/lib/pipeline/ingest.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/pipeline/ingest.ts src/lib/pipeline/types.ts src/lib/pipeline/ingest.test.ts
git commit -m "feat(pipeline): join http envelopes into time-ordered web RawCommands"
```

---

## Task 6: Route web RawCommands through segmentation (TypeScript)

**Files:**
- Modify: `src/lib/pipeline/segment.ts`
- Test: `src/lib/pipeline/segment.test.ts` (add a case)

**Interfaces:**
- Consumes: `classifyExchange` (Task 4), `RawCommand.web` (Task 5).
- Produces: web `RawCommand`s become `Episode`s carrying the web prior's `tactic`/`technique`/`confidence` and `frameworks.cwe = [prior.cwe]` when present, so they flow through align/frameworks/metrics unchanged.

- [ ] **Step 1: Write the failing test** in `src/lib/pipeline/segment.test.ts`:

```ts
it("classifies a web exchange episode with CWE", () => {
  const eps = segmentEpisodes([{
    cmd: "GET /item?id=1'", started_at_ms: 0, ended_at_ms: 50, exit_code: null,
    output_line_count: 0, context_path: "web:burp",
    web: { method: "GET", url: "http://t/item?id=1'", status: 500, resp_body: "SQL syntax error" },
  }]);
  expect(eps[0].technique).toBe("T1190");
  expect(eps[0].frameworks?.cwe).toContain("CWE-89");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/pipeline/segment.test.ts -t "web exchange episode"`
Expected: FAIL — `technique` undefined / cwe missing.

- [ ] **Step 3: Branch on `r.web` in `segmentEpisodes`.** Add the import `import { classifyExchange } from "./web";` and, in the per-command loop where `prior = classifyCommand(...)` is computed, replace with:

```ts
    const webPrior = r.web ? classifyExchange(r.web) : null;
    const prior = webPrior
      ? { tactic: webPrior.tactic, technique: webPrior.technique, confidence: webPrior.confidence }
      : classifyCommand(r.cmd, lastTactic, r.context_path);
```

Then, where the episode object is pushed, add web frameworks when present:

```ts
      ...(webPrior?.cwe ? { frameworks: { cwe: [webPrior.cwe] } } : {}),
```

(placed alongside the existing episode fields, e.g. after `technique`). Confirm `enrichFrameworks` merges rather than overwrites an existing `frameworks.cwe`; if it overwrites, guard it to keep a pre-set `cwe`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/pipeline/segment.test.ts`
Expected: PASS.

- [ ] **Step 5: Run the full TS gate**

Run: `npm test && npm run typecheck && npm run build`
Expected: PASS. Web episodes now count toward coverage, kill-chain trajectory, and grade automatically.

- [ ] **Step 6: Commit**

```bash
git add src/lib/pipeline/segment.ts src/lib/pipeline/segment.test.ts
git commit -m "feat(pipeline): web exchanges become graded episodes with CWE"
```

---

## Task 7: Python SDK web helpers + Burp bridge (Python)

**Files:**
- Modify: `plugins/sdk/watcher_sdk.py`
- Create: `plugins/burp-bridge/bridge.py`, `plugins/burp-bridge/burp_mcp.py`, `plugins/burp-bridge/requirements.txt`, `plugins/burp-bridge/test_bridge.py`

**Interfaces:**
- Consumes: `watcher_sdk.Watcher` (existing).
- Produces:
  - `Watcher.http_request(pair_id, method, url, req_headers="", req_body="")` and `Watcher.http_response(pair_id, status, resp_headers="", resp_body="", mime="")` — emit the Task-1 envelopes.
  - `burp_mcp.BurpClient.history_since(cursor) -> list[dict]` — the one Burp-specific seam (each dict: `pair_id, method, url, req_headers, req_body, status, resp_headers, resp_body, mime, host`).
  - `bridge.run(client, watcher, scope) ` — poll loop; dedups on `pair_id`, filters by `scope`, advances cursor.

- [ ] **Step 1: Add SDK helpers** to `watcher_sdk.py`:

```python
    def http_request(self, pair_id, method, url, req_headers="", req_body=""):
        self._event("http_request", {"pair_id": pair_id, "method": method, "url": url,
                                     "req_headers": req_headers, "req_body": req_body})

    def http_response(self, pair_id, status, resp_headers="", resp_body="", mime=""):
        self._event("http_response", {"pair_id": pair_id, "status": status,
                                      "resp_headers": resp_headers, "resp_body": resp_body, "mime": mime})
```

- [ ] **Step 2: Write the failing bridge test** `plugins/burp-bridge/test_bridge.py`:

```python
from bridge import poll_once

class FakeWatcher:
    def __init__(self): self.events = []
    def http_request(self, **kw): self.events.append(("req", kw["pair_id"]))
    def http_response(self, **kw): self.events.append(("resp", kw["pair_id"]))

def test_dedups_and_scopes():
    history = [
        {"pair_id": "p1", "host": "target", "method": "GET", "url": "http://target/a",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "ok", "mime": "text/html"},
        {"pair_id": "p1", "host": "target", "method": "GET", "url": "http://target/a",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "ok", "mime": "text/html"},
        {"pair_id": "p2", "host": "other", "method": "GET", "url": "http://other/x",
         "req_headers": "", "req_body": "", "status": 200, "resp_headers": "", "resp_body": "", "mime": ""},
    ]
    w = FakeWatcher(); seen = set()
    poll_once(history, w, scope={"target"}, seen=seen)
    pairs = {p for _, p in w.events}
    assert pairs == {"p1"}          # p1 emitted once (dedup), p2 out of scope
    assert ("req", "p1") in w.events and ("resp", "p1") in w.events
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd plugins/burp-bridge && python -m pytest test_bridge.py -q`
Expected: FAIL — cannot import `poll_once`.

- [ ] **Step 4: Implement `bridge.py`:**

```python
"""Burp -> Watcher bridge: poll Burp's MCP proxy history, emit web telemetry."""
import time

def poll_once(history, watcher, scope, seen):
    """Emit unseen, in-scope exchanges once. Pure over its inputs for testability."""
    for ex in history:
        pid = ex["pair_id"]
        if pid in seen:
            continue
        if scope and ex.get("host") not in scope:
            continue
        seen.add(pid)
        watcher.http_request(pair_id=pid, method=ex["method"], url=ex["url"],
                             req_headers=ex.get("req_headers", ""), req_body=ex.get("req_body", ""))
        watcher.http_response(pair_id=pid, status=ex.get("status", 0),
                              resp_headers=ex.get("resp_headers", ""), resp_body=ex.get("resp_body", ""),
                              mime=ex.get("mime", ""))

def run(client, watcher, scope, interval=2.0):
    seen, cursor = set(), 0
    watcher.session_start("Burp web capture")
    try:
        while True:
            try:
                history, cursor = client.history_since(cursor)
                poll_once(history, watcher, scope, seen)
            except Exception as e:  # never crash the run — degrade
                print(f"[burp-bridge] poll failed: {e}")
            time.sleep(interval)
    finally:
        watcher.session_end(); watcher.close()
```

- [ ] **Step 5: Implement the MCP adapter `burp_mcp.py`** (the one Burp-specific seam; the exact MCP tool name is confirmed against Burp's MCP server at implementation time — the test above defines the dict contract it must return):

```python
"""Thin adapter over Burp's MCP server. Isolates the one Burp-specific call."""

class BurpClient:
    def __init__(self, session):  # session: an established MCP client session
        self.session = session

    def history_since(self, cursor):
        # Burp's MCP exposes proxy history as a tool; call it and normalize rows to the
        # dict shape poll_once expects. Returns (rows, new_cursor).
        result = self.session.call_tool("get_proxy_history", {"since": cursor})
        rows = [_normalize(item) for item in result]
        new_cursor = rows[-1]["_seq"] if rows else cursor
        return rows, new_cursor

def _normalize(item):
    return {
        "pair_id": str(item["id"]), "_seq": item["id"], "host": item.get("host"),
        "method": item.get("method", "GET"), "url": item.get("url", ""),
        "req_headers": item.get("request_headers", ""), "req_body": item.get("request_body", ""),
        "status": item.get("status_code", 0), "resp_headers": item.get("response_headers", ""),
        "resp_body": item.get("response_body", ""), "mime": item.get("mime_type", ""),
    }
```

and `requirements.txt`:

```
mcp>=1.0
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd plugins/burp-bridge && python -m pytest test_bridge.py -q`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add plugins/sdk/watcher_sdk.py plugins/burp-bridge/
git commit -m "feat(bridge): Burp-MCP poll bridge + SDK http helpers"
```

---

## Task 8: Enablement, preflight & Live Ops indicator

**Files:**
- Create: `src/lib/preflight.ts`, `src/lib/preflight.test.ts`
- Modify: `crates/capture/src/main.rs` (recognize `--web`, spawn the bridge, print detect-and-nudge)
- Modify: `src/components/AttackTimeline.tsx` (HTTP row) and the Live Ops indicator component

**Interfaces:**
- Produces: `preflightMessages` — pure strings for the three preflight states + the nudge, so wording is tested and consistent with the spec.

- [ ] **Step 1: Write the failing test** `src/lib/preflight.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { preflightMessage } from "./preflight";

describe("preflightMessage", () => {
  it("unreachable Burp explains the fix", () => {
    const m = preflightMessage("unreachable", { port: 9876 });
    expect(m).toContain("9876");
    expect(m).toContain("MCP Server extension");
    expect(m).toContain("docs/web-capture.md");
  });
  it("empty scope warns without failing", () => {
    expect(preflightMessage("empty_scope")).toContain("ingest all proxied traffic");
  });
  it("detected nudges with the flag", () => {
    expect(preflightMessage("detected")).toContain("--web");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/preflight.test.ts`
Expected: FAIL — cannot find module `./preflight`.

- [ ] **Step 3: Implement `preflight.ts`:**

```ts
export type PreflightState = "unreachable" | "deps_missing" | "empty_scope" | "detected";

export function preflightMessage(state: PreflightState, opts: { port?: number } = {}): string {
  const port = opts.port ?? 9876;
  switch (state) {
    case "unreachable":
      return `Can't reach Burp's MCP server at 127.0.0.1:${port}. Is Burp running with the MCP Server extension enabled? Setup: docs/web-capture.md`;
    case "deps_missing":
      return `burp-bridge needs Python 3.x and the mcp client. Install: pip install -r plugins/burp-bridge/requirements.txt`;
    case "empty_scope":
      return `Burp scope is empty — Watcher will ingest all proxied traffic. Set a target scope in Burp to limit what's recorded.`;
    case "detected":
      return `Burp MCP detected; add --web to record web traffic`;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/preflight.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire `--web` in capture** — in `crates/capture/src/main.rs`, when `args` contains `--web` (bare; default endpoint), spawn `python plugins/burp-bridge/bridge.py` as a child with the run's `--platform`, so it joins the active session over the socket. On startup, attempt a reachability check; on failure print the `unreachable` message and continue the terminal run unaffected (strictly additive). When `--web` is absent but Burp MCP is reachable, print the `detected` nudge once. (Rust-side strings must match `preflight.ts` verbatim — copy them.)

- [ ] **Step 6: Render an HTTP episode row** — in `src/components/AttackTimeline.tsx`, when an episode's `context_path === "web:burp"` (or `cmd` starts with an HTTP method), render it with a compact request-line style and its CWE chip, interleaved in the existing timeline. Add the small `web ●` indicator to the Live Ops panel when any web episode is present. No new tab, no mode toggle.

- [ ] **Step 7: Run the full gate**

Run: `npm test && npm run typecheck && npm run build && cargo test`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/preflight.ts src/lib/preflight.test.ts crates/capture/src/main.rs src/components/AttackTimeline.tsx
git commit -m "feat(web): --web enablement, preflight messages, Live Ops indicator + timeline row"
```

---

## Task 9: Docs

**Files:**
- Create: `docs/web-capture.md`
- Modify: `README.md` (pointer near "Try it")

**Interfaces:** none (documentation).

- [ ] **Step 1: Write `docs/web-capture.md`** covering: what it does (graded web traffic on the run timeline); the hard requirements (Burp with the MCP Server extension; Pro-vs-Community proxy-history differences); setup — install Burp → install the **MCP Server** BApp → enable it, note the endpoint → `pip install -r plugins/burp-bridge/requirements.txt` → run `watcher --attach --platform htb --target <box> --web`; **link to PortSwigger's own MCP docs for the Burp-side steps** rather than duplicating them; the default-off / scope-limited / redaction posture; and the three preflight messages with what each means. State plainly: nothing is captured until you pass `--web`.

- [ ] **Step 2: Add a README pointer** near the "Try it" section:

```markdown
- **Record your web traffic too (optional):** if you drive the target through Burp, add `--web` to fold graded HTTP attacks into the same run. Setup: [docs/web-capture.md](docs/web-capture.md).
```

- [ ] **Step 3: Commit**

```bash
git add docs/web-capture.md README.md
git commit -m "docs: web-capture setup guide + README pointer"
```

---

## Self-Review

**Spec coverage:**
- §3 architecture (bridge → daemon → store → analysis) → Tasks 1–8. ✓
- §4 envelope extension → Task 1. ✓
- §5 bridge plugin (handshake, poll, cursor, dedup, scope, graceful degradation) → Task 7 + Task 8 Step 5. ✓
- §6 web-analysis layer (ordered table, CWE, source-agnostic, deterministic) → Task 4; wiring → Tasks 5–6. ✓
- §7 defaults & consent (off, scope-limited, detect-and-nudge) → Task 8 (`--web`, nudge) + Task 7 (scope filter). ✓
- §8 redaction (headers/body, secret-never-persisted test) → Task 3. ✓
- §9 UX (one flag, one place, `web ●`) → Task 8 Steps 5–6. ✓
- §11 setup/preflight (docs + runtime messages) → Task 8 (preflight) + Task 9 (docs). ✓
- §12 testing (web.test, redaction, bridge-vs-mock, round-trip) → Tasks 2,3,4,7. ✓
- §13 deferred → out of scope, no tasks (correct). ✓

**Placeholder scan:** No TBD/TODO. The one intentional implementation-time confirmation — Burp's exact MCP tool name in `burp_mcp.py` — is isolated behind the `history_since` contract that Task 7's mock test pins, so the bridge is fully testable without live Burp.

**Type consistency:** `WebExchange` (method/url/req_body/status/resp_body/mime) is used identically in Tasks 4, 5, 6. `WebPrior` (tactic/technique/cwe/confidence) produced in Task 4, consumed in Task 6. `pair_id` is the join key in Rust ingest (Task 2), TS join (Task 5), and the bridge (Task 7). Preflight strings are defined once in `preflight.ts` (Task 8) and copied verbatim into Rust — flagged explicitly in Task 8 Step 5.
