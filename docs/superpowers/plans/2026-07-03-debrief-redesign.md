# Debrief Redesign (Direction B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Reorganize the debrief into the validated **direction B** two-column dashboard — a sticky identity/verdict rail beside a scrollable narrative, with the ~10-item accordion collapsed into one tabbed "Deep dive" panel. Presentation-only: no metric/grade/pipeline change; existing detail components are reused, only their placement changes.

**Architecture:** Two new container components — `DebriefRail` (sticky left) and `DeepDive` (tabbed panel) — compose existing components; `App.tsx`'s debrief branch becomes a two-column grid. Detail component internals are NOT rewritten. Reference: `docs/superpowers/specs/2026-07-03-debrief-redesign-design.md`.

**Tech Stack:** React, Tailwind, Zustand, Vitest (node env, pure-logic tests only — NO DOM), inline SVG.

## Global Constraints
- **TDD**; green gate each task: `npm test` + `typecheck` + `build` + schema round-trip.
- **Presentation-only:** do NOT change any metric, grade, engine, or pipeline output, or any detail component's internal logic. A test asserts the report data is untouched.
- **Additive move, not rewrite:** components move between rail / main / deep-dive; their internals stay. Extract only the two new containers.
- **Preserve deep-links:** `reveal(seq)` from coaching/cards must still scroll/highlight the right step (now inside a deep-dive tab — opening the tab + revealing).
- **Preserve live/post:** the frame stays mounted across the recording→resolved flip (today's `LiveDashboard` behavior). Rail + main handle both states.
- **Responsive:** two columns at `lg:`; rail stacks above main on narrow widths (not sticky on mobile). No horizontal page scroll (wide deep-dive panels scroll internally).
- **Accessibility:** deep-dive tabs are `role="tablist"` with real `<button>`s, `aria-selected`, arrow-key nav.
- Pure logic (tab config/resolver, any geometry) in `.ts` helpers, unit-tested.

## Current debrief (what we're restructuring) — `App.tsx:97-147`
verdict band (`IdentityBar`) → Ops bento (`LiveDashboard`) → `PhaseAudit` → a Details accordion stack: `PathComparison`, `Assessment`, `AttackTimeline`, `FrameworkAxes`, `DeviationTimeline`, `StealthReport`, `CommandReplay`, `Findings`, `GhostCard`, Session window (`SessionFacts`+`TrimControl`), all sharing the `Collapse name="debrief-details"` group.

## Target (direction B)
- **Left rail (sticky):** identity + rooted status; grade + 8-dim radar; key numbers; ghost-mini (wins/time-lost).
- **Main column (scroll):** 1 the one lesson · 2 what you'd do differently (coaching) · 3 `PhaseAudit` · 4 `PathComparison` · 5 `GhostCard`.
- **Deep dive (tabs):** `AttackTimeline` · `StealthReport` · `DeviationTimeline` · `FrameworkAxes` · `Findings` · `CommandReplay`. Session window behind a small "⋯" control, not a tab.

---

## Task 1: `DeepDive` tabbed panel (thin the accordion)

**Files:** Create `src/components/DeepDive.tsx`, `src/lib/deep-dive.ts` (+ `.test.ts`). Modify `src/App.tsx` (replace the accordion stack with `<DeepDive />`).

**Interfaces:**
```ts
// src/lib/deep-dive.ts — pure config + resolver (unit-tested)
export type DeepDiveTabId = "timeline" | "stealth" | "deviation" | "frameworks" | "findings" | "log";
export interface DeepDiveTab { id: DeepDiveTabId; label: string; }
export const DEEP_DIVE_TABS: DeepDiveTab[]; // ordered
export function isDeepDiveTab(id: string): id is DeepDiveTabId;
```

- [ ] **Step 1: Read** `src/components/ui.tsx` (`Section`/`Collapse`), the six detail components' top-level render (`AttackTimeline`, `StealthReport`, `DeviationTimeline`, `FrameworkAxes`, `Findings`, `CommandReplay`) to confirm they render standalone (they do — they're used standalone today). Note any that self-wrap in a `Section`/`Collapse` (you'll render them without the outer Collapse inside a tab).
- [ ] **Step 2: Write the failing test** (`deep-dive.test.ts`): assert `DEEP_DIVE_TABS` has the 6 ids in order; `isDeepDiveTab("timeline")` true, `isDeepDiveTab("nope")` false. (Pure config guard.)
- [ ] **Step 3: Implement `deep-dive.ts`** (the config + guard) and **`DeepDive.tsx`**:
  - A `role="tablist"` of `<button>` tabs (arrow-key nav, `aria-selected`), local `useState<DeepDiveTabId>("timeline")`.
  - Renders the active tab's component (a `switch` on the id → the component). Each detail component renders WITHOUT its own Collapse wrapper (show it directly in the panel). If a component only exists as a `Section collapsible`, render it forced-open or extract its inner content — prefer the least-invasive: render the component as-is if it degrades acceptably, else pass a prop / render its body.
  - Wrap the panel body in `overflow-x-auto`.
  - Deep-link support: expose a way for `reveal(seq)`-driven navigation to switch to the relevant tab (e.g. the store already tracks `revealSeq`/`revealNonce`; when a reveal targets the command log/timeline, switch to that tab). Minimal: if `revealNonce` changes, switch to the "log" tab (or "timeline") so the highlighted step is visible. Keep it simple; if wiring reveal→tab is more than trivial, ship the tabs with a note and a follow-up.
- [ ] **Step 4:** In `App.tsx`, replace the Details label + the accordion stack of the 6 detail views (keep `PathComparison`/`Assessment`/`PhaseAudit`/`Findings`/`GhostCard` handling for Task 2) with `<DeepDive />`. For THIS task, you may leave the rest of the debrief as-is and just swap the 6 timeline/stealth/deviation/frameworks/findings/log views into the DeepDive panel to prove it (Task 2 does the full two-column move). Findings can move into DeepDive here.
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build` green. Manually confirm (`npm run dev`) the tabs switch and each renders. **Commit** `feat: DeepDive tabbed panel replacing the accordion stack`.

---

## Task 2: Two-column grid + `DebriefRail`

**Files:** Create `src/components/DebriefRail.tsx`. Modify `src/App.tsx` (two-column grid), and read `IdentityBar.tsx`/`Assessment.tsx`/`KpiBar.tsx` to compose the rail.

- [ ] **Step 1: Read** `IdentityBar.tsx` (what it renders: identity? grade? KPIs? the lesson?), `Assessment.tsx` (the grade radar + rubric table + version tag), `KpiBar.tsx` (if present), and how the "one lesson"/coaching is currently surfaced (likely in `PhaseAudit`'s takeaway or `LiveDashboard`). Decide the minimal composition — REUSE these components in the rail; do NOT rewrite their internals. If `IdentityBar` bundles identity+grade+KPIs+lesson together, either (a) render `IdentityBar` in the rail and pull only the lesson into the main column, or (b) if it's cleanly separable, compose the identity/grade/KPI pieces into the rail. Prefer the least-invasive that achieves: identity+grade+radar+KPIs+ghost-mini in the rail, the one lesson at the top of the main column.
- [ ] **Step 2: Implement `DebriefRail.tsx`** — the sticky (`lg:sticky lg:top-[[header]]`) left column composing: identity (from `IdentityBar` or its pieces), the grade + 8-dim radar (from `Assessment`'s radar), key numbers, and a **ghost-mini** (read `report.ghost` — "⚑ {human_wins} wins · {time_lost} lost"; hidden when absent). Self-contained; reuses existing components.
- [ ] **Step 3: Restructure `App.tsx` debrief** into a two-column grid (`lg:grid-cols-12`): rail `lg:col-span-4` (sticky), main `lg:col-span-8`. Main column order: the one lesson → coaching (what you'd do differently) → `PhaseAudit` → `PathComparison` → `GhostCard` → `<DeepDive />` → footer/session-window. On narrow widths the rail stacks above the main (grid collapses to 1 col; rail not sticky). Remove the old single-column stack + the "Details" accordion label.
- [ ] **Step 4:** Preserve `reveal(seq)` deep-links from coaching/PhaseAudit/GhostCard into the DeepDive tabs (Task 1's reveal→tab switch). Verify the Command-log reveal still works.
- [ ] **Step 5:** `npm test && npm run typecheck && npm run build` green; manually confirm the two-column layout, sticky rail, and mobile stack. **Commit** `feat: two-column debrief (sticky rail + narrative main)`.

---

## Task 3: Live vs. post (settle behavior)

**Files:** `src/App.tsx`, `src/components/DebriefRail.tsx`, and read `LiveDashboard.tsx`/`src/lib/live.ts` (`isLiveRecording`).

- [ ] **Step 1:** While `isLiveRecording(report)`: the rail shows live status (pulsing recording + live stealth + the "next move" nudge from `LiveDashboard`'s live content); the main column shows the live feed / kill-chain trajectory; grade/path/ghost sections are locked (as today). When resolved: rail settles into grade+radar+KPIs+ghost-mini; main becomes the graded narrative. Keep the frame mounted across the flip (reuse `LiveDashboard`'s existing mounted-settle behavior — do not unmount/remount).
- [ ] **Step 2:** Ensure no regression to the live demo (`?demo=live`): the recording→resolved transition still animates and the live nudge (sub-project 3) still shows while recording.
- [ ] **Step 3:** `npm test && npm run typecheck && npm run build` green; confirm the live demo flips correctly into the two-column resolved layout. **Commit** `feat: live-vs-post settle in the two-column debrief`.

---

## Task 4: Polish, responsive, docs

**Files:** `src/components/{DebriefRail,DeepDive}.tsx`, `src/App.tsx`, `README.md`.

- [ ] **Step 1:** Polish pass — consistent spacing/tokens, the version tag visible in the rail, no horizontal page scroll (wide deep-dive content in `overflow-x-auto`), tab focus rings, rail not sticky on mobile.
- [ ] **Step 2:** README: note the debrief is now a two-column dashboard (sticky verdict rail + narrative + tabbed deep dive). Update/replace any screenshot references that no longer match (or note they're pending).
- [ ] **Step 3:** `npm test && npm run typecheck && npm run build` green. **Commit** `polish: debrief redesign spacing/responsive + docs`.

---

## Self-Review (planner)
- **Coverage:** DeepDive (T1) + two-column rail (T2) + live/post (T3) + polish/docs (T4) = the validated direction B. Deferred export/branding stays out.
- **Presentation-only:** no metric/grade/engine change; a data-untouched assertion + the full suite guard it. Detail internals unchanged (moved, not rewritten).
- **Deep-links:** T1/T2 preserve `reveal(seq)` → tab-switch.
- **Live/post:** T3 keeps the mounted-settle behavior.
- **Risk note:** `App.tsx` is the big diff; the two new containers isolate the change and detail components are reused as-is. If decomposing `IdentityBar`/`Assessment` proves invasive, the implementer composes them whole into the rail rather than rewriting (documented in T2 step 1).
