/**
 * Capture → pipeline adapter. Joins the unified telemetry envelopes (§3.3) the capture
 * daemon emits into the `RawCommand` stream the pipeline consumes, then assembles a full,
 * schema-valid report. This is the seam where a live ConPTY/openpty capture becomes the
 * same document the Phase 1 UI renders — capture → report, end to end.
 */
import type { Coaching, CoachingStep, GoldenObjective, Metrics, Session, WatcherReport } from "../../types/report";
import { round, type ComputedMetrics } from "../metrics";
import { redactText } from "../redact";
import { classifyCoaching } from "../coaching";
import { ingestSshSession, type SshIngestOptions } from "../ssh/ingest";
import { runPipeline } from "./index";
import { annotateObjectiveStatus } from "./align";
import { extractFindings } from "./findings";
import { computeGhost } from "../ghost/ghost";
import { targetOf } from "../platform";
import type { RawCommand } from "./types";

export interface TelemetryEvent {
  source: string;
  session_uuid: string;
  seq: number;
  ts_utc_us: number;
  kind: "command" | "output" | "stdin_masked" | "http_request" | "http_response";
  payload: {
    cmd?: string;
    exit_code?: number | null;
    stream?: string;
    text?: string;
    line_count?: number;
    method?: string;
    url?: string;
    status?: number;
    req_headers?: string;
    req_body?: string;
    resp_headers?: string;
    resp_body?: string;
    mime?: string;
    pair_id?: string;
  };
  provenance?: { context_path?: string; platform?: string };
}

/** Parse a newline-delimited JSON telemetry stream. Malformed lines are skipped (like the Rust
 *  parse_ndjson's filter_map) so a single truncated line — e.g. a capture killed mid-write — doesn't
 *  abort the whole ingest. */
export function parseEnvelopes(ndjson: string): TelemetryEvent[] {
  const out: TelemetryEvent[] = [];
  for (const line of ndjson.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l) as TelemetryEvent);
    } catch {
      /* skip a malformed / truncated line */
    }
  }
  return out;
}

