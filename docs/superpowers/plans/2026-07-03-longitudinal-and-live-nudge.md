# Longitudinal Progress + Live Nudge — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add a longitudinal "Progress" view (am-I-improving trends across runs) and a live "next move" methodology nudge — both additive, no debrief redesign.

**Architecture:** Pure selectors/geometry in `src/lib/progress.ts` (unit-tested, node env); a new `Progress` view registered in the existing tab system; a live nudge in the existing live panel using the sub-project-2 methodology engine. No new deps; trends are inline SVG.

**Tech Stack:** TypeScript, React, Zustand, Tailwind, Vitest (node env, pure-logic tests only — NO DOM/testing-library), inline SVG.

## Global Constraints
- **TDD**; **green gate** each task: `npm test` + `npm run typecheck` + `npm run build` + schema round-trip.
- **Additive/backward-compatible**: works with old sessions lacking v1.2/v1.3 fields (methodology series nullable; never assume presence). No change to grade/metrics/engines.
- **Determinism**: series/geometry are pure functions; date parsing is of fixed ISO strings (deterministic); date *formatting* is display-only.
- **No scope creep**: do NOT restyle or re-layout the existing debrief. This adds a new tab + a live-panel addition only.
- **No new dependencies**; no charting lib — inline SVG following the codebase's existing ring/sparkline idiom.
- Keep pure geometry in `.ts` helpers and unit-test those (the repo has no DOM tests by convention).

---

## File Structure
- Create: `src/lib/progress.ts` (+ `.test.ts`) — selectors + SVG geometry.
- Create: `src/components/Progress.tsx` — the view.
- Modify: `src/store/report.ts` — extend `SessionCard` with `breadth` + `methodology`; add `"progress"` to the `View` union.
- Modify: `src/App.tsx` — register the Progress tab + render it.
- Modify: `src/components/LiveDashboard.tsx` (or the live panel that renders while recording — confirm by reading) — the nudge + findings count.
- Modify: `README.md`.

---

## Task 1: Progress selectors + geometry (WP-1)

**Files:** Create `src/lib/progress.ts`, `src/lib/progress.test.ts`. Modify `src/store/report.ts` (extend `SessionCard` + `toCard`).

**Interfaces produced:**
```ts
export interface ProgressPoint { id: string; date: number; label: string; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; platform: string; demo: boolean; }
export interface ProgressSummary { runs: number; rootedRate: number; bestGrade: number; medianGrade: number; platforms: string[]; }
export function progressSeries(cards: ProgressCard[]): ProgressPoint[];
export function progressSummary(points: ProgressPoint[]): ProgressSummary;
export function progressPath(values: (number | null)[], width: number, height: number, min?: number, max?: number): string;
```
`ProgressCard` is the subset of `SessionCard` this reads (structurally: `{ id, ended_at, target, grade, letter, coverage, breadth, methodology, rooted, demo }`).

- [ ] **Step 1: Extend `SessionCard` + `toCard` in `src/store/report.ts`.** Add `breadth: number;` and `methodology: number | null;` to the `SessionCard` interface. In `toCard(id, r)`, set `breadth: r.metrics.technique_breadth ?? 0` and `methodology: r.metrics.methodology_coverage_pct ?? null`. (These fields already exist on v1.3 reports; older reports → 0/null.) Add `"progress"` to the `View` type union (`type View = "debrief" | "history" | "install" | "progress";`).

- [ ] **Step 2: Write the failing test** (`progress.test.ts`):
```ts
import { describe, it, expect } from "vitest";
import { progressSeries, progressSummary, progressPath, type ProgressCard } from "./progress";

const card = (o: Partial<ProgressCard> & { id: string }): ProgressCard => ({
  ended_at: "2026-01-01T00:00:00Z", target: { platform: "htb", kind: "box", name: "X" },
  grade: 70, letter: "C", coverage: 50, breadth: 4, methodology: 60, rooted: false, demo: false, ...o,
});

describe("progressSeries", () => {
  it("returns non-demo points sorted by date ascending", () => {
    const pts = progressSeries([
      card({ id: "b", ended_at: "2026-02-01T00:00:00Z" }),
      card({ id: "a", ended_at: "2026-01-01T00:00:00Z" }),
      card({ id: "demo", demo: true }),
    ]);
    expect(pts.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("carries a null methodology through without NaN", () => {
    const pts = progressSeries([card({ id: "a", methodology: null }), card({ id: "b", ended_at: "2026-03-01T00:00:00Z" })]);
    expect(pts[0].methodology).toBeNull();
  });
});

describe("progressSummary", () => {
  it("computes runs, rooted rate, best/median grade, platforms", () => {
    const pts = progressSeries([
      card({ id: "a", grade: 60, rooted: true, target: { platform: "htb", kind: "box", name: "X" } }),
      card({ id: "b", ended_at: "2026-02-01T00:00:00Z", grade: 80, rooted: false, target: { platform: "thm", kind: "room", name: "Y" } }),
      card({ id: "c", ended_at: "2026-03-01T00:00:00Z", grade: 90, rooted: true, target: { platform: "htb", kind: "box", name: "Z" } }),
    ]);
    const s = progressSummary(pts);
    expect(s.runs).toBe(3);
    expect(s.bestGrade).toBe(90);
    expect(s.medianGrade).toBe(80);
    expect(Math.round(s.rootedRate)).toBe(67);
    expect(s.platforms.sort()).toEqual(["htb", "thm"]);
  });
});

describe("progressPath", () => {
  it("builds an SVG polyline path over the value range, skipping nulls", () => {
    const d = progressPath([0, 50, 100], 100, 20, 0, 100);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("L");
  });
  it("returns empty string for < 2 non-null values", () => {
    expect(progressPath([null, 5], 100, 20)).toBe("");
  });
});
```

