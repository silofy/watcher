# The Watcher — tester guide

A local-first flight-data-recorder for offensive practice. It records the commands you run against a
box and turns them into a graded debrief: a **Lighthouse-style audit per MITRE phase** (objectives hit,
dead-ends, loops, stalls, and the moves that would've saved you time), a stealth/noise read, and an
explainable grade.

You're being asked to evaluate **the report** — is this how you'd actually want a debrief?

---

## Don't trust the binary. That's the point.

There are **no prebuilt executables** in this drop, deliberately. You run a static HTML file, or you
build from source you've read. Specifically:

- **Local-first, offline.** No account, no telemetry, no phone-home. The *only* outbound traffic is the
  **optional** write-up fetch from public sources (HTB / 0xdf / IppSec) — readable in
  `extension/lib/writeup.js`. Don't use it and there is zero egress.
- **Capture is userspace PTY only** — ConPTY on Windows, `openpty` on Unix (one `portable-pty` call).
  **No eBPF, no ptrace, no `LD_PRELOAD`, no kernel module, no API hooking, no root.** Read
  `crates/capture/src/main.rs`: it spawns your shell in a PTY and reads OSC-133 markers. That's the whole
  mechanism — nothing your EDR will scream about.
- **Your session never leaves the machine.** Redaction runs before anything hits disk
  (`core` crate / `src/lib/redact.ts`). Optional LLM coaching is a **local** model (Ollama) — no cloud
  inference, ever.
- **Small enough to audit:** `src/` (report UI, TypeScript) + `crates/capture/` (the agent, Rust). Read it in
  a sitting, then decide.

---

## 1. Just look at the report — zero install

The deliverable is a self-contained debrief of the *Uploadr* box (IPs masked, `public_safe`) — no
server, no install. Get it one of these ways:

- **Hosted:** open **`<URL>`** — nothing to run.
- **From this drop:** open **`report.html`** if it's present. Chat tools (Slack, Gmail) strip standalone
  HTML as a security measure, so it may be omitted from the archive — if so, generate it in seconds:
  ```sh
  npm install && npm run export      # → dist/report.html
  ```

Then click through the Phase Audit, expand a phase, open the Details accordion, scrub the timeline.

---

## 2. Run the real app — from source

**Prereqs:** Node 20+, Rust ([rustup](https://rustup.rs)), and your platform's Rust/Tauri build deps —
on **Windows** the Microsoft C++ Build Tools (the linker) + WebView2 (preinstalled on Win11); on
**Linux** `webkit2gtk`; on **macOS** Xcode Command Line Tools. See
<https://tauri.app/start/prerequisites/>. **No Perl/NASM/SQLCipher** for this path.

From the unzipped folder (or `git clone <repo> && cd watcher`):

```sh
npm install
npm run tauri dev        # builds + launches the desktop app (cold build ~5–15 min, then instant)
```

No Rust, just want the UI in a browser?

```sh
npm run dev              # http://localhost:5173  (capture + local-AI are desktop-only)
```

Sanity-check it does what it claims: `npm test` (180 tests) · `cd crates/capture && cargo test`.

---

## 3. Capture your own engagement

No browser extension required. Build the agent yourself (lean — no SQLCipher):

```sh
cd crates/capture && cargo build --release
```

With the desktop app open and HTB's VPN connected, start a watched shell:

```sh
./target/release/watcher-capture --attach --machine Forge
```

Hack as normal — each completed command shows up in the debrief in ~1–4 s. Type `exit` to stop; it
closes the session itself. Runs on the same machine as the app (reads `~/.watcher/sessions/`).

For the **intended-path comparison** (coverage, "what you'd do differently"), open *What you'd do
differently → Reference path → Add write-up* and paste any write-up — parsed locally (keyword fallback
without Ollama). Everything else (deviations, time waste, stealth, techniques, grade) works without it.

Playing in **Pwnbox**, or want the full auto-detect/auto-pull extension? See
[`crates/capture/CAPTURE.md`](crates/capture/CAPTURE.md) and the in-app **Install** tab.

---

## What I want from you

- **The report first.** Is the per-phase audit the right shape for a debrief? What's confusing, wrong,
  or missing — bluntly.
- Did capture match how you actually played the box?
- Is the coaching useful, or generic/obvious?

## What it does NOT do (threat model, short)

- No outbound traffic except the optional public write-up fetch.
- No persistence, no privilege escalation, no AV-evasion, no kernel/EDR hooks.
- The AES-256 SQLCipher store is an *optional* daemon path; this tester flow never starts it and writes
  only plain session JSON under `~/.watcher/sessions/`.
