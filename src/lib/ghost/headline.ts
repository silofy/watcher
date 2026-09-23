import type { GhostItem, GhostVerdict } from "../../types/report";

export type GhostHeadline = { kind: "pivots"; count: number; total: number; unlockSeq: number; lastSeq: number } | { kind: "clean"; total: number };

export const VERDICT_ORDER: GhostVerdict[] = ["ahead", "off_path_win", "on_time", "late_pivot", "skipped"];

export const VERDICT: Record<GhostVerdict, { color: string; label: string }> = {
  ahead: { color: "var(--color-signal)", label: "Ahead" },
  off_path_win: { color: "var(--color-alt)", label: "Off-path win" },
  on_time: { color: "var(--color-muted)", label: "On time" },
  late_pivot: { color: "var(--color-loud)", label: "Late pivot" },
  skipped: { color: "var(--color-skipped)", label: "Skipped" },
};

/** The pattern, not one sentence per row: the largest group of late pivots sharing an unlock step. */
export function ghostHeadline(items: GhostItem[]): GhostHeadline {
  const late = items.filter((i) => i.verdict === "late_pivot" && i.unlock_seq != null);
  if (!late.length) return { kind: "clean", total: items.length };
  const groups = new Map<number, number>();
  for (const i of late) groups.set(i.unlock_seq!, (groups.get(i.unlock_seq!) ?? 0) + 1);
  let unlockSeq = -1;
  let count = 0;
  for (const [seq, n] of [...groups].sort((a, b) => a[0] - b[0])) {
    if (n > count) {
      unlockSeq = seq;
      count = n;
    }
  }
  const lastSeq = Math.max(...late.filter((i) => i.unlock_seq === unlockSeq).map((i) => i.actual_seq ?? 0));
  return { kind: "pivots", count, total: items.length, unlockSeq, lastSeq };
}

export function verdictCounts(items: GhostItem[]): Record<GhostVerdict, number> {
  const out: Record<GhostVerdict, number> = { ahead: 0, off_path_win: 0, on_time: 0, late_pivot: 0, skipped: 0 };
  for (const i of items) out[i.verdict]++;
  return out;
}

/** One plain line per objective, shown on hover/focus (a model narration replaces it when present). */
export function ghostDetail(it: GhostItem): string {
  switch (it.verdict) {
    case "late_pivot":
      return `Open from step ${it.unlock_seq}, done at step ${it.actual_seq}${it.lag_ms ? ` · ${Math.round(it.lag_ms / 60000)} min later` : ""}`;
    case "skipped":
      return `Open from step ${it.unlock_seq ?? "?"}, never attempted`;
    case "on_time":
      return `Done at step ${it.actual_seq}, as soon as it opened`;
    default:
      return `Done at step ${it.actual_seq}, before the optimal line expected it`;
  }
}
