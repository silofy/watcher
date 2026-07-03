/**
 * Enterprise Bridge — the weighted grading rubric (brief §6.4).
 *
 * A grade must be explainable, so the metrics map to explicit weights. The rubric is VERSIONED:
 *   v1 (frozen, today's weights): objective coverage 30 · technique breadth 15 · efficiency 15 ·
 *     progression 10 · discipline 15 · independence 15 — applied to reports with no methodology signal.
 *   v2 (candidate C, user-approved): folds in methodology + focus for reports that carry those
 *     signals (schema v1.3+): coverage 22 · breadth 10 · efficiency 11 · progression 9 · discipline 8 ·
 *     independence 15 · methodology 15 · focus 10.
 *
 * A report grades under v1 or v2 based solely on whether it carries `methodology_coverage_pct` —
 * old reports (no methodology signal) keep their v1 letter forever; this is history-frozen, not a
 * retroactive rescoring.
 *
 * Progression (UKC phase ordering) is its own dimension because it measures something efficiency
 * can't: whether the run advanced through the kill chain in order or thrashed between phases.
 *
 * Independence is special: it is a GATE, not just a weight. A high-skill / low-independence result
 * is routed to an integrity queue with an evidence bundle — a signal to a human, never an automated
 * verdict — rather than being averaged away. Pure and deterministic (browser-safe, no crypto).
 */
import type { WatcherReport } from "../../types/report";

export const RUBRIC_V1 = {
  coverage: 0.3,
  breadth: 0.15,
  efficiency: 0.15,
  progression: 0.1,
  discipline: 0.15,
  independence: 0.15,
} as const;

/** Candidate C (user-approved): folds methodology + focus in; used for reports that carry those signals (schema v1.3+). */
export const RUBRIC_V2 = {
  coverage: 0.22,
  breadth: 0.1,
  efficiency: 0.11,
  progression: 0.09,
  discipline: 0.08,
  independence: 0.15,
  methodology: 0.15,
  focus: 0.1,
} as const;

/** @deprecated retained for back-compat; equals V1. */
export const RUBRIC = RUBRIC_V1;

export type RubricKey = keyof typeof RUBRIC_V2; // superset (V2 has all V1 keys + methodology/focus)

/** Independence below this routes to the integrity queue. */
export const INDEPENDENCE_GATE = 40;
/** Distinct techniques that count as "full" breadth. */
export const BREADTH_TARGET = 12;

export interface GradeComponent {
  raw: number;
  weight: number;
  weighted: number;
}

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

function letterFor(score: number): string {
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

/** Letter → color: A/B teal (good), C lavender (caution), D/F coral (poor). */
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
  // Independence is a MEASURED integrity signal, not a score that defaults to zero. Today only seeded
  // fixtures carry it — no live capture ever computes it — so treating "absent" as 0 both docked a real
  // run 15 points and falsely routed it to the integrity queue. When it wasn't measured, drop it from
  // the rubric and the gate entirely and re-normalize the remaining weights.
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
    // An excluded dimension carries weight 0; the rest are re-normalized so a missing independence
    // signal neither inflates nor deflates the total.
    const weight = activeKeys.includes(key) ? rubric[key] / totalWeight : 0;
    const weighted = raws[key] * weight;
    components[key] = { raw: round1(raws[key]), weight, weighted: round1(weighted) };
    score += weighted;
  }
  score = round1(score);

  const indep = raws.independence;
  const flagged = measured && indep < INDEPENDENCE_GATE;

  const rationale: string[] = [];
  if (flagged) {
    rationale.push(
      `Independence ${round1(indep)} is below the gate (${INDEPENDENCE_GATE}) — routed to the integrity queue with an evidence bundle. This is a signal to a human reviewer, not an automated verdict.`,
    );
  }
  for (const key of ["coverage", "efficiency", "progression", "discipline"] as RubricKey[]) {
    if (raws[key] < 50) rationale.push(`Low ${key} (${round1(raws[key])}).`);
  }
  if (isV2) {
    for (const key of ["methodology", "focus"] as RubricKey[]) {
      if (raws[key] < 50) rationale.push(`Low ${key} (${round1(raws[key])}).`);
    }
  }
  if (rationale.length === 0) rationale.push("Solid across the rubric; no integrity concerns.");

  return {
    score,
    letter: letterFor(score),
    version,
    components,
    independence_gate: { score: round1(indep), threshold: INDEPENDENCE_GATE, flagged, measured },
    routed_to: flagged ? "integrity_queue" : "grade",
    rationale,
  };
}
