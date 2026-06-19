/**
 * Enterprise Bridge — the weighted grading rubric (brief §6.4).
 *
 * A grade must be explainable, so the metrics map to explicit weights:
 *   objective coverage 35 · technique breadth 20 · efficiency 15 · discipline 15 · independence 15
 *
 * Independence is special: it is a GATE, not just a weight. A high-skill / low-independence result
 * is routed to an integrity queue with an evidence bundle — a signal to a human, never an automated
 * verdict — rather than being averaged away. Pure and deterministic (browser-safe, no crypto).
 */
import type { WatcherReport } from "../../types/report";

export const RUBRIC = {
  coverage: 0.35,
  breadth: 0.2,
  efficiency: 0.15,
  discipline: 0.15,
  independence: 0.15,
} as const;

export type RubricKey = keyof typeof RUBRIC;

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
  components: Record<RubricKey, GradeComponent>;
  independence_gate: { score: number; threshold: number; flagged: boolean };
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
  const raws: Record<RubricKey, number> = {
    coverage: clamp(m.objective_coverage_pct),
    breadth: clamp((m.technique_breadth / BREADTH_TARGET) * 100),
    efficiency: clamp(m.efficiency_pct),
    discipline: clamp(m.stealth_score),
    independence: clamp(m.independence?.score ?? 0),
  };

  const components = {} as Record<RubricKey, GradeComponent>;
  let score = 0;
  for (const key of Object.keys(RUBRIC) as RubricKey[]) {
    const weight = RUBRIC[key];
    const weighted = raws[key] * weight;
    components[key] = { raw: round1(raws[key]), weight, weighted: round1(weighted) };
    score += weighted;
  }
  score = round1(score);

  const indep = raws.independence;
  const flagged = indep < INDEPENDENCE_GATE;

  const rationale: string[] = [];
  if (flagged) {
    rationale.push(
      `Independence ${round1(indep)} is below the gate (${INDEPENDENCE_GATE}) — routed to the integrity queue with an evidence bundle. This is a signal to a human reviewer, not an automated verdict.`,
    );
  }
  for (const key of ["coverage", "efficiency", "discipline"] as RubricKey[]) {
    if (raws[key] < 50) rationale.push(`Low ${key} (${round1(raws[key])}).`);
  }
  if (rationale.length === 0) rationale.push("Solid across the rubric; no integrity concerns.");

  return {
    score,
    letter: letterFor(score),
    components,
    independence_gate: { score: round1(indep), threshold: INDEPENDENCE_GATE, flagged },
    routed_to: flagged ? "integrity_queue" : "grade",
    rationale,
  };
}
