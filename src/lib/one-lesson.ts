import type { WatcherReport } from "../types/report";
import { topUnmetCheck } from "./analysis/methodology";
import { computeFocus } from "./analysis/focus";
import { normalizeCoaching, stepText } from "./coaching";
import { humanizeObjective } from "./audits";

export interface OneLesson {
  text: string;
  evidence_seq: number | null;
}

/**
 * The single most impactful, evidence-backed takeaway — deterministic, no clock/random, no new
 * metric. Reuses the existing engines rather than reimplementing them; this just picks among
 * their outputs. First applicable wins, in order of how load-bearing the miss is:
 *   1. the worst Ghost late-pivot (you had the prerequisite and sat on it),
 *   2. the top unmet methodology check (a whole discipline skipped),
 *   3. the worst rabbit hole (time actually burned on one surface),
 *   4. the first actionable (non-Recap) coaching step.
 * Returns null when none apply — a clean run, or an old/live report with nothing to lead with.
 * The hero (App.tsx) omits itself gracefully in that case rather than show a recap stat.
 */
export function pickOneLesson(report: WatcherReport): OneLesson | null {
  const latePivots = (report.ghost?.items ?? []).filter((i) => i.verdict === "late_pivot");
  if (latePivots.length) {
    const worst = latePivots.reduce((a, b) => ((b.lag_ms ?? 0) > (a.lag_ms ?? 0) ? b : a));
    const text =
      worst.note ??
      `Unlocked for ${humanizeObjective(worst.objective)} at step ${worst.unlock_seq} but you didn't act until step ${worst.actual_seq} — the optimal line pivots here sooner.`;
    return { text, evidence_seq: worst.actual_seq ?? worst.unlock_seq ?? null };
  }

  const miss = topUnmetCheck(report);
  if (miss) {
    return { text: `${miss.label} — ${miss.hint}`, evidence_seq: miss.evidence_seq };
  }

  const holes = computeFocus(report).rabbit_holes;
  if (holes.length) {
    const worst = holes.reduce((a, b) => (b.wasted_ms > a.wasted_ms ? b : a));
    return {
      text: `You spent a run of low-yield \`${worst.binary}\` attempts — step back and enumerate before forcing a path.`,
      evidence_seq: worst.start_seq,
    };
  }

  const actionable = normalizeCoaching(report.coaching?.next_steps).find((s) => s.category !== "Recap");
  if (actionable) return { text: stepText(actionable), evidence_seq: actionable.evidence_seq ?? null };

  return null;
}
