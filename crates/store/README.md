# watcher-store — encrypted SQLite store (SQLCipher)

The daemon's single owner of telemetry (brief §8). **SQLCipher** gives transparent AES-256-CBC
page encryption with HMAC-SHA512 — the whole file is opaque at rest, indexes and WAL included —
so the file alone is worthless if exfiltrated. Both capture agents feed the §3.3 telemetry
envelope here, and the store re-redacts on receipt (never trusts an upstream's scrubbing).

## Run

```bash
# ingest a capture stream into an encrypted DB
cargo run --manifest-path crates/store/Cargo.toml -- --db session.db --key <passphrase> --ndjson crates/capture/events.ndjson
# or pipe straight from the capture POC:
cargo run --manifest-path crates/capture/Cargo.toml -- whoami "sudo -l" \
  | cargo run --manifest-path crates/store/Cargo.toml -- --db session.db --key <passphrase>

cargo test --manifest-path crates/store/Cargo.toml     # schema ingest + encryption-at-rest + wrong-key
```

## Schema

The §8 schema: `sessions`, `commands`, `output_blocks`, `artifacts`, `redactions`, `phases` plus
indexes. Ingestion upserts the session by uuid, inserts each `command` envelope (with `exit_code`
and `boundary_confidence` from the capture layer), and joins each `output` envelope back to its
command by `(session, seq)`.

## Key management

The POC takes a `--key` passphrase. In production the DB key is **random**, held in the OS
keychain (macOS Keychain / Linux Secret Service), and derived with **Argon2id** — never stored on
disk. The key is applied via `PRAGMA key` before any other statement; a wrong key fails the open.

## Build prerequisites (Windows)

SQLCipher is built from source with **vendored OpenSSL**, which needs **Strawberry Perl** (native
Windows perl — *not* Git/MSYS perl) and **NASM** on `PATH`, plus the MSVC toolchain. The first
build compiles OpenSSL and takes a few minutes; subsequent builds are cached.
