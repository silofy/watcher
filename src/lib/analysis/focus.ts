import type { WatcherReport, Episode } from "../../types/report";
import { LOW_YIELD } from "../pipeline/align";

export interface RabbitHole { start_seq: number; end_seq: number; binary: string; wasted_ms: number; }
export interface FocusResult { discipline_pct: number; rabbit_holes: RabbitHole[]; }

const RUN_MIN = 3; // sustained low-yield episodes on one binary before it's a rabbit hole

function lowYield(e: Episode): boolean {
  return e.alignment === "detour" || e.loop_of_seq != null || (e.exit_code != null && e.exit_code !== 0) || (e.output_digest != null && LOW_YIELD.test(e.output_digest));
}

const clamp = (n: number) => Math.max(0, Math.min(100, n));

/** Deterministic focus discipline: sustained low-yield persistence on one surface = a rabbit hole. */
export function computeFocus(report: WatcherReport): FocusResult {
  const running = report.episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  const holes: RabbitHole[] = [];
  let i = 0;
  while (i < running.length) {
    const bin = running[i].binary.toLowerCase();
    if (!bin || !lowYield(running[i])) { i++; continue; }
    let j = i;
    while (j + 1 < running.length && running[j + 1].binary.toLowerCase() === bin && lowYield(running[j + 1])) j++;
    const len = j - i + 1;
    if (len >= RUN_MIN) {
      let wasted = 0;
      for (let k = i; k <= j; k++) wasted += running[k].duration_ms + running[k].gap_before_ms;
      holes.push({ start_seq: running[i].seq, end_seq: running[j].seq, binary: bin, wasted_ms: wasted });
    }
    i = j + 1;
  }
  const tActive = report.metrics.time_waster.t_active_ms || 1;
  const wastedTotal = holes.reduce((a, h) => a + h.wasted_ms, 0);
  const discipline_pct = clamp(100 - (wastedTotal / tActive) * 100);
  return { discipline_pct, rabbit_holes: holes };
}
