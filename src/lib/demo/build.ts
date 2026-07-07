import type { RawCommand } from "../pipeline/types";
import type { GoldenObjective, Session, WatcherReport } from "../../types/report";
import { assembleReport } from "../pipeline/ingest";

export interface Step { cmd: string; gap: number; dur: number; out: string; lines: number; volume?: number }

export interface DemoDef {
  id: string;
  platform: "htb" | "thm" | "immersive";
  target: string;
  session: Session;
  golden: GoldenObjective[];
  raw: RawCommand[];
  report: WatcherReport;
}

/** Cumulative-timestamp expansion of scripted steps into the RawCommand stream. */
export function buildRaw(steps: Step[], startMs: number): RawCommand[] {
  let t = startMs;
  return steps.map((s) => {
    t += s.gap;
    const started = t;
    t += s.dur;
    return {
      cmd: s.cmd,
      started_at_ms: started,
      ended_at_ms: t,
      exit_code: 0,
      output_line_count: s.lines,
      output_digest: s.out,
      context_path: "host",
      ...(s.volume ? { volume: s.volume } : {}),
    } satisfies RawCommand;
  });
}

export function makeDemo(args: {
  platform: DemoDef["platform"];
  session: Session;
  steps: Step[];
  golden: GoldenObjective[];
  startMs: number;
}): DemoDef {
  const raw = buildRaw(args.steps, args.startMs);
  const id = `${args.platform}:${args.session.uuid}`;
  const report = assembleReport(raw, { session: args.session, golden: args.golden });
  return { id, platform: args.platform, target: args.session.machine?.name ?? "target", session: args.session, golden: args.golden, raw, report };
}
