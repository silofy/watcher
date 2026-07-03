import type { WatcherReport, Episode, Finding, GoldenObjective, GhostVerdict } from "../../types/report";

export interface GhostDiffItem { objective: string; verdict: GhostVerdict; unlock_seq: number | null; actual_seq: number | null; lag_ms: number; note: string; }
export interface GhostResult { time_lost_ms: number; human_wins: number; items: GhostDiffItem[]; }

/** Finding kinds that "enable" attempting a tactic (make its objectives attemptable). */
const ENABLING: Record<string, Finding["kind"][]> = {
  TA0001: ["port", "service", "version", "url", "path", "cred", "vuln"],
  TA0002: ["port", "service", "version", "url", "path", "cred", "vuln"],
  TA0006: ["cred", "hash", "service", "url"],
  TA0008: ["cred", "hash", "host"],
};
/** More than this many running episodes between unlock and action = a late pivot (you had chances to pivot). */
const LATE_PIVOT_INTERVENING = 2;

export function computeGhost(report: WatcherReport): GhostResult | null {
  const golden = report.golden_dag;
  if (!golden.length) return null;
  const episodes = report.episodes;
  const findings = report.findings ?? [];

  const running = episodes.filter((e) => e.actor !== "think_pause" && e.actor !== "idle");
  const startSeq = running.length ? running[0].seq : (episodes[0]?.seq ?? 0);

  // cumulative elapsed (gap+duration) by seq, over episodes in seq order
  const bySeq = new Map<number, Episode>(episodes.map((e) => [e.seq, e]));
  const ordered = [...episodes].sort((a, b) => a.seq - b.seq);
  const elapsed = new Map<number, number>();
  let acc = 0;
  for (const e of ordered) { acc += (e.gap_before_ms ?? 0) + (e.duration_ms ?? 0); elapsed.set(e.seq, acc); }
  const elapsedAt = (seq: number | null) => (seq == null ? 0 : elapsed.get(seq) ?? 0);
  const runningBetween = (a: number, b: number) => running.filter((e) => e.seq > a && e.seq < b).length;

  // earliest finding seq whose kind enables a tactic
  const enablingSeq = (tactic: string): number | null => {
    if (tactic === "TA0007") return startSeq; // discovery is always available
    const kinds = ENABLING[tactic] ?? [];
    const seqs = findings.filter((f) => kinds.includes(f.kind)).map((f) => f.source_seq);
    return seqs.length ? Math.min(...seqs) : null;
  };

  // unlock_seq by objective — topological (golden authored deps-first); memoized
  const unlock = new Map<string, number | null>();
  const bySlug = new Map(golden.map((o) => [o.objective, o]));
  const unlockOf = (o: GoldenObjective, seen: Set<string>): number | null => {
    if (unlock.has(o.objective)) return unlock.get(o.objective)!;
    if (seen.has(o.objective)) return null; // cycle guard
    seen.add(o.objective);
    const depUnlocks = (o.depends_on ?? []).map((d) => { const dep = bySlug.get(d); return dep ? unlockOf(dep, seen) : null; }).filter((s): s is number => s != null);
    const en = enablingSeq(o.tactic);
    const candidates = [...depUnlocks, ...(en != null ? [en] : [])];
    const u = candidates.length ? Math.max(...candidates) : null;
    unlock.set(o.objective, u);
    return u;
  };

  const items: GhostDiffItem[] = [];
  let timeLost = 0;
  let wins = 0;
  for (const o of golden) {
    const u = unlockOf(o, new Set());
    const actual = o.user_satisfied_by_seq ?? null;
    const satAlign = actual != null ? bySeq.get(actual)?.alignment : undefined;
    let verdict: GhostVerdict;
    let lag = 0;
    if (actual != null && satAlign === "alternative") { verdict = "off_path_win"; wins++; }
    // "ahead" requires a real unlock: u==null means no finding-based unlock exists for this
    // objective's tactic (e.g. TA0004/privesc, which isn't in ENABLING yet) — without an unlock
    // to beat, satisfying the objective is not a human win, just on_time.
    else if (actual != null && u != null && actual <= u) { verdict = "ahead"; wins++; }
    else if (actual == null && u != null) { verdict = "skipped"; }
    else if (actual != null && u != null && runningBetween(u, actual) > LATE_PIVOT_INTERVENING) { verdict = "late_pivot"; lag = Math.max(0, elapsedAt(actual) - elapsedAt(u)); timeLost += lag; }
    else { verdict = "on_time"; }
    const note = deterministicNote(o.objective, verdict, u, actual, lag);
    items.push({ objective: o.objective, verdict, unlock_seq: u, actual_seq: actual, lag_ms: lag, note });
  }
  return { time_lost_ms: timeLost, human_wins: wins, items };
}

function deterministicNote(obj: string, v: GhostVerdict, u: number | null, actual: number | null, _lag: number): string {
  const name = obj.replace(/_/g, " ");
  switch (v) {
    case "late_pivot": return `Unlocked at step ${u} but you acted at step ${actual} — the optimal line pivots here sooner.`;
    case "skipped": return `Unlocked at step ${u}; never attempted — the optimal line takes it.`;
    case "ahead": return `You did ${name} before its prerequisite surfaced — ahead of the optimal line.`;
    case "off_path_win": return `You reached ${name} via your own route — off the intended path.`;
    default: return `On the optimal line for ${name}.`;
  }
}
