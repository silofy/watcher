# The Watcher — Report UI (Phase 1)

A local-first "flight data recorder" for offensive-security practice. This repo is the
**Phase 1 vertical slice**: a Tauri + React + Tailwind app that renders the full interactive
report from a schema-versioned session JSON — the product's "mirror" (design brief §6).

> Status: **Phase 1 complete** (report UI, confirmed running as a native Tauri desktop window) and
> the **deterministic core of Phase 3** built (`src/lib/pipeline/`: segmentation, MITRE table,
> golden-DAG alignment — raw telemetry → the report contract). The capture daemon, the offline LLM
> refinement passes, the browser extension, and the Enterprise Bridge are roadmapped (see
> `The_Watcher_Design_Brief.docx` and the build plan) but not built here. Everything attaches to the
> same JSON contract — which is locked.

## The data contract (load-bearing)

Everything hinges on one schema-versioned document, `schema/watcher-report.schema.json` (v1.0) —
the same blob embedded in the portable HTML export and signed by the Enterprise Bridge. The UI
consumes it; every future backend module produces it. `fixtures/session-htb-easy.json` is a
realistic hand-authored run (a believable HTB-easy box) validated against the schema in CI.

## Quick start

```bash
npm install
npm run dev        # Vite dev server → http://localhost:5173
npm test           # 44 tests: metrics, scale, schema-validation, redaction, full-render smoke
npm run export     # build + emit dist/report.html — self-contained, public_safe, opens at file://
```

### Desktop (Tauri)

```bash
npm run tauri dev   # builds the Rust shell (~4 min first compile) and opens the report window
```

Confirmed working on Windows 11 with the MSVC toolchain + WebView2 (Rust 1.96, MSVC). Icons live in
`src-tauri/icons/` (regenerate from a source PNG with `npm run tauri icon <path>`). The report is
OS-agnostic and also fully exercised via the Vite path and the test suite.

## What's in the report (brief §6.2)

Seven sections on **one shared time axis**, with a single **actor-mode color vocabulary**
(`tool` / `manual` / `stuck` / `detour`) used identically on every chart:

1. **Verdict header** — score dials (efficiency, stealth, coverage, independence) + diagnosis
2. **Attack timeline** — MITRE swimlane, actor-colored ribbon, hover/click cross-highlight
3. **Stealth & noise** — loud-moment pins on the shared axis
4. **Command replay** — DVR scrubber, playhead synced to the timeline
5. **Path comparison** — git-diff of your route vs the golden DAG (skipped/detour/alternative)
6. **Phase deep-dives** — collapsible per-tactic cards
7. **Coaching** — skill radar + next steps

Hover a timeline block → the command log and the replay playhead follow it (cross-highlight via
the Zustand store).

## Determinism (brief §4.3, §6.1)

All metrics are computed by `src/lib/metrics.ts` — pure, reproducible, and unit-tested. A re-run
yields byte-identical numbers (grading defensibility). The engine reproduces the brief's example
framing from the fixture: **recon 91%, privesc 40%, 23 minutes lost before `sudo -l`**. The
fixture's stored `metrics`/`phases` are a conformance check against the engine.

## Phase 3 — deterministic processing (`src/lib/pipeline/`)

Turns the normalized capture telemetry (§3.3) into the report contract, all deterministically —
the offline LLM only ever refines these priors, never replaces them:

- **`segment.ts`** — episode segmentation (§4.1): machine-time vs think-time, actor-mode tagging,
  and breaking a long pause into its own `think_pause`/`idle` episode so the Time-Waster sees it.
- **`mitre.ts`** — the deterministic MITRE lookup table (§4.2) that gives the ~80% prior, plus the
  few-shot context overrides (`python -m http.server` during privesc = staging; reverse shells = Execution).
- **`align.ts`** — Needleman-Wunsch-style diff vs the golden DAG (§4.3): match / alternative / detour /
  loop / skipped / out-of-order, with a deterministic stand-in for the LLM's objective-equivalence judgment.
- **`index.ts`** — `runPipeline(raw, { golden })` → `{ episodes, phases, golden, metrics }`, the same
  shape the Phase 1 UI consumes.

