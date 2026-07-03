# Design Spec — Debrief Redesign (Direction B: Two-Column Dashboard)

**Date:** 2026-07-03
**Status:** Approved (layout validated via visual companion) — implementation queued LAST
**Executor model:** Claude Opus 4.8, one Work Package at a time
**Depends on:** sub-projects 1–3 merged; **builds after** The Ghost and the candidate-C grade reweighting (it arranges those finished pieces into the new layout).

---

## 0. Working rules & sequencing

Same rules as prior sub-projects (TDD; green gate; determinism; no logic regressions). This is primarily a **presentation-layer reorganization** — it must not change any metric, grade, or pipeline output; it re-homes existing components into a new shell.

**Build order (critical):** this redesign is the **last** of the queued work. It ships after (a) The Ghost (adds the `GhostCard` / ghost data) and (b) the candidate-C grade reweighting (adds the 8-dim radar / grade v2). Rationale: build the furniture first, then rearrange the room. The redesign consumes the finished Ghost card and the reweighted grade radar as slots in the new layout.

**Primary job (user decision):** *solo self-review now, clean export later.* Optimize for "what do I fix next time"; keep the layout export-friendly but do not build export in this pass.

---

## 1. The design (validated)

**Direction B — two-column dashboard.** A sticky left rail of identity/verdict beside a scrollable narrative main column, with the old ~10-item accordion stack collapsed into **one tabbed "Deep dive" panel**.

### Left rail (sticky, `lg:` and up; stacks on top for mobile)
1. **Target identity** — avatar, name, difficulty, OS, platform, rooted status + duration. (from `IdentityBar`/`MachineAvatar`/`targetOf`)
2. **Grade** — letter + score + the **radar** (8 dimensions incl. methodology & focus once grade v2 lands). (from the grade/`Assessment` radar)
3. **Key numbers** — coverage · efficiency · stealth (compact tri-tile). (from `KpiBar`/metrics)
4. **vs the Ghost** — a mini: human wins ⚑ + time lost. (from `report.ghost`)

### Main column (scrolls) — the review hierarchy (validated order)
1. **The one lesson** — the top coaching takeaway, big and unmissable.
2. **What you'd do differently** — ranked coaching `next_steps`, each deep-linking to its step.
3. **Phase audit** — the Lighthouse cards per MITRE phase (`PhaseAudit`, unchanged internally).
4. **Path vs intended** — `PathComparison` (matched/alt/out-of-order/skipped + proven markers).
5. **You vs the Ghost** — `GhostCard` (late pivots + celebrated human wins).

### Deep dive — one tabbed panel (replaces the accordion stack)
Tabs, one active at a time: **Timeline** (`AttackTimeline`) · **Stealth & noise** (`StealthReport`) · **Time lost** (`DeviationTimeline`) · **Frameworks** (`FrameworkAxes`) · **Findings** (`Findings`) · **Command log** (`CommandReplay`). Session window/trim controls live in a small "⋯" affordance, not a tab.

### Live vs. post — same shell, settles
- **Recording:** left rail = pulsing status + live stealth gauge + the "next move" methodology nudge (`LiveDashboard` live content); main column streams the kill-chain trajectory / live feed; grade, path, and ghost sections are **locked** (as today). Deep-dive tabs available for what exists.
- **Resolved:** the same rail settles into grade + numbers + ghost-mini; the main column becomes the graded narrative above; deep-dive fully unlocks. The frame **stays mounted across the flip** (no swap), matching today's `LiveDashboard` behavior.

---

## 2. Component mapping (what moves, nothing rewritten)

The redesign is a **layout shell** (`App.tsx` debrief branch) plus a small number of container components. Existing detail components (`AttackTimeline`, `StealthReport`, `FrameworkAxes`, `DeviationTimeline`, `CommandReplay`, `PathComparison`, `PhaseAudit`, `Findings`, `GhostCard`) are **reused as-is** — only their *placement* changes (rail vs. main vs. a deep-dive tab). New/edited pieces:

- **`App.tsx`** — replace the current single-column debrief (`IdentityBar → LiveDashboard → PhaseAudit → accordion stack`) with the two-column grid + the deep-dive tab host.
- **New `DebriefRail.tsx`** — the sticky left rail (identity, grade radar, KPIs, ghost-mini). Composes existing identity/grade/KPI pieces; adds no new logic.
- **New `DeepDive.tsx`** — the tabbed panel: a small tab state + renders the active detail component. Pure presentation; the tab list is a config array. Accessible: real `<button>` tabs, `aria-selected`, arrow-key nav, `overflow-x-auto` for wide panels.
- **`LiveDashboard.tsx`** — split its live vs. resolved content so the rail/main can consume each half (or expose the live rail bits + the resolved narrative bits). Keep the "stays mounted, settles" behavior.
- The `Collapse`-based accordion wiring is removed from `App.tsx` (the components no longer self-collapse in a stack; the deep-dive owns visibility). Detail components keep working standalone.

**Boundaries:** `DebriefRail` and `DeepDive` each have one clear job and a config-driven interface (the section/tab list), so they're testable and the detail components stay decoupled.

---

## 3. Testing & quality

- **No metric/grade/pipeline change** — a test asserts the report data feeding the debrief is untouched (this is layout only).
- **Deep-dive tab logic** — the tab-selection state and the config→component mapping are pure enough to unit-test (extract the tab config + resolver to a `.ts` helper; test that each tab id resolves to the right component key and that switching is deterministic). Repo convention: node-env pure-logic tests, no DOM.
- **Accessibility** — tabs are keyboard-navigable (`role="tablist"`, arrow keys, `aria-selected`); the rail is a landmark; no horizontal page scroll (wide panels scroll internally).
- **Backward-compat** — a report missing ghost/methodology (old session) renders: ghost-mini hidden, radar shows the dims it has. No crash.
- **Responsive** — two columns at `lg:`; rail stacks above the main column on narrow widths (the rail is not sticky on mobile).

---

## 4. Non-goals (this pass)
- The branded **export** (PDF/HTML) — the layout is designed to make it a clean follow-on, but export itself is deferred.
- Any change to metrics, grade math, the analysis engines, or the Ghost engine.
- New detail components — everything is reuse.
- A visual theme overhaul (colors/type) beyond what the two-column structure needs; the existing token system stays.

## 5. Risks & mitigations
- **Big `App.tsx` diff / regression risk.** *Mitigation:* extract the rail and deep-dive into their own components; move components without editing their internals; a "data unchanged" test guards the pipeline.
- **Sequencing drift** (ghost/grade not yet merged). *Mitigation:* this spec's implementation starts only after both merge; if a slot's source (ghost-mini, 8-dim radar) isn't present, it degrades gracefully.
- **Accordion → tabs loses deep-links.** *Mitigation:* the existing `reveal(seq)` deep-links must still work — opening a tab and scrolling to a step; verify the Command-log/timeline reveal still functions from coaching cards.
- **Live/post regression.** *Mitigation:* preserve `LiveDashboard`'s mounted-across-flip behavior; test both states render.
