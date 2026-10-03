# The Watcher — live widget — design

**Status:** approved for planning
**Date:** 2026-10-03
**Author:** silofy (with Claude)

## Problem

The Watcher's value today lands *after* the run — the debrief, the Ghost, the one
lesson. While you're actually working a box there's nothing beside you. The app's
"Live Ops" exists but is a full panel inside the desktop app, not an ambient,
glanceable surface you keep next to your terminal.

This feature adds a **live widget**: a small companion that sits beside a hacking
session and surfaces valuable, *non-spoiling* information as you move through a box.

## The hard constraint (decided)

The widget must **not become a walkthrough.** The entire point of practice is
black-boxing the target, and the tool grades **independence** and **methodology**.
A widget that prescribes the next exploit ("run `X`") destroys both. So:

- The default experience **never prescribes the answer.** It mirrors *your own*
  activity and coaches *process*, not solution.
- The only path toward the answer is an **opt-in, tiered hint the user pulls**, and
  pulling it **dents the independence score**. The grade enforces the discipline, so
  the tension becomes a feature rather than a leak.

## Goals

- An ambient, glanceable surface beside the terminal that makes the operator more
  **self-aware and methodical** mid-run.
- Zero spoilers by default; any approach to the answer is user-initiated and graded.
- Reuse the live signals the capture pipeline already derives (kill-chain position,
  stealth burn, findings, methodology/focus) — no new analysis engine.
- Work where people actually hack: SSH, Pwnbox, headless — not desktop-only.

## Non-goals (v1)

- Not a solver, not a next-exploit recommender, not box-specific guidance by default.
- No new capture source or analysis engine; it consumes the existing live stream.
- Not the full debrief — detail/teaching stays in the post-run report.
- Floating desktop window is v2 (see Form factor); v1 is the TUI.

## What it surfaces (three tiers by how much it "knows")

1. **Spoiler-free, always on** — pure state + discipline, zero box knowledge:
   - kill-chain position + elapsed / pace
   - stealth burn (flashes on a loud spike; names the loudest tool)
   - breadth / coverage ("3 ports open, 1 engaged") — promotes enumeration
   - rabbit-hole nudge ("8 min on one surface — enumerated everything else?")
2. **Open threads — reflective, your own findings** (reminds, never instructs):
   - "an unused credential is sitting in your loot"
   - "a share listed — permissions audited?"
   - Worded as loose threads you created, not actions to take.
3. **Hints — opt-in and graded** (the only approach to the answer):
   - Never shown by default. A "stuck → hint" the user pulls, tiered
     `nudge → category → specific`.
   - Each tier recorded to the session and **dents the independence metric**.

## Form factor

One shared live model, two renderers:

- **TUI (v1)** — a text widget in a pane beside the shell (tmux-friendly). Works over
  SSH, on Pwnbox, headless. Fed by the capture agent's live stream.
- **Floating window (v2)** — a borderless, translucent, always-on-top Tauri window for
  the desktop "Apple widget" aesthetic, reusing the React store.

Three sizes (Apple-widget analogy):

- **small** — phase + one coaching line.
- **medium** — status strip (phase · stealth · pace) + coaching line + latest thread.
- **large** — adds the open-threads list, findings ticker, and pace.

## Behaviors (event-driven, calm until it matters)

- new finding → findings ticker
- phase advance → tracker steps + brief milestone
- open thread detected → gentle persistent marker (not a popup)
- loud spike → stealth meter flashes
- stuck on one surface too long → rabbit-hole nudge
- root / flag → milestone celebration
- hint pulled → records the tier to the session (feeds the grade)

## Architecture

- A small derived **`WidgetState`** — `{ phase, pace, stealth, coverage,
  openThreads[], nudges[], hints }` — computed from the live capture stream, reusing
  the signals Live Ops already derives (no new engine).
- **TUI renderer** consumes `WidgetState` from the capture agent; **Tauri window**
  (v2) consumes the same model via the React store.
- A **hint pull is a recorded session event**, so the debrief and the independence
  metric both see it. This is the single new write-path into the report.

## Testing (TDD)

- `WidgetState` derivation: from a fixture live stream, phase/stealth/coverage/open
  threads compute deterministically; a generic command never produces a box-specific
  nudge.
- Open-thread detection: an unused credential and an unaudited share surface as
  threads; once used/audited, they clear. No thread implies an action verbatim.
- Hint ladder: pulling tiers records the correct independence penalty; default
  (no pull) leaves independence untouched.
- TUI render: a snapshot of each size from a fixed `WidgetState`.

## MVP vs later

- **MVP:** TUI, medium size, tiers 1–2 + the graded hint pull.
- **Later:** the floating Tauri window, size variants, richer open-thread detection,
  milestone animations.

## Global constraints

- No spoilers by default; the only approach to the answer is opt-in and graded.
- Deterministic signals; a model may sharpen wording, never invent guidance.
- Reuses the existing live stream and analysis; new code is the `WidgetState`
  derivation, the TUI renderer, and one recorded hint event.
- Redaction-safe: the widget shows only already-redacted, already-captured facts.
