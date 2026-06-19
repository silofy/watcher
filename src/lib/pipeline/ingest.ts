/**
 * Capture → pipeline adapter. Joins the unified telemetry envelopes (§3.3) the capture
 * daemon emits into the `RawCommand` stream the pipeline consumes, then assembles a full,
 * schema-valid report. This is the seam where a live ConPTY/openpty capture becomes the
 * same document the Phase 1 UI renders — capture → report, end to end.
 */
import type { Coaching, CoachingStep, GoldenObjective, Metrics, Session, WatcherReport } from "../../types/report";
import { round, type ComputedMetrics } from "../metrics";
import { classifyCoaching } from "../coaching";
import { runPipeline } from "./index";
import type { RawCommand } from "./types";

export interface TelemetryEvent {
  source: string;
  session_uuid: string;
  seq: number;
  ts_utc_us: number;
  kind: "command" | "output" | "stdin_masked";
  payload: {
    cmd?: string;
    exit_code?: number | null;
    stream?: string;
    text?: string;
    line_count?: number;
  };
  provenance?: { context_path?: string; platform?: string };
}

/** Parse a newline-delimited JSON telemetry stream. */
export function parseEnvelopes(ndjson: string): TelemetryEvent[] {
  return ndjson
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as TelemetryEvent);
}

/** Join command + output envelopes by seq into RawCommands (the daemon's clock-join). */
export function envelopesToRawCommands(events: TelemetryEvent[]): RawCommand[] {
  const cmds = new Map<number, TelemetryEvent>();
  const outs = new Map<number, TelemetryEvent>();
  for (const e of events) {
    if (e.kind === "command") cmds.set(e.seq, e);
    else outs.set(e.seq, e); // output | stdin_masked
  }

  return [...cmds.keys()]
    .sort((a, b) => a - b)
    .map((seq) => {
      const c = cmds.get(seq)!;
      const o = outs.get(seq);
      const startMs = Math.floor(c.ts_utc_us / 1000);
      const endMs = o ? Math.floor(o.ts_utc_us / 1000) : startMs;
      return {
        cmd: c.payload.cmd ?? "",
        started_at_ms: startMs,
        ended_at_ms: Math.max(startMs, endMs),
        exit_code: c.payload.exit_code ?? null,
        output_line_count: o?.payload.line_count ?? 0,
        output_digest: o?.payload.text,
        context_path: c.provenance?.context_path,
      } satisfies RawCommand;
    });
}

function deriveCoaching(
  golden: GoldenObjective[],
  episodes: WatcherReport["episodes"],
  metrics: ComputedMetrics,
): Coaching {
  const eff = metrics.efficiency_by_tactic;
  const skill_radar = {
    recon: round(eff.TA0007 ?? 50),
    web: round(eff.TA0001 ?? 50),
    exploit: round(eff.TA0002 ?? 50),
    privesc: round(eff.TA0004 ?? 50),
    opsec: round(metrics.stealth_score),
  };

  const next_steps: CoachingStep[] = [];
  for (const o of golden) {
    if (o.user_satisfied_by_seq == null) {
      const name = o.objective.replace(/_/g, " ");
      next_steps.push({
        action: `Attempt **${name}**`,
        why: `You never tried it — \`${o.satisfied_by[0]}\` is the intended route, and it's a free check you skipped.`,
        category: classifyCoaching(`${name} ${o.satisfied_by[0]}`),
        evidence_seq: null,
      });
    }
  }
  if (metrics.loud_moments.length) {
    const top = metrics.loud_moments[0];
    const b = episodes.find((e) => e.seq === top.seq)?.binary ?? "a command";
    next_steps.push({
      action: `Quiet down \`${b}\``,
      why: `Your loudest moment — a noisier footprint than the rest of the run combined. Reach for a stealthier approach here.`,
      category: "OpSec",
      evidence_seq: top.seq,
    });
  }
  const detourMin = Math.round(metrics.time_waster.detour_ms / 60000);
  if (detourMin >= 1)
    next_steps.push({
      action: `Trim ~${detourMin} min of detours`,
      why: `Time spent on low-yield paths that didn't move an objective — step back to enumeration before forcing a path.`,
      category: "Tactics",
      evidence_seq: null,
    });
  if (next_steps.length === 0)
    next_steps.push({ action: "Clean run", why: "No skipped objectives or major waste detected.", category: "Recap", evidence_seq: null });

  return { skill_radar, next_steps };
}

export interface AssembleOptions {
  golden: GoldenObjective[];
  session: Session;
  redaction_profile?: "public_safe" | "full";
}

/** Run the pipeline over raw commands and assemble a complete, schema-valid report. */
export function assembleReport(raw: RawCommand[], opts: AssembleOptions): WatcherReport {
  const sessionStartMs = Date.parse(opts.session.started_at);
  const { episodes, phases, golden, metrics } = runPipeline(raw, {
    golden: opts.golden,
    sessionStartMs: Number.isNaN(sessionStartMs) ? undefined : sessionStartMs,
  });

  const m: Metrics = {
    efficiency_pct: round(metrics.efficiency_pct),
    time_waster: metrics.time_waster,
    stealth_score: round(metrics.stealth_score),
    loud_moments: metrics.loud_moments.map((l) => ({ seq: l.seq, noise: round(l.noise, 1) })),
    objective_coverage_pct: round(metrics.objective_coverage_pct),
    technique_breadth: metrics.technique_breadth,
  };

  return {
    schema_version: "1.0",
    session: opts.session,
    episodes,
    phases,
    golden_dag: golden,
    metrics: m,
    coaching: deriveCoaching(golden, episodes, metrics),
    replay: { cast_ref: null, inline_cast: null },
    redaction_profile: opts.redaction_profile ?? "full",
  };
}

/** Convenience: NDJSON capture stream → full report in one call. */
export function reportFromNdjson(ndjson: string, opts: AssembleOptions): WatcherReport {
  return assembleReport(envelopesToRawCommands(parseEnvelopes(ndjson)), opts);
}
