# Onboarding wizard + `npm run capture` — design

**Date:** 2026-07-08
**Status:** approved design, pre-plan

## Problem

A new desktop user opens the Watcher and lands **directly on a fully-populated demo
debrief** (`view: "debrief"`, the store preloads the Abducted/RootMe demos). Nothing tells
them it's a demo, that it isn't their run, or how to record their own.

When they go looking, the setup instructions are inconsistent and confusing. Every surface
writes `watcher-capture --attach --machine <name>` as if it were a globally-installed
command — it never is. It's a Rust binary in `crates/capture/target/…` that nothing puts on
`PATH`. A real user copied that bare command and got "command not found." The in-app Install
tab is the worst offender: a bare command with no build step and no path.

## Goals

1. First launch opens onto a deliberate, streamlined **first-run wizard**, not the demo debrief.
2. One true capture command that works cross-platform from the repo root: `npm run capture`.
3. The confusing bare-`watcher-capture` copy is gone from every surface (wizard, Install tab, README, CAPTURE.md).
4. Optional/advanced paths (Pwnbox, shells, reference path, AI coaching, `--web`/Burp) stay
   out of the critical path — mentioned, linked, never gating.

## Non-goals

- The wizard does **not** shell out, detect toolchains, or verify a capture landed. It is an
  orient-and-point guided tour (pure frontend). "Verify it works" was considered and rejected
  as heavier than needed.
- No change to the capture agent's own CLI, the report pipeline, or scoring.
- Not retiring the Install tab — it becomes the clear "reference/advanced" home behind the wizard.

## The four pieces

### 1. `npm run capture` wrapper

A Node script `scripts/capture.mjs`, wired as `"capture": "node scripts/capture.mjs"` in
`package.json`. `npm run capture -- --machine Blue` becomes the single command every surface
points at, matching the `npm run dev` / `npm run doctor` pattern users already know.

Behaviour:
- Resolve `crates/capture`. If the release binary is missing or older than `src/`, run
  `cargo build --release --manifest-path crates/capture/Cargo.toml` first.
- Resolve the binary path per-platform (`watcher-capture.exe` on win32, `watcher-capture`
  elsewhere) under `crates/capture/target/release/`.
- `spawn` it with **stdio inherited** (the interactive PTY attach needs the real terminal)
  and forward every arg after `--`. Exit with the child's exit code.
- **Default to `--attach`** when the user passes no mode flag (`--attach`, `--export`, `-i`,
  `--interactive`), so the shortest happy path is `npm run capture -- --machine Blue`.
- If `cargo` is not found, print one clear line pointing at `npm run doctor` / rustup —
  never a raw "command not found."

Rationale for a wrapper over `cargo install` onto PATH: users doing capture already have
Node and are in the repo root (they ran `npm run tauri dev`); a global install adds a
`~/.cargo/bin`-on-PATH assumption and a separate mental model.

### 2. The wizard (`src/components/Onboarding.tsx`)

Full-screen, first-run-only, dismissible. Pure frontend. Four steps, all visible on one
scrollable panel (not a click-through carousel — short enough to read at once):

1. **What it is** — one-line value prop: a flight-data-recorder for hacking practice; record a
   run → graded debrief; read through MITRE ATT&CK · Kill Chain · CWE; all local.
2. **See it work** — `[ ▶ Watch a 60s demo ]`. Closes the wizard (sets the onboarded flag) and
   calls `startLiveDemo("abducted")`, streaming the **HTB Abducted** run live in the Debrief
   view via the existing demo machinery, then settling into the graded debrief.
3. **Capture your run** — the one command with a copy button:
   `npm run capture -- --machine <box>`. Note: other platforms use
   `--platform thm --target <name>`. Small aside: capture builds a small Rust agent; run
   `npm run doctor` if unsure you're set up.
4. **Go further (optional)** — three one-line bullets, each linking into the Install tab / docs,
   none gating:
   - Reference path → unlocks the write-up comparison.
   - AI coaching → sharper wording, still local-first.
   - Web capture (`--web` + Burp) → fold browser/HTTP attacks onto the same timeline; off by
     default, only for Burp workflows (`docs/web-capture.md`).

Footer: `[ Skip ]` and `[ Done → ]`. Both dismiss and set the onboarded flag.

### 3. First-run + persistence

- A `localStorage` flag `watcher.onboarded` gates the wizard. Absent/false ⇒ wizard shows on
  top; the app (`view: "debrief"`) is mounted behind it but visually covered. localStorage
  persists in the Tauri webview across restarts.
- **Skip**, **Done**, and step ②'s **Watch demo** all set `watcher.onboarded = "1"` and close.
- A small **"Setup guide"** text affordance in the header reopens the wizard anytime (sets an
  in-memory `wizardOpen`, does not clear the flag).
- `?onboarding=1` in the URL forces the wizard open for dev/testing regardless of the flag.

State lives in the zustand store (`useReport`): add `onboardingOpen: boolean` (initialised
from `localStorage`/`?onboarding=1`), `openOnboarding()`, `closeOnboarding()` (persists the
flag). `App.tsx` renders `<Onboarding/>` as a full-screen overlay when `onboardingOpen`, above
the existing `<main>`.

### 4. Install tab rewrite + docs

- **`src/components/Install.tsx`**: rewrite so every command is `npm run capture -- …` and
  copy-pasteable; the hierarchy is happy-path → advanced (Pwnbox, `--shell`, add-ons, `--web`);
  the bare `watcher-capture` that caused the confusion is gone. This is the depth behind the
  wizard's "Go further."
- **README.md** ("Capture your own runs") and **`crates/capture/CAPTURE.md`**: lead with
  `npm run capture -- --machine <box>`; demote the raw `cargo build` + `./target/release/...`
  invocation to an "advanced / no-Node" note. Keep the Pwnbox (Path B) prebuilt-binary flow as
  is — it already transfers a committed binary and doesn't hit this problem.

## Components & boundaries

- `scripts/capture.mjs` — build-if-needed + exec wrapper. Depends on the Cargo toolchain and
  the crate layout only. Testable by running it and observing it builds + launches.
- `src/components/Onboarding.tsx` — presentational wizard. Depends on the store for
  `closeOnboarding` and `startLiveDemo`. No data fetching.
- Store additions in `src/store/report.ts` — `onboardingOpen` + two actions. Isolated from
  report/derive logic.
- `Install.tsx`, docs — copy only, no new dependencies.

## Testing

- **Wrapper:** a smoke test / manual check that `npm run capture -- --machine X` builds (first
  run) then launches the agent with args forwarded; and that a missing `cargo` prints the
  guidance line rather than a stack trace.
- **Store:** unit test that `onboardingOpen` initialises from `localStorage`, that
  `closeOnboarding()` persists the flag, and that `?onboarding=1` forces it open.
- **Wizard:** component test that step ② calls `startLiveDemo("abducted")` and closes; that
  Skip/Done set the flag; that the header affordance reopens without clearing the flag.
- **Docs:** no automated test; covered by the copy no longer containing a bare
  `watcher-capture` command (a grep check can guard this).

## Decisions already made (flippable)

- Demo for step ②: **Abducted** (user choice).
- Header reopen affordance: **yes** (user choice).
- `--web`/Burp: **optional bullet in step ④**, never a gate (user choice).
- Wizard is orient-and-point, full-screen, once, re-openable (user choices from brainstorming).
