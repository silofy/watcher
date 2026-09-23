import type { Episode, GoldenObjective } from "../types/report";

export type RouteStatus = "match" | "alternative" | "out_of_order" | "skipped";

export interface RouteStep {
  objective: string;
  status: RouteStatus;
  /** the step that satisfied it, or null when skipped */
  seq: number | null;
  /** the write-up's first tool for it: the "try …" fix for a skip */
  suggestion: string | null;
  /** the binary you actually used (for an alternative method) */
  binary: string | null;
}

/** The write-up's objectives in intended order, each classified against your run. */
export function routeSteps(golden: GoldenObjective[], episodes: Episode[]): RouteStep[] {
  const bySeq = new Map(episodes.map((e) => [e.seq, e]));
  return golden.map((o) => {
    const seq = o.user_satisfied_by_seq ?? null;
    const e = seq == null ? undefined : bySeq.get(seq);
    const a = e?.alignment;
    const status: RouteStatus = seq == null ? "skipped" : a === "alternative" || a === "out_of_order" ? a : "match";
    return { objective: o.objective, status, seq, suggestion: o.satisfied_by[0] ?? null, binary: e?.binary ?? null };
  });
}

export function routeCounts(steps: RouteStep[]): Record<RouteStatus, number> {
  const out: Record<RouteStatus, number> = { match: 0, alternative: 0, out_of_order: 0, skipped: 0 };
  for (const s of steps) out[s.status]++;
  return out;
}
