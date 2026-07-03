import type { WatcherReport, Episode } from "../../types/report";

export interface Recovery { stuck_seq: number; recovered_seq: number; latency_ms: number; }
export interface RecoveryResult { recoveries: Recovery[]; median_ms: number | null; }

function isStuck(e: Episode): boolean { return e.alignment === "detour" || e.loop_of_seq != null; }

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

/** Deterministic recovery: latency from the start of a stuck/detour cluster to the next objective-advancing episode. */
export function computeRecovery(report: WatcherReport): RecoveryResult {
  const running = report.episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  const satisfierSeqs = new Set(report.golden_dag.map((o) => o.user_satisfied_by_seq).filter((s): s is number => s != null));
  const recoveries: Recovery[] = [];
  let i = 0;
  while (i < running.length) {
    if (!isStuck(running[i])) { i++; continue; }
    const start = i;
    while (i < running.length && isStuck(running[i])) i++;
    // i now points at the first non-stuck episode after the cluster (or end)
    const recovered = running.slice(i).find((e) => satisfierSeqs.has(e.seq) || e.alignment === "match" || e.alignment === "alternative");
    if (recovered) {
      let latency = 0;
      for (let k = start; k < running.length && running[k].seq <= recovered.seq; k++) latency += running[k].duration_ms + running[k].gap_before_ms;
      recoveries.push({ stuck_seq: running[start].seq, recovered_seq: recovered.seq, latency_ms: latency });
    }
  }
  return { recoveries, median_ms: median(recoveries.map((r) => r.latency_ms)) };
}