/** Join command + output envelopes by seq into RawCommands (the daemon's clock-join). */
export function envelopesToRawCommands(events: TelemetryEvent[]): RawCommand[] {
  const cmds = new Map<number, TelemetryEvent>();
  const outs = new Map<number, TelemetryEvent>();
  for (const e of events) {
    if (e.kind === "command") cmds.set(e.seq, e);
    else if (e.kind === "output" || e.kind === "stdin_masked") outs.set(e.seq, e);
  }

  const commandRaw: RawCommand[] = [...cmds.keys()]
    .sort((a, b) => a - b)
    .map((seq) => {
      const c = cmds.get(seq)!;
      const o = outs.get(seq);
      const startMs = Math.floor(c.ts_utc_us / 1000);
      const endMs = o ? Math.floor(o.ts_utc_us / 1000) : startMs;
      // Re-redact on the way in — the daemon never trusts an upstream agent's own scrubbing, and this
      // direct capture→report→disk path (npm run ingest) would otherwise persist live IPs, 32-hex flag
      // hashes, and key=value credentials verbatim. Mirrors what the Rust attach path does per episode.
      return {
        cmd: redactText(c.payload.cmd ?? ""),
        started_at_ms: startMs,
        ended_at_ms: Math.max(startMs, endMs),
        exit_code: c.payload.exit_code ?? null,
        output_line_count: o?.payload.line_count ?? 0,
        output_digest: o?.payload.text != null ? redactText(o.payload.text) : undefined,
        context_path: c.provenance?.context_path,
      } satisfies RawCommand;
    });

  // join http exchanges by pair_id
  const reqs = new Map<string, TelemetryEvent>();
  const resps = new Map<string, TelemetryEvent>();
  for (const e of events) {
    const pid = e.payload.pair_id;
    if (!pid) continue;
    if (e.kind === "http_request") reqs.set(pid, e);
    else if (e.kind === "http_response") resps.set(pid, e);
  }
  const webCmds: RawCommand[] = [...reqs.keys()].map((pid) => {
    const q = reqs.get(pid)!;
    const r = resps.get(pid);
    const startMs = Math.floor(q.ts_utc_us / 1000);
    const endMs = r ? Math.floor(r.ts_utc_us / 1000) : startMs;
    const url = redactText(q.payload.url ?? "");
    const path = (() => { try { const u = new URL(url); return u.pathname + u.search; } catch { return url; } })();
    return {
      cmd: `${q.payload.method ?? "GET"} ${path}`,
      started_at_ms: startMs,
      ended_at_ms: Math.max(startMs, endMs),
      exit_code: null,
      output_line_count: 0,
      context_path: q.provenance?.context_path ?? "web:burp",
      web: {
        method: q.payload.method ?? "GET",
        url,
        req_body: q.payload.req_body != null ? redactText(q.payload.req_body) : undefined,
        status: r?.payload.status,
        resp_body: r?.payload.resp_body != null ? redactText(r.payload.resp_body) : undefined,
        mime: r?.payload.mime,
      },
    } satisfies RawCommand;
  });

  return [...commandRaw, ...webCmds].sort((a, b) => a.started_at_ms - b.started_at_ms);
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

/** A captured interactive SSH session (from the `script` tap) to fold in as on-target commands. */
export interface SshSessionInput extends SshIngestOptions {
  /** the `script --log-in` transcript of the session. */
  inputLog: string;
}

export interface AssembleOptions {
  golden: GoldenObjective[];
  session: Session;
  redaction_profile?: "public_safe" | "full";
  /** interactive SSH sessions captured over this run — merged into the command stream by time. */
  ssh?: SshSessionInput[];
}

/** Run the pipeline over raw commands and assemble a complete, schema-valid report. */
export function assembleReport(raw: RawCommand[], opts: AssembleOptions): WatcherReport {
  const sessionStartMs = Date.parse(opts.session.started_at);
  // fold captured SSH sessions in as on-target commands, interleaved by time so phases stay ordered
  const sshRaw = (opts.ssh ?? []).flatMap((s) => ingestSshSession(s.inputLog, s));
  const merged = sshRaw.length ? [...raw, ...sshRaw].sort((a, b) => a.started_at_ms - b.started_at_ms) : raw;
  const { episodes, phases, golden, metrics } = runPipeline(merged, {
    golden: opts.golden,
    sessionStartMs: Number.isNaN(sessionStartMs) ? undefined : sessionStartMs,
  });

  const profile = opts.redaction_profile ?? "full";
  const findings = extractFindings(episodes, profile);
  const annotatedGolden = annotateObjectiveStatus(episodes, golden, findings);
  const ghost = computeGhost({ golden_dag: annotatedGolden, episodes, findings } as WatcherReport);

  const m: Metrics = {
    efficiency_pct: round(metrics.efficiency_pct),
    time_waster: metrics.time_waster,
    stealth_score: round(metrics.stealth_score),
    loud_moments: metrics.loud_moments.map((l) => ({ seq: l.seq, noise: round(l.noise, 1) })),
    objective_coverage_pct: round(metrics.objective_coverage_pct),
    technique_breadth: metrics.technique_breadth,
    ukc_coverage_pct: round(metrics.ukc_coverage_pct),
    ukc_progression: round(metrics.ukc_progression),
    weakness_breadth: metrics.weakness_breadth,
    methodology_coverage_pct: round(metrics.methodology_coverage_pct),
    focus_discipline_pct: round(metrics.focus_discipline_pct),
    recovery_median_ms: metrics.recovery_median_ms,
    ghost_time_lost_ms: ghost?.time_lost_ms ?? null,
    ghost_human_wins: ghost?.human_wins ?? null,
  };

  const rep: WatcherReport = {
    schema_version: "1.4",
    session: opts.session,
    episodes,
    phases,
    golden_dag: annotatedGolden,
    metrics: m,
    coaching: deriveCoaching(golden, episodes, metrics),
    replay: { cast_ref: null, inline_cast: null },
    redaction_profile: profile,
    findings,
    ghost: ghost ?? undefined,
  };
  // Neutral target identity for every freshly assembled report — an explicit session.target (set
  // upstream by capture) wins; otherwise it's resolved from the platform adapters.
  rep.session.target = targetOf(rep);
  return rep;
}

/** Convenience: NDJSON capture stream → full report in one call. */
export function reportFromNdjson(ndjson: string, opts: AssembleOptions): WatcherReport {
  return assembleReport(envelopesToRawCommands(parseEnvelopes(ndjson)), opts);
}
