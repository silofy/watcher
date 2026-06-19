/**
 * Retroactive session trim. The recorder is always rolling, so a "session" is a *selection*
 * over the continuous stream — and because every metric is deterministic, re-scoping the
 * report to a window is just filtering episodes to a seq range and re-deriving phases,
 * coverage, and metrics. This is the safety valve for any missed or over-eager auto-boundary:
 * drag the start/end and the report regenerates identically.
 */
import type { WatcherReport } from "../types/report";
import { derivePhases } from "./pipeline";
import { objectiveCoverage } from "./pipeline/align";
import { round } from "./metrics";

/** Return the report scoped to the inclusive seq window, or the full report when range is null. */
export function applyTrim(full: WatcherReport, range: [number, number] | null): WatcherReport {
  if (!range) return full;
  const lo = Math.min(range[0], range[1]);
  const hi = Math.max(range[0], range[1]);

  const episodes = full.episodes.filter((e) => e.seq >= lo && e.seq <= hi);
  const golden_dag = full.golden_dag.map((o) => ({
    ...o,
    user_satisfied_by_seq:
      o.user_satisfied_by_seq != null && o.user_satisfied_by_seq >= lo && o.user_satisfied_by_seq <= hi
        ? o.user_satisfied_by_seq
        : null,
  }));

  const startMs = Date.parse(full.session.started_at);
  const phases = derivePhases(episodes, Number.isNaN(startMs) ? 0 : startMs);

  return {
    ...full,
    episodes,
    golden_dag,
    phases,
    metrics: { ...full.metrics, objective_coverage_pct: round(objectiveCoverage(golden_dag)) },
  };
}

/** The full session's seq bounds, for the trim control. */
export function seqBounds(full: WatcherReport): [number, number] {
  const seqs = full.episodes.map((e) => e.seq);
  return [Math.min(...seqs), Math.max(...seqs)];
}
