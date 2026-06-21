/**
 * Deterministic metrics engine (brief §6.1).
 *
 * Everything here is pure and reproducible — a re-run over the same episodes
 * yields byte-identical numbers, which is the whole point: grading must be
 * defensible (brief §4.3). The LLM never touches this path.
 *
 *   Time-Waster:  Wasted = Detour(D) + Stuck-excess(S) + Loop(L)
 *                 Efficiency = (1 − Wasted / T_active) × 100
 *   Stealth:      n(c) = w × (1 + log10(volume));  Stealth = 100 − normalized noise
 *
 * Waste buckets are disjoint, with precedence detour > loop > stuck, so no
 * millisecond is counted twice.
 */
import type { Episode, WatcherReport } from "../types/report";

/**
 * Per-lab loudness baseline the summed noise is normalized against (brief §6.1):
 * Stealth = 100 − 100 × (Σ noise / baseline). It is an honest relative heuristic,
 * not a calibrated detection probability. Calibrated per lab; this value is the
 * reference for the bundled HTB-easy fixture.
 */
export const NOISE_BASELINE = 400;

/** How many of the loudest episodes to pin on the timeline. */
export const LOUD_MOMENT_COUNT = 3;

/** Active wall-clock a non-idle episode occupies: machine time + the think gap before it. */
export function activeMs(ep: Episode): number {
  if (ep.actor === "idle") return 0;
  return ep.duration_ms + ep.gap_before_ms;
}

/** Loudness of a single command, scaled by volume (brief §6.1). */
export function episodeNoise(ep: Episode): number {
  const w = ep.noise_weight ?? 0;
  if (w === 0) return 0;
  const volume = Math.max(1, ep.volume ?? 1);
  return w * (1 + Math.log10(volume));
}