## Capture POC (`capture/`) — Windows is native, not WSL

A Rust proof-of-concept for the Phase 2 daemon that de-risks the cross-platform question:
it captures a shell session **natively through ConPTY on Windows** (openpty on Unix, one
`portable-pty` API), VT-parses the output, and emits the §3.3 telemetry envelope as NDJSON —
the same data the pipeline consumes. **No WSL/VM required for Windows users.** See
`capture/README.md`. Run: `cargo run --manifest-path capture/Cargo.toml`.

### End to end: capture → report

`src/lib/pipeline/ingest.ts` joins the telemetry envelopes into the pipeline's `RawCommand`
stream and assembles a complete, schema-valid report. So a live capture flows all the way to
a rendered HTML report in one command:

```bash
cargo run --manifest-path capture/Cargo.toml -- "whoami" "nmap -sV 10.0.0.1" "sudo -l" \
  1> capture/events.ndjson           # 1) capture (ConPTY, OSC 133 → exact boundaries + exit codes)
npm run export:capture               # 2) ingest → pipeline → schema-valid report → report-from-capture.html
```

`npm run ingest` does just the NDJSON → report step, and also writes
`fixtures/session-live-capture.json` so the captured session appears in the **header dropdown of
`npm run dev`** alongside the curated demo — switch between them live.

The capture crate also has a **cursor-addressable grid for full-screen TUIs** (vim/htop), a
**raw-mode `--interactive`** live mode, and a sibling **`store/`** crate that persists telemetry
into an **encrypted SQLCipher** DB (AES-256). See `capture/README.md` and `store/README.md`.

## Session lifecycle — when a report starts and stops

The recorder is always rolling; a *report* is a bounded window over the stream, decided by signals
(strongest wins) with manual override and retroactive fix-up always available:

- **Session controller** (`capture/src/session.rs`) — the spine. Manual `start(label)`/`stop`,
  optional auto-start, **idle auto-close**, and **flag detection** (a 32-hex token is an
  "objective-complete" *nudge*, never a silent stop). It stamps each event with the active session
  and brackets the stream with `session_start`/`session_flag`/`session_end` markers.
- **HTB auto-triggers** (`extension/`) — the MV3 extension watches HTB's v4 API for **machine
  spawn/stop** and emits `session_start`/`session_end` — the same kinds the controller consumes. So
  "I'm about to play a machine" → a report begins, scoped to that box; stop it → the report ends.
- **Retroactive trim** (`src/lib/trim.ts` + the "Session window" control in the report) — drag the
  start/end and the whole report re-derives deterministically. The safety valve for any missed or
  over-eager boundary.

Verified live: a captured session that ends with a flag emits `session_start → session_flag →
session_end` and persists into the SQLCipher DB.

## Layout

```
schema/watcher-report.schema.json   # the v1.0 contract (test oracle for all future modules)
fixtures/session-htb-easy.json      # realistic mock, validated against the schema
src/lib/{scale,metrics,format,redact}.ts   # shared axis, deterministic metrics, redaction
src/lib/pipeline/*.ts               # Phase 3 deterministic processing (segment, MITRE, align)
src/store/report.ts                 # Zustand: normalized store + cross-highlight/DVR state
src/components/*.tsx                 # the 7 report sections + shared UI primitives
scripts/export-html.tsx             # portable, self-contained HTML export (brief §6.3)
src-tauri/                          # desktop shell (Tauri 2; confirmed launching)
core/                              # Rust shared core — session lifecycle controller + re-redaction
capture/                           # Rust PTY-capture (ConPTY/openpty, grid+OSC133)
store/                             # Rust encrypted store (SQLCipher / AES-256) — §8 schema
daemon/                            # Rust daemon — merges sources, re-redacts, owns sessions, persists
extension/                         # MV3 browser extension — HTB spawn/stop session triggers + terminal tap
plugins/                           # open plugin API (§5.4) — SDK, examples, conformance kit
schema/watcher-telemetry.schema.json   # §3.3 wire contract (envelope + capability handshake)
schema/watcher-plugin.schema.json      # plugin manifest (supervised, least-privilege)
src/lib/bridge/                    # Enterprise Bridge — grading rubric + signed, chained attestations
src/lib/llm/                       # offline LLM refinement (deterministic-first; Ollama or rules-only)
src/lib/trim.ts                    # retroactive session-window trim (deterministic re-derive)
tests/                              # schema-validation + full-render smoke + conformance
```