- [ ] **Step 3: Run to confirm FAIL.**

- [ ] **Step 4: Implement `progress.ts`:**
```ts
import type { PlatformId, Target } from "../types/report";

export interface ProgressCard { id: string; ended_at: string; target: Target; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; demo: boolean; }
export interface ProgressPoint { id: string; date: number; label: string; grade: number; letter: string; coverage: number; breadth: number; methodology: number | null; rooted: boolean; platform: string; demo: boolean; }
export interface ProgressSummary { runs: number; rootedRate: number; bestGrade: number; medianGrade: number; platforms: string[]; }

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Date-sorted, demo-excluded progress points. Pure (parses fixed ISO strings). */
export function progressSeries(cards: ProgressCard[]): ProgressPoint[] {
  return cards
    .filter((c) => !c.demo)
    .map((c) => ({ id: c.id, date: Date.parse(c.ended_at), label: c.target.name, grade: c.grade, letter: c.letter, coverage: c.coverage, breadth: c.breadth, methodology: c.methodology, rooted: c.rooted, platform: c.target.platform, demo: c.demo }))
    .filter((p) => Number.isFinite(p.date))
    .sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

export function progressSummary(points: ProgressPoint[]): ProgressSummary {
  const runs = points.length;
  const grades = points.map((p) => p.grade);
  const rooted = points.filter((p) => p.rooted).length;
  return {
    runs,
    rootedRate: runs === 0 ? 0 : (rooted / runs) * 100,
    bestGrade: runs === 0 ? 0 : Math.max(...grades),
    medianGrade: median(grades),
    platforms: [...new Set(points.map((p) => p.platform))],
  };
}

/** An SVG path over a value series scaled into [0,width]×[0,height] (y inverted). Nulls break the line;
 *  needs ≥2 non-null points to draw anything. Pure/deterministic. */
export function progressPath(values: (number | null)[], width: number, height: number, min = 0, max = 100): string {
  const n = values.length;
  if (n < 2) return "";
  const span = max - min || 1;
  const pts: string[] = [];
  let drawn = 0;
  values.forEach((v, i) => {
    if (v == null) { return; }
    const x = (i / (n - 1)) * width;
    const y = height - ((v - min) / span) * height;
    pts.push(`${pts.length === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`);
    drawn++;
  });
  return drawn >= 2 ? pts.join(" ") : "";
}
```

- [ ] **Step 5: Run PASS**, then **Commit**
```bash
git add src/lib/progress.ts src/lib/progress.test.ts src/store/report.ts
git commit -m "feat: progress selectors + SVG geometry; SessionCard breadth/methodology"
```

---

## Task 2: Progress view + tab (WP-2)

**Files:** Create `src/components/Progress.tsx`. Modify `src/App.tsx` (tab + render).

- [ ] **Step 1: Read** `src/App.tsx` (the `Tab` component + the `view === ...` render switch), `src/components/ui.tsx` (`Section`), and one existing component with an SVG ring/sparkline (`PhaseAudit.tsx::ScoreRing`, or search for `<svg` usages) to match the inline-SVG idiom and tokens.

- [ ] **Step 2: Implement `Progress.tsx`** using `useReport((s) => s.sessionCards)` → `progressSeries` → `progressSummary`. Render:
  - Summary tiles row: runs · rooted rate · best grade · median grade · platforms (reuse `mono`/`label`/tier-color idioms).
  - A trend panel: an inline `<svg>` (viewBox-based, responsive) drawing `progressPath` for **grade**, **coverage**, and **methodology** (methodology may have gaps), each in a distinct accessible color (follow the `dataviz` skill: distinguishable in light/dark, a legend, labeled). X is run order/time, Y is 0–100. Dots per run; each dot/row is a `<button>` calling `switchSession(id)` (from the store) which opens the Debrief.
  - Empty state when `points.length < 2`: "Run a couple of boxes to see your trend."
  - Wrap wide content in an `overflow-x-auto` container so the page body never scrolls horizontally.

- [ ] **Step 3: Register the tab in `App.tsx`** — add a `<Tab id="progress" label="Progress" />` next to the others, extend the `Tab` id prop type to include `"progress"`, and add `view === "progress" ? <Progress /> : ...` to the render switch. Import `Progress`.

- [ ] **Step 4:** If you extract SVG-point geometry beyond `progressPath` (e.g. dot coordinates), put it in `progress.ts` and unit-test it. Otherwise no new test here (component is thin; logic is tested in Task 1).

- [ ] **Step 5:** Run `npm test && npm run typecheck && npm run build`. Manually confirm (`npm run dev`) the Progress tab renders a trend from the bundled fixtures and a point deep-links to its debrief. **Commit**
```bash
git add src/components/Progress.tsx src/App.tsx
git commit -m "feat: Progress view — longitudinal grade/coverage/methodology trend"
```

---

## Task 3: Live "next move" nudge + findings count (WP-3)

**Files:** Modify `src/lib/analysis/methodology.ts` (add `topUnmetCheck`) + its test. Modify the live panel component (read `src/components/LiveDashboard.tsx` and `LiveBridge.tsx` to find where "recording" content renders).

- [ ] **Step 1: Add `topUnmetCheck` to `methodology.ts`:**
```ts
/** The single highest-value un-done applicable check (RULES are ordered recon→privesc), or null. */
export function topUnmetCheck(report: WatcherReport): MethodologyCheck | null {
  return computeMethodology(report).checks.find((c) => c.applicable && !c.done) ?? null;
}
```

- [ ] **Step 2: Write the failing test** (add to `methodology.test.ts`): a report with a 445 finding and no SMB tool → `topUnmetCheck` returns the `smb_enum` check (applicable, !done); a report where every applicable check is done → returns null.

- [ ] **Step 3: Run FAIL → implement (already above) → PASS.**

- [ ] **Step 4: Wire the live nudge** — in the component that renders the live/recording panel (confirm via reading; likely `LiveDashboard.tsx`), when the report `isLiveRecording`/`recording`:
  - Compute `const nudge = topUnmetCheck(report)`. If non-null, render a compact one-liner: the check `label` + `hint` (redaction-safe — labels/hints only), styled with an existing "signal"/muted idiom, deep-linking to `nudge.evidence_seq` via `reveal(seq)` when present. If null, render nothing (no empty box).
  - Render a small findings count: `report.findings?.length ?? 0` "findings" (deep-link optional). 
  - Show ONLY while recording — post-run the debrief owns this.

- [ ] **Step 5:** Run `npm test && npm run typecheck && npm run build`; confirm the nudge appears in the live demo (`?demo=live`) while recording and disappears when resolved. **Commit**
```bash
git add src/lib/analysis/methodology.ts src/lib/analysis/methodology.test.ts src/components/LiveDashboard.tsx
git commit -m "feat: live next-move methodology nudge + findings count"
```

---

## Task 4: Docs (WP-4)

**Files:** `README.md`.

- [ ] **Step 1:** Add the Progress view + live nudge to the feature list; note the full debrief visual redesign is intentionally deferred (a future, user-directed pass), so the README doesn't overclaim a redesign that didn't happen.
- [ ] **Step 2:** `npm test && npm run build`; **Commit**
```bash
git add README.md
git commit -m "docs: Progress view + live nudge; note deferred visual redesign"
```

---

## Self-Review (planner)
- **Spec coverage:** WP-1→T1, WP-2→T2, WP-3→T3, WP-4→T4. G1 (Progress view) = T1+T2; G2 (live nudge) = T3; G3 (additive/backward-compat) enforced by nullable methodology + old-session degradation in T1.
- **Placeholders:** progress.ts + topUnmetCheck are complete code; components are described against exact existing idioms the implementer is told to read (App.tsx tabs, ScoreRing SVG, LiveDashboard).
- **Type consistency:** `ProgressPoint`/`ProgressSummary`/`ProgressCard`/`progressPath` defined once (T1), consumed in T2; `topUnmetCheck` returns the existing `MethodologyCheck` type from sub-project 2.
- **Determinism:** series/summary/geometry have pure tests; date parse is of fixed strings; no clock in logic.
- **Backward-compat:** `methodology: null` path tested; `technique_breadth ?? 0`.
