/** Pure view-layer helpers for the ghost UI (the "You vs. the Ghost" card + timeline overlay) — no
 *  React, so the color/label vocabulary and the seq→axis projection are unit-testable in isolation. */
import type { GhostItem, GhostVerdict } from "../../types/report";
import type { Timeline } from "../scale";

export interface VerdictMeta {
  /** Short chip label. */
  label: string;
  /** CSS color (a theme token) for the chip. */
  tone: string;
  /** Ahead / off-path-win — the human beat the optimal line. */
  win: boolean;
}

const VERDICT_META: Record<GhostVerdict, VerdictMeta> = {
  ahead: { label: "Ahead of the line", tone: "var(--color-match)", win: true },
  off_path_win: { label: "Off-path win", tone: "var(--color-flag)", win: true },
  late_pivot: { label: "Late pivot", tone: "var(--color-detour)", win: false },
  skipped: { label: "Skipped", tone: "var(--color-skipped)", win: false },
  on_time: { label: "On time", tone: "var(--color-faint)", win: false },
};

/** verdict → { label, tone, win } — the single color/label vocabulary shared by the card and the
 *  timeline overlay, so the two views never drift. */
export function verdictMeta(verdict: GhostVerdict): VerdictMeta {
  return VERDICT_META[verdict];
}

/** verdict → connector `<title>` text, or null when no connector should be drawn at all.
 *  The connector line runs between the unlock dot and the actual dot, so its wording must respect
 *  which dot comes first: `late_pivot` unlocks-then-acts (time lost), while the two win verdicts
 *  (`ahead`, `off_path_win`) have the human acting before/around the optimal line — the opposite
 *  direction. `on_time`/`skipped` never draw a connector (see AttackTimeline's guard: both seqs must
 *  resolve AND differ, on top of this returning non-null). */
export function connectorLabel(verdict: GhostVerdict): string | null {
  switch (verdict) {
    case "late_pivot":
      return "Unlocked earlier — you acted on it later.";
    case "ahead":
      return "You acted before the optimal line unlocked it — ahead.";
    case "off_path_win":
      return "Reached via your own route — off the intended path.";
    case "on_time":
    case "skipped":
      return null;
  }
}

export interface GhostMarker {
  objective: string;
  verdict: GhostVerdict;
  /** ms position (on the shared time axis) of the unlock instant, or null if unknown. */
  unlockMs: number | null;
  /** ms position of the actual instant, or null if never done. */
  actualMs: number | null;
}

/** Project each ghost item's unlock_seq / actual_seq onto the shared time axis via the timeline's
 *  seq→t0 index, so the overlay can draw a marker/connector without recomputing episode timing.
 *  Items with neither seq resolved (both null/unknown) are dropped — nothing to draw. */
export function ghostMarkers(items: GhostItem[], timeline: Pick<Timeline, "bySeq">): GhostMarker[] {
  const at = (seq?: number | null): number | null => (seq == null ? null : timeline.bySeq.get(seq)?.t0 ?? null);
  return items
    .map((i) => ({ objective: i.objective, verdict: i.verdict, unlockMs: at(i.unlock_seq), actualMs: at(i.actual_seq) }))
    .filter((m) => m.unlockMs != null || m.actualMs != null);
}
