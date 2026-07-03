# Design Spec — Longitudinal Progress View + Live "Next Move" Nudge

**Date:** 2026-07-03
**Status:** Approved for implementation (sub-project 3 of 3 — additive scope)
**Executor model:** Claude Opus 4.8, one Work Package at a time
**Depends on:** sub-projects 1 & 2 (merged to local `main`).

---

## 0. Scope note (read first)

Sub-project 3 in the north-star vision was "report redesign + longitudinal + enterprise." This spec covers the **additive, low-taste-risk** slice that delivers the jobs-to-be-done value without a subjective visual overhaul:

1. A **Progress** view — the "am I getting better?" longitudinal surface across runs.
2. A **live "next move" nudge** — surface the methodology engine's top unmet check + the findings ledger in the live panel.

**Explicitly deferred (needs the user's direct visual input, ideally via the brainstorming visual companion):** the full debrief re-layout / information-hierarchy overhaul, accordion restructuring, and enterprise branding/PDF theming. Those are taste-dependent and should not be built blind. This spec touches the existing debrief only additively (a new tab + a live-panel addition); it does not restyle it.

Same working rules as prior sub-projects (§0 of the sub-project-1 spec): TDD; green gate (`npm test` + `typecheck` + `build` + schema round-trip); additive/backward-compatible; determinism (pure selectors, no clock in logic — the view may format dates for display only); no scope creep into the deferred visual overhaul.

---

## 1. Thesis

The scarce, compounding skill is methodology practiced by hand — and practice only compounds if you can **see** it compounding. Today History is a flat list; there is no "are my numbers trending up." And live, the operator's job is *orient & don't-spin* — the methodology engine now knows the single highest-value unchecked action ("445 open, enumerate SMB"), which is exactly the nudge a live HUD should show. Both are additive surfaces over data that already exists (multiple sessions in the store; the methodology/findings engines from sub-project 2).

---

## 2. Goals / non-goals

### Goals
- **G1.** A **Progress** view (new top-level tab) that trends, across all non-demo sessions in date order: **grade**, **objective coverage**, **technique breadth**, and **methodology coverage**; plus summary tiles (runs, rooted rate, best/median grade, platforms practiced) and a per-platform breakdown. Deep-links a run to its debrief.
- **G2.** A **live "next move" nudge** in the live panel: the top unmet applicable methodology check (label + hint, deep-linked to its evidence), shown only while recording; plus a compact live findings count.
- **G3.** All deterministic, additive, and backward-compatible (works with old sessions that lack v1.2/v1.3 fields — degrade gracefully).

### Non-goals (deferred, need user input)
- Debrief visual re-layout / hierarchy overhaul; accordion restructuring.
- Enterprise branding, PDF/print theming, cohort roll-ups.
- Any change to the grade, metrics, or the analysis engines (those are done).
- Charting libraries — draw trends with inline SVG (the codebase already hand-rolls SVG rings/sparklines; no new deps).

---

## 3. Architecture

```
store (REPORTS: all sessions) ── selector: progressSeries() ──▶ Progress view (new tab)
                                                                 (inline SVG trend lines + tiles)
methodology engine (computeMethodology) ── topUnmetCheck() ──▶ LiveDashboard nudge (while recording)
findings ledger ─────────────────────────────────────────────▶ live findings count
```

- **No new deps.** Trends are inline SVG (follow the `ScoreRing`/sparkline idiom already in the codebase).
- **New view** registered in the existing tab system (`App.tsx` `Tab` + `store` `View` union), alongside Debrief/History/Install.
- Pure selectors in the store (or a `src/lib/progress.ts` module) turn the session set into series; the component only renders.
- Backward-compat: sessions without `methodology_coverage_pct` (pre-v1.3) are simply omitted from that one series (or shown as gaps), never crash.

---

## 4. Work packages

### WP-1 — Progress data selector
- **Goal:** `src/lib/progress.ts` — pure functions turning the session set into trend series + summary.
- **Interface:**
  ```ts
  export interface ProgressPoint { id: string; date: number; label: string; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; platform: string; }
  export interface ProgressSummary { runs: number; rootedRate: number; bestGrade: number; medianGrade: number; platforms: string[]; }
  export function progressSeries(cards: SessionCardLike[], reports: Record<string, WatcherReport>): ProgressPoint[]; // date-sorted, demo excluded
  export function progressSummary(points: ProgressPoint[]): ProgressSummary;
  ```
  `breadth`/`methodology` come from each report's `metrics` (`technique_breadth`, `methodology_coverage_pct` — null when absent). `date` from `ended_at` (already an ISO string on the card; parse for sort, but the parse of a fixed string is deterministic).
- **Acceptance:** given ≥2 sessions, returns date-sorted points; demo excluded; missing methodology → null (no NaN/crash); summary math correct (rootedRate, median). Deterministic.
- **Tests:** series ordering, demo exclusion, missing-field graceful, summary math.
- **Depends on:** — (SessionCard already carries grade/coverage/rooted; extend the card or read the report for breadth/methodology).

### WP-2 — Progress view component + tab
- **Goal:** `src/components/Progress.tsx` + register a `progress` tab in `App.tsx`/store `View`.
- **Content:** summary tiles (runs · rooted rate · best/median grade · platforms); one multi-series trend (grade + coverage + methodology over time) as inline SVG with a legend; a small per-platform tally; each point/row deep-links (`switchSession(id)` → Debrief). Empty state when < 2 runs ("Run a couple of boxes to see your trend").
- **Style:** reuse existing tokens/idioms (`Section`, tier colors, `mono`, `label`). No new visual system. Follow `dataviz` skill guidance for the trend (accessible colors, labeled axes, light/dark safe) — but keep it small and inline.
- **Acceptance:** renders from `progressSeries`; trend line reflects the data; deep-link opens the right debrief; degrades to empty state with < 2 runs; no layout regression to existing tabs.
- **Tests:** a pure-logic test on the SVG-path/point builder if extracted (repo has no DOM tests — keep the geometry in a testable `.ts` helper, e.g. `progressPath(points): string`, and unit-test that).
- **Depends on:** WP-1.

### WP-3 — Live "next move" nudge + live findings count
- **Goal:** In the live panel (`LiveDashboard`/`LiveBridge` — read to confirm), while `recording`, show the top unmet applicable methodology check (label + hint) and a findings count.
- **Interface:** `topUnmetCheck(report): MethodologyCheck | null` (in `methodology.ts` or `progress.ts`) — the first `applicable && !done` check, ordered by phase (recon→privesc). Nudge deep-links to `check.evidence_seq` when present.
- **Acceptance:** while recording, a report with a 445 finding + no SMB tool shows a "445 open — enumerate SMB" nudge deep-linking to the finding; when all applicable checks are done (or none apply), the nudge is absent (no empty box); not shown post-run (that's the debrief's job). Findings count reflects `report.findings.length`.
- **Tests:** `topUnmetCheck` ordering/selection (pure-logic test); absent when nothing unmet.
- **Depends on:** WP-1 (or independent — reuse `computeMethodology`).

### WP-4 — Docs
- **Goal:** README: add the Progress view + live nudge to the feature list; note the deferred visual overhaul is intentional.
- **Depends on:** WP-2, WP-3.

---

## 5. Dependency graph
```
WP-1 ─▶ WP-2 ─┐
WP-1 ─▶ WP-3 ─┼─▶ WP-4
```
Linear: WP-1 → WP-2 → WP-3 → WP-4.

## 6. Risks & mitigations
- **Old sessions lack v1.3 fields.** *Mitigation:* methodology series is nullable; never assume presence.
- **Taste risk on the trend visual.** *Mitigation:* small, inline, token-consistent; follows `dataviz` guidance; the big redesign is deferred, so this is a modest addition, not a restyle.
- **Store coupling.** *Mitigation:* pure selectors read the existing `REPORTS`/`sessionCards`; no store restructure.
- **Determinism.** *Mitigation:* geometry/series in pure helpers with tests; dates parsed from fixed ISO strings (deterministic), formatting is display-only.