## Offline LLM refinement (§4.2 / §4.3 / §5.1)

The semantic layer is **deterministic-first and optional** — the LLM only refines compact cards
(MITRE classification, objective-equivalence), never raw bytes, and with no model everything runs
**rules-only**. `selectTier` probes RAM/cores/GPU and picks the largest local quantized model that
fits (down to rules-only); a GBNF grammar / JSON schema keeps a quantized model in valid JSON; the
`OllamaProvider` runs entirely on-device. The desktop shell **manages Ollama as a Tauri sidecar**
(`src-tauri/src/llm.rs`: `ollama_status` / `start_ollama`), and the report header shows a live
**LLM status chip** (`ollama` / `rules-only`). `npm run llm:probe` shows the tier and reachability.
See `src/lib/llm/README.md`.

## Enterprise Bridge (§6.4)

The institution never receives raw telemetry — only a **cryptographically signed, hash-chained,
manager-profile attestation**: scores + evidence *digests*. The student previews exactly that bundle
and consents before sync (the "Enterprise Bridge" panel in the report). Grading is an **explainable
weighted rubric** — coverage 35 · breadth 20 · efficiency 15 · discipline 15 · independence 15 —
where **independence is a gate**, routing a high-skill / low-independence result to an integrity
queue with an evidence bundle (a signal to a human, never an automated verdict).

- `src/lib/bridge/grade.ts` — the rubric (pure, browser-safe).
- `src/lib/bridge/bundle.ts` — manager-profile minimization (no raw telemetry; the scope label is redacted).
- `src/lib/bridge/attest.ts` — ed25519 sign / verify / **hash chain** (`node:crypto`; daemon-side).
- `npm run attest [report.json]` — grade → signed attestation → schema-validate + verify + chain.

Verified: tamper any score and the hash breaks; swap the signature and verification fails; the chain
detects a spliced link.

## Open plugin API (§5.4)

A plugin is **any process that emits valid messages to the daemon's socket** — a capability
**handshake** then §3.3 envelopes (`schema/watcher-telemetry.schema.json`). The daemon recognizes
the handshake, fills the provenance the plugin can't provide, and **re-redacts regardless** of what
the plugin claims. Contributors self-validate with `npm run conformance <stream.ndjson>`; the
~50-line `plugins/sdk/watcher_sdk.py` handles the framing. Verified live: a Python plugin streams a
handshake + session into the running daemon, which logs `⌁ plugin … ▶ session_start … ⚑ flag nudge`
and persists to the encrypted store. See `plugins/README.md`.

## The daemon (single SQLCipher owner)

`daemon/` ties the proven pieces into one process: every source (local PTY capture, the HTB browser
extension, plugins) feeds it §3.3 envelopes; it **re-redacts on receipt**, **owns the session
boundaries** (`watcher-core` is shared with the capture agent, so HTB spawn/stop, manual, idle, and
flag boundaries behave identically), **stamps** each event with the active session, and **persists**
to the encrypted store:

```
capture · browser-ext · plugins ─▶ watcher-daemon ─(re-redact · SessionController · stamp)─▶ SQLCipher
```

It runs as a real service in three modes (one pipeline, one store owner):

```bash
watcher-daemon --listen 127.0.0.1:8799 --db engagement.db --key <k>   # long-running socket service
watcher-daemon --native-messaging --db engagement.db --key <k>         # Chrome Native-Messaging host (browser ext)
watcher-capture --label "HTB :: Optimum" -- whoami "cat root.txt" | watcher-daemon --db engagement.db --key <k>   # batch
```

Verified live: a TCP client streaming `session_start → command → output(flag) → session_end` makes
the running daemon log `▶ session_start → ⚑ flag nudge → ■ session_end` and persist the
re-redacted, session-stamped rows into the encrypted DB.
