# Watcher browser extension (MV3) — HTB session triggers + terminal tap

Module 1 §3.2. Two jobs:

1. **Session triggers** — watches HTB's v4 API for **machine spawn / stop** and turns them into
   `session_start` / `session_end` events (the same lifecycle the local daemon emits). This is what
   makes "I'm about to play a machine" automatic: spawn *Optimum* → a report begins, scoped to that
   box; stop it → the report ends.
2. **In-browser terminal tap** — for text terminals (ttyd/wetty/GoTTY) it taps the WebSocket PTY
   stream (with a `.xterm-rows` DOM fallback) and emits §3.3 envelopes. Pixel-streamed desktops
   (noVNC/Guacamole — much of Pwnbox/AttackBox) have no DOM text; those need the in-VM daemon.

## Why two worlds

A content script in the **ISOLATED** world can't see the page's `WebSocket`/`fetch`, so the tap
(`inject.js`) runs in the **MAIN** world; `relay.js` (ISOLATED) is the only context allowed to call
`nativeMessaging`. The service worker (`background.js`) classifies and forwards to the daemon.

```
inject.js (MAIN: tap fetch + WebSocket, inline-redact)
   → window.postMessage →
relay.js (ISOLATED: chrome.runtime.sendMessage)
   → background.js (classify via lib/detect.js, map to §3.3 / session control)
   → Native Messaging → watcher-daemon (SQLCipher owner, re-redacts, drives SessionController)
```

## Privacy

`inject.js` redacts (IPs, flag hashes) **before** anything leaves the page — there is no termios in
the browser. The daemon re-redacts on receipt (never trusts an upstream's scrubbing). HTB API taps
forward only `machine_id` (not sensitive).

## The core is tested; the wiring is loadable-unpacked

`lib/detect.js` holds the pure logic — `classifyHtbActivity`, `toSessionControl`, `redact`,
`wsFrameToEnvelope` — covered by `lib/detect.test.ts` (`npm test`). A live HTB run needs a real
account + browser, so the content-script wiring is exercised by hand: load `extension/` as an
unpacked extension and register `native-host/com.thewatcher.host.json` under the OS's
NativeMessagingHosts location (fill in the extension id; point `path` at a launcher that runs
`watcher-daemon --native-messaging --db <engagement.db> --key <keychain-key>`, since Chrome invokes
the host with no extra args).

## Maps onto the session controller

`session_start { target_scope, context_path: "cloud:htb", origin.machine_id }` and
`session_end { reason: "machine_stopped" }` are exactly what `capture/src/session.rs`
(`SessionController::start/stop`) consumes — so the HTB triggers and the local daemon share one
session lifecycle.