/** Nearest-rank percentile (deterministic — no interpolation ambiguity). */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(p * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * The user's think-time baseline: P75 of the gap before human_active / think_pause
 * episodes. Computed once, globally — it is the operator's personal baseline, and
 * "stuck" is think-time above it.
 */
export function thinkBaselineP75(episodes: Episode[]): number {
  const gaps = episodes
    .filter((e) => e.actor === "human_active" || e.actor === "think_pause")
    .map((e) => e.gap_before_ms);
  return percentile(gaps, 0.75);
}

export interface WasteBreakdown {
  productive_ms: number;
  detour_ms: number;
  stuck_ms: number;
  loop_ms: number;
  t_active_ms: number;
  efficiency_pct: number;
}

/** Classify one episode's active time into its waste bucket given the global baseline. */
function classify(ep: Episode, p75: number): WasteBreakdown {
  const active = activeMs(ep);
  const zero: WasteBreakdown = {
    productive_ms: 0,
    detour_ms: 0,
    stuck_ms: 0,
    loop_ms: 0,
    t_active_ms: active,
    efficiency_pct: 0,
  };
  if (active === 0) return zero;

  // precedence: detour > loop > stuck
  if (ep.alignment === "detour") return { ...zero, detour_ms: active };
  if (ep.loop_of_seq != null) return { ...zero, loop_ms: active };
  if (ep.actor === "think_pause") {
    const stuck = Math.max(0, ep.gap_before_ms - p75);
    return { ...zero, stuck_ms: stuck, productive_ms: active - stuck };
  }
  return { ...zero, productive_ms: active };
}

function fold(parts: WasteBreakdown[]): WasteBreakdown {
  const sum = parts.reduce(
    (a, b) => ({
      productive_ms: a.productive_ms + b.productive_ms,
      detour_ms: a.detour_ms + b.detour_ms,
      stuck_ms: a.stuck_ms + b.stuck_ms,
      loop_ms: a.loop_ms + b.loop_ms,
      t_active_ms: a.t_active_ms + b.t_active_ms,
      efficiency_pct: 0,
    }),
    { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0, efficiency_pct: 0 },
  );
  const wasted = sum.detour_ms + sum.stuck_ms + sum.loop_ms;
  sum.efficiency_pct = sum.t_active_ms === 0 ? 100 : (1 - wasted / sum.t_active_ms) * 100;
  return sum;
}

/** Full waste breakdown across all episodes. */
export function wasteBreakdown(episodes: Episode[]): WasteBreakdown {
  const p75 = thinkBaselineP75(episodes);
  return fold(episodes.map((e) => classify(e, p75)));
}

/**
 * Full waste breakdown per MITRE tactic — the per-phase counterpart of `wasteBreakdown`.
 * Crucially this classifies against the GLOBAL think-baseline (p75 over the whole session), so a
 * phase's "stuck" time is measured against the operator's own normal pace, not the phase's local pace
 * (which would make every phase look ~average). That makes the per-phase numbers comparable.
 */
export function wasteByTactic(episodes: Episode[]): Record<string, WasteBreakdown> {
  const p75 = thinkBaselineP75(episodes);
  const groups = new Map<string, WasteBreakdown[]>();
  for (const e of episodes) {
    if (!groups.has(e.tactic)) groups.set(e.tactic, []);
    groups.get(e.tactic)!.push(classify(e, p75));
  }
  const out: Record<string, WasteBreakdown> = {};
  for (const [tactic, parts] of groups) out[tactic] = fold(parts);
  return out;
}

/** Efficiency per MITRE tactic (each phase owns a distinct tactic in this build). */
export function efficiencyByTactic(episodes: Episode[]): Record<string, number> {
  const waste = wasteByTactic(episodes);
  const out: Record<string, number> = {};
  for (const [tactic, w] of Object.entries(waste)) out[tactic] = w.efficiency_pct;
  return out;
}

export interface ComputedMetrics {
  efficiency_pct: number;
  time_waster: {
    productive_ms: number;
    detour_ms: number;
    stuck_ms: number;
    loop_ms: number;
    t_active_ms: number;
  };
  stealth_score: number;
  total_noise: number;
  loud_moments: { seq: number; noise: number }[];
  objective_coverage_pct: number;
  technique_breadth: number;
  p75_gap_ms: number;
  efficiency_by_tactic: Record<string, number>;
}

/** The single deterministic computation the UI and the conformance test both call. */
export function computeMetrics(report: WatcherReport): ComputedMetrics {
  const { episodes, golden_dag } = report;
  const waste = wasteBreakdown(episodes);

  // Anchor against the box's own loud reference solve when present; else the global default baseline.
  const baseline = report.noise_baseline?.total ?? NOISE_BASELINE;
  const totalNoise = episodes.reduce((a, e) => a + episodeNoise(e), 0);
  const normalized = Math.min(100, (totalNoise / baseline) * 100);
  const stealth = Math.max(0, 100 - normalized);

  const loud = episodes
    .map((e) => ({ seq: e.seq, noise: episodeNoise(e) }))
    .filter((m) => m.noise > 0)
    .sort((a, b) => b.noise - a.noise)
    .slice(0, LOUD_MOMENT_COUNT);

  const satisfied = golden_dag.filter((o) => o.user_satisfied_by_seq != null).length;
  const coverage = golden_dag.length === 0 ? 0 : (satisfied / golden_dag.length) * 100;

  const breadth = new Set(episodes.map((e) => e.technique).filter(Boolean)).size;

  return {
    efficiency_pct: waste.efficiency_pct,
    time_waster: {
      productive_ms: waste.productive_ms,
      detour_ms: waste.detour_ms,
      stuck_ms: waste.stuck_ms,
      loop_ms: waste.loop_ms,
      t_active_ms: waste.t_active_ms,
    },
    stealth_score: stealth,
    total_noise: totalNoise,
    loud_moments: loud,
    objective_coverage_pct: coverage,
    technique_breadth: breadth,
    p75_gap_ms: thinkBaselineP75(episodes),
    efficiency_by_tactic: efficiencyByTactic(episodes),
  };
}

export const round = (n: number, dp = 0): number => {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};
