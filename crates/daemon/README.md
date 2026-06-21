# watcher-daemon — the single SQLCipher owner

Wires the proven pieces into one process. Both capture agents and plugins feed it the §3.3
telemetry envelope (over Native Messaging / a unix socket); the daemon:

1. **re-redacts on receipt** (`watcher_core::redact`) — never trusts an upstream's own scrubbing,
   the privacy guarantee lives in the core;
2. **owns session boundaries** (`watcher_core::SessionController`) — honors upstream
   `session_start`/`session_end` (from the browser extension or capture), auto-starts/closes
   otherwise, and surfaces flag nudges;
3. **stamps + persists** command/output to the encrypted SQLCipher store under the active session.

`process()` is a pure transform (no DB) so it's fully unit-tested; `main` does the persistence.

## Run

```bash
# pipe a capture straight through the daemon into an encrypted per-engagement DB
watcher-capture --label "HTB :: Optimum" -- whoami "cat root.txt" \
  | watcher-daemon --db optimum.db --key <passphrase>

cargo test --manifest-path crates/daemon/Cargo.toml   # process: re-redact + stamp + nudge; auto-start
```

## Architecture

```
capture (local PTY) ─┐
browser ext (HTB)  ──┼─▶ watcher-daemon ──▶ SQLCipher store
plugins (socket)   ─┘     re-redact
                          SessionController (boundaries)
                          stamp session_uuid
```

Shares `watcher-core` (session controller + redaction) with the capture agent, so the session
lifecycle is identical whether a boundary comes from HTB spawn/stop, a manual start, idle, or a flag.

## Build prerequisites

Depends on `watcher-store`, so the same SQLCipher build prerequisites apply (Strawberry Perl + NASM
+ MSVC on Windows). See `crates/store/README.md`.
