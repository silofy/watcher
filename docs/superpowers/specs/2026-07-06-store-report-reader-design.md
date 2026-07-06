# Design Spec — Store→Report Reader (Incremental Foundation)

**Date:** 2026-07-06
**Status:** Approved for implementation
**Depends on:** the encrypted store (`crates/store`), the §3.3 envelope shape (`crates/capture/src/envelope.rs`), and the deterministic report pipeline (`src/lib/pipeline/ingest.ts` → `assembleReport`). Follows Web Capture Phase 1 (merged `82da56f`), which added the `http_exchanges` table.

---

## 0. Working rules

1. **TDD** — failing test first.
2. **Green gate** — `npm test`, `npm run typecheck`, `npm run build`, and `cargo test` (store crate) all pass before a Work Package is done.
3. **Additive & backward-compatible** — schema changes are additive (a new nullable column + a guarded migration); existing stores open and existing ingest/report paths behave identically.
4. **Determinism is sacred** — `export_envelopes` is a pure function of the store's rows; identical store → identical NDJSON (stable ordering).
5. **Reuse the proven pipeline** — the store is turned back into §3.3 NDJSON and fed to the *existing* `parseEnvelopes → envelopesToRawCommands → assembleReport`. No report logic is duplicated in Rust.
6. **No scope creep** — this spec proves the store *can* drive a graded report. It does NOT retire the NDJSON tee, change capture defaults, add keychain support, or make store-driven reports the app default — those are the follow-up "full single-owner" spec (§8).

---

## 1. Thesis

Today the SQLCipher store is effectively write-only for reporting: the rendered report is built from an NDJSON envelope stream (`scripts/ingest-capture.tsx`), and nothing reads `commands` / `output_blocks` / `http_exchanges` back out. Web Capture shipped a *tee* (bridge → NDJSON) precisely because the store couldn't drive a report. This spec adds the missing read path: a **store→§3.3-NDJSON exporter** that reconstructs the envelope stream from the store's rows and feeds the existing pipeline — making the store a first-class *source* a full graded report (commands **and** web episodes) can be rebuilt from. It is the foundation the eventual "store is the single owner" switch needs, delivered as a self-contained, backward-compatible step.

---

## 2. Goals / non-goals

**Goals**
- A pure `export_envelopes(conn, session)` reconstructing `command` / `output` / `stdin_masked` / `http_request` / `http_response` envelopes from the store, time-ordered, as §3.3 NDJSON.
- A `watcher-store --export [--session <uuid>]` CLI mode.
- Report generation wired to read from the store (`ingest-capture --from-store`), producing a full graded report including web episodes.
- The store made self-describing enough to round-trip: persist `platform` (currently dropped at ingest).

**Non-goals (this spec)**
- Not retiring the bridge→NDJSON tee or the capture-stdout report path.
- Not changing capture/bridge defaults (they still forward as they do today).
- No OS-keychain integration — uses the existing `--key` mechanism.
- No multi-session merge; export is one session at a time.
- Not making store-driven reports the app/live default.

---

## 3. Architecture & data flow

```
SQLCipher store: sessions · commands · output_blocks · http_exchanges
      │  watcher-store --export --db <p> --key <k> [--session <uuid>]
      ▼
  export_envelopes(conn, session) → §3.3 NDJSON on stdout (already-redacted at ingest)
      ▼
  existing TS pipeline: parseEnvelopes → envelopesToRawCommands → assembleReport
      ▼
  graded report (commands + web episodes with CWE)
```

The store becomes a *source*, reusing the entire downstream pipeline — including the web grading from Phase 1. **Chosen approach (A):** Rust exporter → NDJSON → existing TS pipeline. Rejected: **B** (TS reads SQLCipher directly — adds a heavy native dep and duplicates store ownership) and **C** (Rust rebuilds the whole report — duplicates the deterministic pipeline that lives in TS).

---

## 4. The exporter (`crates/store`)

`pub fn export_envelopes(conn: &Connection, session: Option<&str>) -> rusqlite::Result<Vec<TelemetryEvent>>` plus its NDJSON serialization. It reuses the `TelemetryEvent` constructors already in `crates/capture/src/envelope.rs` (the canonical §3.3 shape; the store crate takes a path/dev-dep on that shape or a shared serialization — see WP2).

**Session selection:** `session` = an explicit uuid, else the most recent session (max `started_at`). Resolve to `session_id`.

**Reconstruction (all rows for the chosen session, merged and ordered by timestamp, then by seq as a stable tie-break):**
- `commands` row → `command` envelope: `seq`, `ts_utc_us = started_at`, `cmd = raw_command`, `exit_code`, `provenance{ boundary_confidence, context_path, platform }`.
- Its `output_blocks` row(s) → `output` envelope on the same `seq` (`text = content`, `line_count`, `ts = started_at`), or `stdin_masked` when `fidelity = 'masked'`.
- `http_exchanges` row → an `http_request` envelope (`pair_id`, `method`, `url`, `req_headers`, `req_body`, `ts = started_at`, `context_path`, `platform`) followed by an `http_response` envelope (`pair_id`, `status`, `resp_headers`, `resp_body`, `mime`, `ts = ended_at`).

