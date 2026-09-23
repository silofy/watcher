import type { PhaseAudit } from "./audits";
import { fmtDuration } from "./format";

/** Below this, time lost is noise: the same floor `summaryLine` uses for "no time wasted". */
export const WASTE_FLOOR_MS = 30_000;

export interface PhaseStats {
  objectives: { reached: number; total: number } | null;
  lost: string;
  lostIsZero: boolean;
}

/** A phase's summary sentence as two figures: objectives reached, and time lost. */
export function phaseStats(p: Pick<PhaseAudit, "coverage" | "wasted_ms">): PhaseStats {
  const zero = p.wasted_ms < WASTE_FLOOR_MS;
  return {
    objectives: p.coverage.total > 0 ? { reached: p.coverage.satisfied, total: p.coverage.total } : null,
    lost: zero ? "0m" : fmtDuration(p.wasted_ms),
    lostIsZero: zero,
  };
}

export function phaseLead(phases: Pick<PhaseAudit, "efficiency">[]): { full: number; total: number } {
  return { full: phases.filter((p) => p.efficiency >= 100).length, total: phases.length };
}
