# Onboarding activation flow — design

**Date:** 2026-07-08
**Status:** approved design (in chat), pre-plan
**Supersedes:** the static wizard from `2026-07-08-onboarding-wizard-design.md` (merged in #2). Reuses that work's plumbing.

## Problem

The merged wizard is a static, four-steps-on-one-scroll info panel with a single demo
button. It reads like a brochure: zero action, no progress, no confirmation, nothing the user
*does*. Modern onboarding (1Password, Mintlify) is one step per screen, each with a concrete
action and a live confirmation that advances you — so you make progress and feel it.

## Goal

Rebuild onboarding as an **activation flow**: one step per screen, a progress rail, exactly one
action per step, and a live confirmation. The spine drives the user to their **first real
captured run**. Every step is skippable; the flow tracks completion so it can nudge later
without ever trapping the user.

## Non-goals

- No new Tauri backend commands. Everything reuses existing commands
  (`list_sessions`, `ollama_status`/`start_ollama`/`pull_model`).
- No fake progress bar. `pullModel` resolves as a single promise with no progress events, so the
  AI download shows an honest indeterminate "Downloading…" state, not a percentage.
- No change to `npm run capture` or the setup docs (shipped in #2).
- Not a hard gate. The user can always reach the app.

## Reused infrastructure (already in the tree)

- **Overlay + gating:** `onboardingOpen` store state, the `watcher.onboarded` localStorage flag,
  `openOnboarding()`/`closeOnboarding()`, the App mount, and the header reopen link — all from #2.
- **Demo streaming:** `startLiveDemo("abducted")` and the store's `demo: {phase, n, total}`
  progress — drives step ①'s live mini-readout.
- **Capture detection:** `LiveBridge` already polls `list_sessions` every 4s and ingests real
  captures into `sessionCards` (with `demo:false`) and sets `liveBanner`. The header — and thus
  `LiveBridge` — renders even under the overlay, so **no new poller is needed**. A real capture is
  simply `sessionCards.some((c) => !c.demo)`.
- **AI:** `src/lib/llm/runtime.ts` — `llmStatus()`, `startOllama()`, `pullModel(model)`,
  `nextSetupStep()`, `DEFAULT_MODEL`. Step ③ reuses these plus whatever setter the top-bar AI
  menu already uses to persist the chosen mode (to be pinned during planning).

## The steps (one per screen; progress rail `●─●─○─○  Step N of 4`; `Back`/`Next`/`Skip`)

**① Meet the Watcher — action: watch a real run.**
A `▶ Play a 60-second demo` button calls `startLiveDemo("abducted")`. The step then shows a live
mini-readout derived from the store's `demo` progress: `▶ streaming… {n}/{total}` → on
`phase === "compared"`, `✓ You just watched a full run`. Marked done once the demo has played.
`Next`. (If they never play it, `Next` still works — skippable.)

**② Capture your first run — the hero, live-verified.**
Shows `npm run capture -- --machine <box>` with a copy button. Baseline the current non-demo
session set on mount, then observe the store: when a new `sessionCards` entry with `demo:false`
appears, show `✓ Captured "<name>" — <n> commands` and an `Open my debrief →` button
(`switchSession(id)` + `closeOnboarding()`). Until then: `◦ waiting for a session…` and
`Skip for now — I'll capture later`. In the dev browser (no Tauri) live detection can't fire;
show an inline note that detection runs in the desktop app, and keep the step skippable.

**③ Sharpen your coaching — action: turn on AI (optional).**
On mount, `llmStatus()`. Branches:
- Local model missing → `⬇ Download local model (~2 GB)` calls `pullModel()`; while awaiting, an
  indeterminate `Downloading… (a few minutes)`; on resolve `true`, `✓ Local AI ready` and persist
  local mode. On `false`/throw, an inline error + retry.
- Model present → `✓ Local AI ready` immediately; a button confirms/keeps local mode.
- `Paste a cloud key` → routes to the existing cloud-key flow (reuse, don't rebuild).
- `Skip — rules-based coaching is solid` always present.

**④ You're set — recap + enter.**
A live checklist of what actually happened: `✓/○ Watched a demo · ✓/○ Captured a run ·
✓/○ AI coaching`, plus one pointer: `Load a write-up to unlock the write-up comparison`
(links to the existing reference-path control). `Enter the Watcher →` closes the wizard.

## State model

Add to the store (persisted alongside the existing flag):
- `onboardingStep: number` (0–3), the current step.
- `onboardingDone: { demo: boolean; ai: boolean }` — steps whose completion isn't derivable from
  app state. (Capture completion is **derived**, not stored: `sessionCards.some(c => !c.demo)`.)
- Actions: `setOnboardingStep(n)`, `markOnboardingStep(key)`.
- Persist `onboardingStep`/`onboardingDone` to `localStorage` under a namespaced key, via the same
  guarded reader/writer pattern as `watcher.onboarded` (node-test-safe).

## Resume nudge (the "never traps them" part)

A subtle header pill — `⚡ Finish setup · capture a run →` — renders when
`onboarded === true` AND no real capture exists yet (`!sessionCards.some(c => !c.demo)`). Clicking
it reopens the wizard at step ②. It disappears automatically the moment a real session lands. This
converts "skippable" into "still drives activation." (Replaces / supplements the existing static
"Setup guide" header link, which stays as the always-available reopen.)

## Components & boundaries

- `src/components/Onboarding.tsx` — rewritten as a stepped state machine driving one
  `<StepShell>` at a time (progress rail + Back/Next/Skip chrome). Presentational; reads store
  signals and the LLM runtime.
- `src/lib/onboarding.ts` — extend with **pure** step logic: `stepList`, a `deriveChecklist(state)`
  helper, and `shouldShowNudge({ onboarded, hasRealCapture })`. Unit-tested in node.
- `src/store/report.ts` — `onboardingStep` + `onboardingDone` + setters, persisted (guarded).
- Header nudge pill — a small presentational piece in `App.tsx`'s header cluster.
- Unchanged: `scripts/capture.mjs`, docs, `tests/capture-docs.test.ts`.

## Testing

- **Pure logic (node vitest):** `shouldShowNudge`, `deriveChecklist`, step-advance bounds
  (can't go below 0 or past last), persistence init/round-trip in the store.
- **Component:** SSR-render each step shell to confirm it mounts with the right copy and the
  progress rail (no jsdom; matches repo convention).
- **Manual (desktop):** click-through — demo plays and marks ①; capture step flips to ✓ when a
  real session lands; AI download path; nudge pill appears after skip and clears after a capture.

## Decisions locked (from chat)

- Activation flow, one step per screen, skippable with resume nudge (user choices).
- Step ③ includes the real in-wizard `pullModel` download (indeterminate, honest).
- 4 steps; reference-path folded into step ④ as a pointer, not its own gated step.
- Intro demo: Abducted.
