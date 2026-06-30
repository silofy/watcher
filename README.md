# The Watcher

A local-first **flight-data-recorder for offensive-security practice**. It records the commands you
run against a box (HTB, labs, CTFs) and turns them into a graded debrief — a Lighthouse-style audit
per MITRE phase: what you achieved, where you wasted time, and what to do better next time.

Everything runs on your machine. No account, no telemetry, no cloud.

> **Testing this?** Start with **[TESTING.md](TESTING.md)**.

## Try it

- **Just see the report (no install):** open `report.html`, or generate it with
  `npm install && npm run export` → `dist/report.html`. It's a self-contained demo debrief.
- **Run the app:**

  ```sh
  npm install
  npm run tauri dev     # desktop app
  # or
  npm run dev           # report UI in a browser → http://localhost:5173
  ```

## What you get

- **Phase audit** — one card per MITRE phase (Recon → … → PrivEsc): objectives reached, dead-ends,
  loops, stalls, and the highest-impact next moves, each with an estimated time saved.
- **Verdict** — an explainable grade (coverage · technique breadth · efficiency · stealth ·
  independence) plus a skill radar.
- **Supporting views** — timeline, deviations, stealth/noise, and the command log on one shared axis.
- **Intended-path comparison** — paste a write-up and your run is diffed against the optimal route.

## Capture your own runs

```sh
cd crates/capture && cargo build --release
./target/release/watcher-capture --attach --machine <box>
```

Commands stream into the app live; `exit` to stop. Full guide (incl. Pwnbox):
**[crates/capture/CAPTURE.md](crates/capture/CAPTURE.md)**.

## How it works

A small Rust agent captures your shell through a normal PTY (ConPTY on Windows, openpty on Unix — **no
eBPF, ptrace, or kernel hooks**). The capture is processed **deterministically** (segmentation, MITRE
tagging, golden-path diff, metrics) into one versioned JSON report
(`schema/watcher-report.schema.json`) that the UI renders. An optional local LLM (Ollama) only sharpens
the coaching text — it never changes the numbers.

## Layout

```
src/            report UI (React + Tailwind) + deterministic pipeline & metrics
src-tauri/      desktop shell (Tauri)
crates/         the Rust side:
  capture/        PTY capture agent
  core/           shared session lifecycle + redaction
  daemon/         optional: single-owner store daemon
  store/          optional: encrypted SQLCipher store
plugins/        optional plugin API (SDK + conformance kit)
schema/         the versioned JSON contracts
fixtures/       sample sessions   ·   scripts/ tests/   tooling & tests
```

## Privacy

Your session never leaves the machine, redaction runs before anything hits disk, and the only optional
outbound traffic is fetching public write-ups. More in [TESTING.md](TESTING.md).
