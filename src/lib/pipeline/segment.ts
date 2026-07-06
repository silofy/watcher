/**
 * Episode segmentation (brief §4.1): machine-time vs think-time.
 *
 * duration_ms is the machine working; the inter-command gap is the human thinking.
 * Each command becomes an episode card tagged with an actor mode from metadata alone,
 * and a long pause is broken out into its own think_pause (or idle) episode so the
 * Time-Waster metric can see it. A machine_bound command is one atomic episode — its
 * output is never chunked.
 */
import type { Episode } from "../../types/report";
import { DEFAULT_SEGMENT_CONFIG, extractBinary, type RawCommand, type SegmentConfig } from "./types";
import { classifyCommand, isOnTarget } from "./mitre";
import { classifyExchange } from "./web";

/** Which lane a command runs in — the attacker host, or on a compromised target (ssh-tap). */
function laneOf(contextPath?: string): "host" | "target" {
  return isOnTarget(contextPath) ? "target" : "host";
}

const NOISE_WEIGHTS: Record<string, number> = {
  hydra: 10,
  medusa: 10,
  sqlmap: 8,
  nikto: 7,
  gobuster: 6,
  ffuf: 6,
  feroxbuster: 6,
  masscan: 6,
  nmap: 4,
  rustscan: 5,
  pspy: 2,
  pspy64: 2,
  linpeas: 3,
};

function noiseWeight(binary: string): number {
  return NOISE_WEIGHTS[binary.toLowerCase()] ?? 1;
}

/** Turn joined raw commands into episode cards. Input is assumed ordered by start time. */
export function segmentEpisodes(
  raw: RawCommand[],
  cfg: SegmentConfig = DEFAULT_SEGMENT_CONFIG,
): Episode[] {
  const episodes: Episode[] = [];
  let seq = 1;
  // Think-time is measured within a lane: a jump from the host shell to an on-target shell is a
  // context switch, not 6 minutes of staring — so each lane tracks its own previous command end.
  const prevEndByLane = new Map<"host" | "target", number>();
  let lastTactic = "TA0007";

  for (const r of raw) {
    const lane = laneOf(r.context_path);
    const prevEnd = prevEndByLane.get(lane) ?? null;
    const gap = prevEnd == null ? 0 : Math.max(0, r.started_at_ms - prevEnd);
    let residualGap = gap;

    const duration = Math.max(0, r.ended_at_ms - r.started_at_ms);
    const binary = extractBinary(r.cmd);
    const webPrior = r.web ? classifyExchange(r.web) : null;
    const prior = webPrior
      ? { tactic: webPrior.tactic, technique: webPrior.technique, confidence: webPrior.confidence }
      : classifyCommand(r.cmd, lastTactic, r.context_path);

    // Break a long pause into its own episode (think_pause, or idle if very long).
    // The gap-before belongs to the action it precedes, so the pause carries the
    // NEXT command's tactic — a stall before `sudo -l` is privesc reasoning, and
    // its stuck-time must be charged to the privesc phase.
    if (gap >= cfg.thinkPauseSplitMs) {
      const actor = gap >= cfg.idleGapMs ? "idle" : "think_pause";
      episodes.push({
        seq: seq++,
        cmd: "",
        binary: "",
        // carry the following command's start so the pause fills [prevEnd, nextStart] on the axis
        started_at_ms: r.started_at_ms,
        duration_ms: 0,
        gap_before_ms: gap,
        exit_code: null,
        actor,
        output_digest: actor === "idle" ? "walked away" : "long pause — reasoning or stuck",
        tactic: prior.tactic,
        confidence: 0,
        noise_weight: 0,
        volume: 0,
        context_path: r.context_path,
        alignment: null,
      });
      residualGap = 0;
    }

    const isScan = cfg.scanningBinaries.has(binary.toLowerCase());
    const machineBound =
      duration >= cfg.machineBoundMinDurationMs &&
      (isScan || r.output_line_count >= cfg.machineBoundMinLines);

    episodes.push({
      seq: seq++,
      cmd: r.cmd,
      binary,
      started_at_ms: r.started_at_ms,
      duration_ms: duration,
      gap_before_ms: residualGap,
      exit_code: r.exit_code,
      actor: machineBound ? "machine_bound" : "human_active",
      output_digest: r.output_digest,
      tactic: prior.tactic,
      technique: prior.technique,
      confidence: prior.confidence,
      noise_weight: noiseWeight(binary),
      volume: r.volume ?? 1,
      context_path: r.context_path,
      alignment: null,
      ...(webPrior?.cwe ? { frameworks: { cwe: [webPrior.cwe] } } : {}),
    });

    lastTactic = prior.tactic;
    prevEndByLane.set(lane, r.ended_at_ms);
  }

  return episodes;
}
