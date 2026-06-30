/**
 * Phase 3 pipeline orchestrator (brief §4).
 *
 *   raw telemetry → segment (episodes) → MITRE prior (in segment) → align (vs golden DAG)
 *                 → derive phases → deterministic metrics
 *
 * The output is the same episode/phase/alignment shape the report contract defines, so
 * Phase 3 plugs straight into the Phase 1 UI. The LLM refinement passes (GBNF-constrained
 * classification, objective-equivalence) layer on top of these deterministic priors.
 */
import type { Episode, GoldenObjective, Phase } from "../../types/report";
import { buildTimeline } from "../scale";
import { efficiencyByTactic, computeMetrics, round, type ComputedMetrics } from "../metrics";
import { segmentEpisodes } from "./segment";
import { alignEpisodes } from "./align";
import { enrichFrameworks } from "./frameworks";
import type { RawCommand, SegmentConfig } from "./types";

export const TACTIC_LABELS: Record<string, string> = {
  TA0007: "Discovery",
  TA0001: "Initial Access",
  TA0002: "Execution",
  TA0006: "Credential Access",
  TA0004: "Privilege Escalation",
  TA0008: "Lateral Movement",
  TA0011: "Command and Control",
  TA0010: "Exfiltration",
};

/** Derive the phase map from segmented+aligned episodes (confidence-weighted in later phases). */
export function derivePhases(episodes: Episode[], sessionStartMs: number): Phase[] {
  const timeline = buildTimeline(episodes);
  const eff = efficiencyByTactic(episodes);

  const order: string[] = [];
  for (const it of timeline.items) {
    if (!order.includes(it.ep.tactic)) order.push(it.ep.tactic);
  }

  return order.map((tactic) => {
    const inPhase = timeline.items.filter((it) => it.ep.tactic === tactic);
    const t0 = Math.min(...inPhase.map((i) => i.gapStart));
    const t1 = Math.max(...inPhase.map((i) => i.t1));
    return {
      mitre_tactic: tactic,
      label: TACTIC_LABELS[tactic] ?? tactic,
      started_at: new Date(sessionStartMs + t0).toISOString(),
      ended_at: new Date(sessionStartMs + t1).toISOString(),
      efficiency_pct: round(eff[tactic] ?? 100),
    };
  });
}

export interface PipelineResult {
  episodes: Episode[];
  phases: Phase[];
  golden: GoldenObjective[];
  metrics: ComputedMetrics;
}

export interface PipelineOptions {
  golden: GoldenObjective[];
  sessionStartMs?: number;
  segmentConfig?: SegmentConfig;
}

/** Run the full deterministic pipeline over a raw command stream. */
export function runPipeline(raw: RawCommand[], opts: PipelineOptions): PipelineResult {
  const sessionStartMs = opts.sessionStartMs ?? (raw.length ? raw[0].started_at_ms : 0);
  const segmented = segmentEpisodes(raw, opts.segmentConfig);
  const aligned = alignEpisodes(segmented, opts.golden);
  const episodes = enrichFrameworks(aligned.episodes);
  const golden = aligned.golden;
  const phases = derivePhases(episodes, sessionStartMs);

  // computeMetrics consumes the report shape; supply the fields it reads.
  const metrics = computeMetrics({
    episodes,
    golden_dag: golden,
  } as Parameters<typeof computeMetrics>[0]);

  return { episodes, phases, golden, metrics };
}

export * from "./types";
export * from "./mitre";
export * from "./segment";
export * from "./align";
