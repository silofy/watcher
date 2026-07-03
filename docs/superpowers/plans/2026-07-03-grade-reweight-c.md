# Grade Reweighting (Candidate C, versioned) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Fold methodology & focus into the letter grade using **candidate C** weights, as **versioned grading** — old reports keep their v1 letter (frozen history), new reports (v1.3+, which carry methodology) get the v2 letter.

**Architecture:** `grade.ts` holds two rubrics (`RUBRIC_V1` = today's 6 weights; `RUBRIC_V2` = candidate C, 8 weights). `computeGrade` picks the version by whether `metrics.methodology_coverage_pct` is present, returns `version`. The grade radar renders the active rubric's dimensions (6 or 8). Independence stays a gate.

**User decision (recorded):** candidate C — `coverage .22 · breadth .10 · efficiency .11 · progression .09 · discipline .08 · independence .15 · methodology .15 · focus .10`. `methodology` raw = `methodology_coverage_pct ?? 0`; `focus` raw = `focus_discipline_pct ?? 100`.

## Global Constraints
- **TDD**; green gate each task: `npm test` + `typecheck` + `build` + schema round-trip.
- **History preserved**: a report WITHOUT `metrics.methodology_coverage_pct` (old v1.0–v1.2) grades EXACTLY as before (v1 rubric, same letter). Only reports that carry methodology get v2.
- **Determinism**; independence remains a GATE (unchanged), re-normalized when unmeasured.
- **This is the change the earlier "grade-stability" tests anticipated**: the sub-project-2 stability test asserted methodology/focus don't move the grade — that is now intentionally FALSE for v2. Update it (Task 1). The Ghost/longitudinal stability tests (ghost fields never feed the grade) stay valid — do NOT change those.
- No change to metrics computation, the analysis engines, or the pipeline.

## File Structure
- Modify: `src/lib/bridge/grade.ts` (+ `grade.test.ts`), `src/lib/metrics.test.ts` (revise the methodology/focus stability test), `src/components/Assessment.tsx` (radar shows active dims), `README.md`, and the in-product "not yet weighted" note (from sub-project-2 Task 7 — find it, likely `Assessment.tsx`).

---

## Task 1: Versioned rubric in `grade.ts`

**Files:** `src/lib/bridge/grade.ts`, `src/lib/bridge/grade.test.ts`, `src/lib/metrics.test.ts`.

- [ ] **Step 1: Rewrite the rubric + `computeGrade` in `grade.ts`.** Replace the single `RUBRIC` with two, keep `RUBRIC` as an alias for back-compat, add `version` to `Grade`, pick the rubric by methodology presence, add methodology/focus raws:
```ts
export const RUBRIC_V1 = { coverage: 0.30, breadth: 0.15, efficiency: 0.15, progression: 0.10, discipline: 0.15, independence: 0.15 } as const;
/** Candidate C (user-approved): folds methodology + focus in; used for reports that carry those signals (schema v1.3+). */
export const RUBRIC_V2 = { coverage: 0.22, breadth: 0.10, efficiency: 0.11, progression: 0.09, discipline: 0.08, independence: 0.15, methodology: 0.15, focus: 0.10 } as const;
/** @deprecated retained for back-compat; equals V1. */
export const RUBRIC = RUBRIC_V1;
export type RubricKey = keyof typeof RUBRIC_V2; // superset (V2 has all V1 keys + methodology/focus)

export const INDEPENDENCE_GATE = 40;
export const BREADTH_TARGET = 12;

export interface GradeComponent { raw: number; weight: number; weighted: number; }
export interface Grade {
  score: number;
  letter: string;
  version: 1 | 2;
  components: Partial<Record<RubricKey, GradeComponent>>;
  independence_gate: { score: number; threshold: number; flagged: boolean; measured: boolean };
  routed_to: "grade" | "integrity_queue";
  rationale: string[];
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
function letterFor(score: number): string { return score >= 90 ? "A" : score >= 80 ? "B" : score >= 70 ? "C" : score >= 60 ? "D" : "F"; }

export function gradeColor(letter: string): string {
  if (letter.startsWith("A") || letter.startsWith("B")) return "var(--color-match)";
  if (letter.startsWith("C")) return "var(--color-tool)";
  return "var(--color-detour)";
}

export function computeGrade(report: WatcherReport): Grade {
  const m = report.metrics;
  // v2 iff the report carries the methodology signal (schema v1.3+). Old reports stay on v1 — history frozen.
  const isV2 = m.methodology_coverage_pct != null;
  const rubric: Record<string, number> = isV2 ? RUBRIC_V2 : RUBRIC_V1;
  const version: 1 | 2 = isV2 ? 2 : 1;
  const measured = m.independence != null;

  const raws: Record<RubricKey, number> = {
    coverage: clamp(m.objective_coverage_pct),
    breadth: clamp((m.technique_breadth / BREADTH_TARGET) * 100),
    efficiency: clamp(m.efficiency_pct),
    progression: clamp(m.ukc_progression ?? 100),
    discipline: clamp(m.stealth_score),
    independence: clamp(m.independence?.score ?? 0),
    methodology: clamp(m.methodology_coverage_pct ?? 0),
    focus: clamp(m.focus_discipline_pct ?? 100),
  };

  const rubricKeys = Object.keys(rubric) as RubricKey[];
  const activeKeys = rubricKeys.filter((k) => k !== "independence" || measured);
  const totalWeight = activeKeys.reduce((sum, k) => sum + rubric[k], 0);

  const components: Partial<Record<RubricKey, GradeComponent>> = {};
  let score = 0;
  for (const key of rubricKeys) {
    const weight = activeKeys.includes(key) ? rubric[key] / totalWeight : 0;
    const weighted = raws[key] * weight;
    components[key] = { raw: round1(raws[key]), weight, weighted: round1(weighted) };
    score += weighted;
  }
  score = round1(score);

  const indep = raws.independence;
  const flagged = measured && indep < INDEPENDENCE_GATE;
  const rationale: string[] = [];
  if (flagged) rationale.push(`Independence ${round1(indep)} is below the gate (${INDEPENDENCE_GATE}) — routed to the integrity queue with an evidence bundle. This is a signal to a human reviewer, not an automated verdict.`);
  for (const key of ["coverage", "efficiency", "progression", "discipline"] as RubricKey[]) if (raws[key] < 50) rationale.push(`Low ${key} (${round1(raws[key])}).`);
  if (isV2) for (const key of ["methodology", "focus"] as RubricKey[]) if (raws[key] < 50) rationale.push(`Low ${key} (${round1(raws[key])}).`);
  if (rationale.length === 0) rationale.push("Solid across the rubric; no integrity concerns.");

  return { score, letter: letterFor(score), version, components, independence_gate: { score: round1(indep), threshold: INDEPENDENCE_GATE, flagged, measured }, routed_to: flagged ? "integrity_queue" : "grade", rationale };
}
```
Keep the `import type { WatcherReport } from "../../types/report";` at top. (Adjust to the file's exact existing imports.)

- [ ] **Step 2: Write/adjust `grade.test.ts`** (TDD — write these first, watch them fail, then the impl above makes them pass):
  - **v1 preserved:** a report with NO `methodology_coverage_pct` in metrics → `version === 1`, and the letter/score equal the PRE-change baseline (hardcode the known v1 values for the existing fixture, or compute against RUBRIC_V1 directly). Assert `components` has the 6 v1 keys and NOT methodology/focus.
  - **v2 applies candidate C:** a report WITH `methodology_coverage_pct` and `focus_discipline_pct` set → `version === 2`, `components` has all 8 keys, and the score matches a hand-computed candidate-C weighted sum for chosen raws (compute expected by hand and assert).
  - **v2 discrimination:** two reports identical except methodology 30 vs 95 → the high-methodology one scores higher under v2 (sanity that methodology now matters).
  - **independence gate unchanged:** independence < 40 still routes to integrity_queue in both versions; unmeasured independence re-normalizes.

- [ ] **Step 3: Revise the sub-project-2 stability test in `metrics.test.ts`.** Find the test that splices `methodology_coverage_pct`/`focus_discipline_pct` onto a fixture's metrics and asserts `computeGrade` is UNCHANGED. That assertion is now wrong (v2 intentionally uses them). Replace it with: (a) splicing methodology/focus onto a report that has them → grade is v2 and DIFFERS appropriately (or matches candidate-C math); (b) a report WITHOUT methodology → grade is v1, unchanged. Do NOT touch the Ghost stability test (ghost fields still never feed the grade — that remains true and must stay green). If the ghost stability test also splices methodology, ensure it still holds: ghost fields don't change the grade, but if it ALSO adds methodology it'd become v2 — adjust so the ghost test isolates ghost fields only (no methodology added) to keep asserting ghost-doesn't-matter.

- [ ] **Step 4:** `npm test && npm run typecheck && npm run build` green. Confirm the existing `htb-easy` fixture's History grade is unchanged (it's an old report → v1).

- [ ] **Step 5: Commit** `feat: versioned grade — candidate C (methodology+focus) as v2, v1 frozen for old reports`.

---

## Task 2: Grade radar shows the active dimensions

**Files:** `src/components/Assessment.tsx` (the grade radar/rubric display). Read it first.

- [ ] **Step 1:** The radar/rubric table currently renders 6 fixed dimensions. Make it render the dimensions present in `grade.components` (6 for v1, 8 for v2) — iterate `Object.keys(components)` (or `Object.entries`) rather than a hardcoded 6-key list. Label methodology → "Methodology", focus → "Focus". Keep the existing radar geometry; it must handle N axes (6 or 8) — if the radar is hardcoded to 6 points, generalize the axis count to `components` length (a small geometry change; if it uses a fixed polygon, compute points from the actual dimension count).
- [ ] **Step 2:** Show the grade `version` subtly (e.g. a small "v2" tag near the grade) so it's transparent which rubric applied. Muted, no layout change.
- [ ] **Step 3:** If the radar geometry has a pure helper, unit-test it for 6 and 8 axes. `npm test && npm run typecheck && npm run build` green.
- [ ] **Step 4: Commit** `feat: grade radar renders active rubric dims (8 for v2)`.

---

## Task 3: Docs + correct the "not yet weighted" note

**Files:** `README.md`, and the in-product note added in sub-project-2 Task 7 (search for "not yet weighted into the grade" — likely `Assessment.tsx`).

- [ ] **Step 1:** UPDATE the in-product note: it currently says methodology/focus/recovery are "surfaced as coaching — not yet weighted into the grade." For v2 this is now false for methodology & focus. Change to reflect reality: methodology & focus ARE weighted into grade v2 (recovery remains coaching-only). Keep it muted/accurate.
- [ ] **Step 2:** README: update the "Methodology signals" section to say methodology & focus now feed the letter grade (v2), while older runs keep their original grade (v1). No overclaim (recovery is still coaching-only).
- [ ] **Step 3:** `npm test && npm run build` green. **Commit** `docs: methodology+focus now weighted in grade v2`.

---

## Self-Review (planner)
- **Coverage:** versioned rubric + version selection + grade result `version` (T1); radar shows active dims (T2); docs corrected (T3).
- **History frozen:** version keyed on `methodology_coverage_pct` presence → old reports stay v1 (tested T1 step 2).
- **Stability-test reconciliation:** T1 step 3 explicitly revises the now-obsolete sub-project-2 stability assertion and preserves the Ghost one.
- **Type consistency:** `RubricKey` = keyof `RUBRIC_V2` (superset); `components` is `Partial<Record<RubricKey,...>>` (v1 omits methodology/focus).