**Redaction:** rows were redacted at ingest, so exported envelopes are already scrubbed; the exporter does not re-redact. The downstream `envelopesToRawCommands` still runs `redactText` (idempotent on already-masked text) — no double-masking of real secrets, since none remain.

**Ordering determinism:** a single `ORDER BY ts, seq` merge yields identical NDJSON for identical rows — the property the round-trip test asserts.

---

## 5. Fidelity & schema (the self-describing gap)

Everything the grading pipeline consumes — `cmd`, timestamps, `exit_code`, output `text`/`line_count`, `context_path`, and all web fields — is already persisted, so the graded result round-trips. The one gap: **`platform` is dropped at ingest** (the `sessions` INSERT stores only `uuid, started_at, source, schema_ver`, though `RawEvent.provenance.platform` is available). To make the store self-describing:

- **Add a nullable `platform TEXT` column to `sessions`** (additive). New DBs get it in `SCHEMA`; existing DBs get it via a guarded `ALTER TABLE sessions ADD COLUMN platform TEXT` run at `open()` (ignore the "duplicate column" error so it's idempotent).
- **Persist it at ingest:** when creating a session row, write `provenance.platform` (first non-null wins).
- **Export it:** stamp each envelope's `provenance.platform` from the session row.

Bump `schema_ver` to 2 for newly written sessions; readers tolerate both. `platform` may be NULL for pre-existing sessions — export defaults it to `"local"` (the capture default) so the pipeline always has a value.

---

## 6. Report-gen wiring (`scripts/ingest-capture.tsx`)

Add a `--from-store` mode: `ingest-capture --from-store --db <p> [--key <k>] [--session <uuid>]`. It spawns the built `watcher-store --export …` binary, captures its stdout NDJSON, and runs the *existing* `assembleReport(envelopesToRawCommands(parseEnvelopes(ndjson)))` it already uses for file input — so store-sourced and file-sourced reports go through identical logic. If the `watcher-store` binary isn't found, print an actionable hint (`cargo build -p watcher-store`) and exit non-zero; do not fall back silently. Add an npm script `report:from-store`. The existing file-based `ingest` path is untouched.

For quick manual use, the two-step pipe also works and needs no new flag:
`watcher-store --export --db <p> --key <k> | npm run ingest -- --ndjson /dev/stdin` (documented in §7 / WP5).

---

## 7. Testing & observable verification

- **Rust round-trip (WP2):** ingest a known NDJSON fixture (a command + its output + one `http_request`/`http_response` pair, mixed with a `stdin_masked` case) → `open` → `export_envelopes` → assert the reconstructed events equal the meaningful fields of the originals: command/output rejoined by `seq`, http pair rejoined by `pair_id`, correct `kind`s, and stable `ts, seq` ordering. A second case asserts `platform` persists through ingest→export.
- **TS end-to-end (WP4):** a fixture NDJSON captured from a real `--export` run → `assembleReport(envelopesToRawCommands(parseEnvelopes(...)))` → assert the report contains the terminal command **and** a web episode carrying its CWE (proving the store round-trips a *graded* web result, not just raw rows).
- **Observable end-to-end demo (WP5, verify):** a scripted walkthrough — build a store from the sample stream, `--export` it (show the reconstructed NDJSON), pipe into report generation, and confirm the rendered report shows the web episode. This is the "here's it working" artifact, not just green tests.

No live daemon or real Burp needed for any test.

---

## 8. Explicitly deferred (the follow-up "full single-owner" spec)

Making the store THE source: capture + bridge forward to daemon→store by default; report generation reads only from the store; retire the NDJSON tee and capture-stdout report inputs; OS-keychain key handling; multi-session handling and the live-app report wiring. This spec deliberately stops at "the store *can* drive a report," leaving that switch as a clean, separate decision.

---

## 9. Work Packages (implementation order)

1. **WP1 — Schema self-describing:** add nullable `sessions.platform` (SCHEMA + guarded `ALTER TABLE` migration in `open()`), persist `provenance.platform` at ingest, bump `schema_ver` to 2. Round-trip test: ingest with platform → row has platform; old DB opens + gains the column.
2. **WP2 — `export_envelopes`:** pure reconstruction of command/output/stdin_masked/http_request/http_response envelopes, `ORDER BY ts, seq`, pair rejoin, platform stamped. Round-trip test (§7, first bullet).
3. **WP3 — `--export` CLI:** `watcher-store --export [--session <uuid>]` printing NDJSON to stdout; default = most recent session; honest error if the DB/key is wrong.
4. **WP4 — `--from-store` wiring:** `ingest-capture --from-store --db/--key/--session` spawns the binary and feeds the existing pipeline; npm `report:from-store`; actionable error if the binary is unbuilt; TS e2e fixture test.
5. **WP5 — Docs + observable demo:** document the store→report flow (and the manual two-step pipe) in `docs/`, and the scripted verify walkthrough proving a web episode renders from the store.
