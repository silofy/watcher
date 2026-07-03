import { describe, it, expect } from "vitest";
import { verdictMeta, ghostMarkers, connectorLabel, refinedNotes, type GhostMarker } from "./ghost-view";
import type { GhostDiffItem, GhostResult } from "./ghost";
import type { GhostItem } from "../../types/report";
import type { Timeline, TimedEpisode } from "../scale";

describe("verdictMeta", () => {
  it("marks ahead and off_path_win as human wins, tinted match/flag", () => {
    expect(verdictMeta("ahead")).toEqual({ label: "Ahead of the line", tone: "var(--color-match)", win: true });
    expect(verdictMeta("off_path_win").win).toBe(true);
    expect(verdictMeta("off_path_win").tone).toBe("var(--color-flag)");
  });

  it("marks late_pivot and skipped as non-wins, tinted detour/skipped", () => {
    expect(verdictMeta("late_pivot")).toEqual({ label: "Late pivot", tone: "var(--color-detour)", win: false });
    expect(verdictMeta("skipped")).toEqual({ label: "Skipped", tone: "var(--color-skipped)", win: false });
  });

  it("marks on_time as a non-win, muted", () => {
    const m = verdictMeta("on_time");
    expect(m.win).toBe(false);
    expect(m.tone).toBe("var(--color-faint)");
  });

  it("is a total function over every GhostVerdict — no fallthrough gaps", () => {
    const verdicts: GhostItem["verdict"][] = ["on_time", "late_pivot", "skipped", "ahead", "off_path_win"];
    for (const v of verdicts) {
      const m = verdictMeta(v);
      expect(m.label.length).toBeGreaterThan(0);
      expect(m.tone).toMatch(/^var\(--color-/);
    }
  });
});

describe("connectorLabel", () => {
  it("frames ahead as a win — the human acted before the optimal line unlocked it", () => {
    const label = connectorLabel("ahead");
    expect(label).not.toBeNull();
    expect(label).not.toMatch(/later/);
    expect(label).not.toMatch(/then acted on later/);
  });

  it("frames off_path_win as a win — reached via the human's own route", () => {
    const label = connectorLabel("off_path_win");
    expect(label).not.toBeNull();
    expect(label).not.toMatch(/later/);
    expect(label).not.toMatch(/then acted on later/);
  });

  it("frames late_pivot as time lost — unlocked earlier, acted on later", () => {
    expect(connectorLabel("late_pivot")).toMatch(/later/);
  });

  it("draws no connector for on_time or skipped", () => {
    expect(connectorLabel("on_time")).toBeNull();
    expect(connectorLabel("skipped")).toBeNull();
  });
});

function diffItem(objective: string, note: string): GhostDiffItem {
  return { objective, verdict: "on_time", unlock_seq: 0, actual_seq: 0, lag_ms: 0, note };
}

describe("refinedNotes", () => {
  it("returns an empty map when narrated is the same reference as base (no-model default)", () => {
    const base: GhostResult = { time_lost_ms: 0, human_wins: 0, items: [diffItem("enumerate_smb", "deterministic note")] };
    expect(refinedNotes(base, base)).toEqual(new Map());
  });

  it("returns an empty map when narrated notes are identical to the deterministic ones", () => {
    const base: GhostResult = { time_lost_ms: 0, human_wins: 0, items: [diffItem("enumerate_smb", "deterministic note")] };
    const narrated: GhostResult = { ...base, items: [diffItem("enumerate_smb", "deterministic note")] };
    expect(refinedNotes(base, narrated)).toEqual(new Map());
  });

  it("includes only the item whose note the model actually changed", () => {
    const base: GhostResult = {
      time_lost_ms: 0,
      human_wins: 0,
      items: [diffItem("enumerate_smb", "deterministic a"), diffItem("exploit_web", "deterministic b")],
    };
    const narrated: GhostResult = {
      ...base,
      items: [diffItem("enumerate_smb", "sharpened a"), diffItem("exploit_web", "deterministic b")],
    };
    expect(refinedNotes(base, narrated)).toEqual(new Map([["enumerate_smb", "sharpened a"]]));
  });

  it("excludes an item whose narrated note is empty — the deterministic note stands", () => {
    const base: GhostResult = { time_lost_ms: 0, human_wins: 0, items: [diffItem("enumerate_smb", "deterministic note")] };
    const narrated: GhostResult = { ...base, items: [diffItem("enumerate_smb", "")] };
    expect(refinedNotes(base, narrated)).toEqual(new Map());
  });
});

function timelineOf(seqToT0: Record<number, number>): Pick<Timeline, "bySeq"> {
  return { bySeq: new Map(Object.entries(seqToT0).map(([seq, t0]) => [Number(seq), { t0 } as TimedEpisode])) };
}

describe("ghostMarkers", () => {
  const timeline = timelineOf({ 0: 0, 1: 500, 5: 4200 });

  it("projects unlock_seq and actual_seq onto ms via the timeline's t0 index", () => {
    const items: GhostItem[] = [{ objective: "enumerate_smb", verdict: "late_pivot", unlock_seq: 0, actual_seq: 5, lag_ms: 4200, note: "" }];
    const markers = ghostMarkers(items, timeline);
    expect(markers).toEqual<GhostMarker[]>([{ objective: "enumerate_smb", verdict: "late_pivot", unlockMs: 0, actualMs: 4200 }]);
  });

  it("leaves a side null when its seq is absent (skipped: no actual_seq)", () => {
    const items: GhostItem[] = [{ objective: "exploit_web", verdict: "skipped", unlock_seq: 1, actual_seq: null, lag_ms: 0, note: "" }];
    const markers = ghostMarkers(items, timeline);
    expect(markers).toEqual<GhostMarker[]>([{ objective: "exploit_web", verdict: "skipped", unlockMs: 500, actualMs: null }]);
  });

  it("drops items whose seqs don't resolve on this timeline (nothing to draw)", () => {
    const items: GhostItem[] = [{ objective: "ghost_obj", verdict: "on_time", unlock_seq: null, actual_seq: null, lag_ms: 0, note: "" }];
    expect(ghostMarkers(items, timeline)).toEqual([]);
  });

  it("resolves a seq not present in bySeq to null rather than throwing", () => {
    const items: GhostItem[] = [{ objective: "x", verdict: "ahead", unlock_seq: 99, actual_seq: 1, lag_ms: 0, note: "" }];
    const markers = ghostMarkers(items, timeline);
    expect(markers[0]).toEqual({ objective: "x", verdict: "ahead", unlockMs: null, actualMs: 500 });
  });
});
