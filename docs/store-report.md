# Rebuilding a run from the encrypted store

The Watcher can persist a run to an optional encrypted **SQLCipher store**, and later rebuild the exact same graded report straight from that store — without the original capture stream. This is useful when you need to re-grade a run, preserve it long-term, or recover a report if the original session file is lost.

The store is **optional** — you enable it with `--store` when you start a capture. If you don't pass `--store`, the run is processed and reported as normal, and nothing is written to the store.

---

## What the exporter does

The store holds a versioned, compressed snapshot of every event in a run: commands, output, web traffic, and metadata. When you export, the CLI reconstructs the **§3.3 NDJSON stream** (the telemetry envelope format) from the store. That NDJSON is then fed into the existing report pipeline — the same one that grades a live capture — producing an identical graded report.

```
Encrypted Store (SQLCipher)
        ↓
   watcher-store --export
        ↓
     §3.3 NDJSON
        ↓
  vite-node scripts/ingest-capture.tsx --ndjson /dev/stdin
        ↓
    Graded Report (JSON)
```

The round-trip property is verified by Rust tests: a run ingested into the store and then exported produces the same report as the original capture. **This does NOT replace the NDJSON path** — it's an additional source, and both paths remain available.

---

## The CLI: `watcher-store`

The compiled `watcher-store` binary (built from `crates/store`) offers three modes:

### Ingest a capture

```sh
watcher-store --db <path> --key <passphrase> --ndjson <capture.ndjson>
```

Reads an NDJSON stream from a file and stores it in the encrypted database.

### Export to §3.3 NDJSON

```sh
watcher-store --db <path> --key <passphrase> --export [--session <uuid>]
```

Writes the stored events back as §3.3 NDJSON to stdout. If `--session` is omitted, the most-recently-started session is exported. Pass `--session <uuid>` to export a specific session.

On Windows, the binary is named `watcher-store.exe`.

---

## The integrated path: `npm run report:from-store`

The npm script builds the store crate (if needed) and pipes its export directly into the report generator:

```sh
# Build the store crate once (if not already built)
cargo build -p watcher-store --release

# Then rebuild a report from the store
npm run report:from-store -- --db <path> --key <passphrase> [--session <uuid>] [--out dist/report-from-store.json]
```

By default, the report is written to `dist/report-from-store.json`. The script looks for the built binary in `crates/store/target/release/watcher-store` (or fallback locations) — if it's not found, it exits with a helpful error message.

---

## The manual two-step pipe

If you prefer to build the store crate and export manually:

```sh
# Build the store crate
cd crates/store && cargo build --release

# Ingest a capture
./target/release/watcher-store --db /tmp/run.db --key testkey --ndjson some-capture.ndjson

# Export and pipe into the report generator
./target/release/watcher-store --db /tmp/run.db --key testkey --export | \
  npx vite-node scripts/ingest-capture.tsx --ndjson /dev/stdin --out dist/report-from-store.json
```

This is the same pipeline the npm script wraps — you're running the commands directly.

---

## Round-trip fidelity

**The store round-trip produces the same graded report (episodes, phases, grade, CWE, findings) as the original capture.** This is the round-trip property: a run stored and then exported produces the same graded content. The Rust test suite asserts this for a variety of captures, including those with HTTP exchanges. Note that the session header/identity and the platform badge are not reproduced from the store today — `session_start` metadata (the machine/target) isn't persisted at ingest, so a store-sourced report shows a generic "Live capture" target with no machine, even though the graded content is identical. (The persisted `platform` column is a foundation for a future single-owner switch, not yet consumed by report rendering.)

You can verify this yourself: ingest the same capture into the store, export it, and generate a report from the export — the graded content is identical to the report built from the original NDJSON stream.

---

## Verify it yourself

This walkthrough demonstrates the round-trip property in action: ingest a sample capture into a throwaway store, export it, observe the reconstructed events, and build a report.

### 1. Build the store crate (one-time setup)

```sh
cargo build -p watcher-store --release
```

### 2. Create a sample NDJSON stream with an HTTP exchange

Save this to a file (e.g., `sample-capture.ndjson`) to ingest a capture containing an HTTP exchange (a POST request and response):

```
{"source":"local_pty","session_uuid":"demo-session-123","seq":1,"ts_utc_us":1000000,"kind":"command","payload":{"cmd":"curl -X POST http://example.com/api -d '{\"user\":\"test\"}'"},"provenance":{"boundary_confidence":1.0,"redaction_method":"none","context_path":"host","platform":"local"}}
{"source":"plugin","session_uuid":"demo-session-123","seq":2,"ts_utc_us":2000000,"kind":"http_request","payload":{"pair_id":"pair-001","method":"POST","url":"http://example.com/api","req_headers":"Content-Type: application/json","req_body":"{\"user\":\"test\"}"},"provenance":{"boundary_confidence":1.0,"redaction_method":"none","context_path":"web:burp","platform":"local"}}
{"source":"plugin","session_uuid":"demo-session-123","seq":3,"ts_utc_us":3000000,"kind":"http_response","payload":{"pair_id":"pair-001","status":200,"resp_headers":"Content-Type: application/json","resp_body":"{\"status\":\"ok\"}","mime":"application/json"},"provenance":{"boundary_confidence":1.0,"redaction_method":"none","context_path":"web:burp","platform":"local"}}
{"source":"local_pty","session_uuid":"demo-session-123","seq":4,"ts_utc_us":4000000,"kind":"session_end","payload":{"text":"capture ended"},"provenance":{"boundary_confidence":1.0,"redaction_method":"none","context_path":"host","platform":"local"}}
```

### 3. Ingest into a throwaway store

```sh
./target/release/watcher-store --db /tmp/demo.db --key demo-key --ndjson sample-capture.ndjson
```

The database is encrypted with the key `demo-key`. The ingest succeeds silently.

### 4. Export and observe the reconstructed events

```sh
./target/release/watcher-store --db /tmp/demo.db --key demo-key --export
```

You should see the reconstructed §3.3 NDJSON stream printed to stdout. Look for:

- The `command` envelope with `"cmd":"curl -X POST http://example.com/api..."`.
- The `http_request` envelope with `"method":"POST"` and `"url":"http://example.com/api"`.
- The `http_response` envelope with `"status":200` and the response body.

All fields and their values should match what you ingested.

### 5. Build a report from the export (optional)

To generate a full graded report from the exported NDJSON:

```sh
npm run report:from-store -- --db /tmp/demo.db --key demo-key --out /tmp/demo-report.json
```

Open `/tmp/demo-report.json` in the Watcher UI (or view it as JSON). The report should contain:

- The executed command as an episode.
- The HTTP exchange (POST to `/api`) as a web episode.
- Any CWE weakness classes inferred from the request/response pair (e.g., if a SQL injection payload is detected).

This confirms that the round-trip works: the store preserved the events, the export reconstructed them faithfully, and the report pipeline graded them as it would a live capture.

---

## Notes

- **Encryption:** The store uses SQLCipher with the key you provide. The same key is required to export.
- **Session selection:** If `--session` is omitted, the most-recently-started session is exported. Pass `--session <uuid>` to export a specific session.
- **Windows:** The binary is `watcher-store.exe`; all commands above work as-is on Windows (PowerShell and Bash via Git Bash).
- **Errors:** If the key is wrong, the export will fail with a decryption error. If the database is corrupted or the path doesn't exist, you'll see a clear error message.
