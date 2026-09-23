import { describe, it, expect } from "vitest";
import { ghostHeadline, verdictCounts, ghostDetail } from "./headline";
import type { GhostItem } from "../../types/report";

const late = (objective: string, unlock_seq: number, actual_seq: number, lag_ms = 0): GhostItem => ({ objective, verdict: "late_pivot", unlock_seq, actual_seq, lag_ms });

describe("ghostHeadline", () => {
  it("names the largest group of late pivots and where it ended", () => {
    const items: GhostItem[] = [
      { objective: "a", verdict: "ahead", unlock_seq: 1, actual_seq: 1 },
      late("b", 1, 5),
      late("c", 5, 11),
      late("d", 5, 13),
      late("e", 5, 30),
      { objective: "f", verdict: "skipped", unlock_seq: 1, actual_seq: null },
    ];
    expect(ghostHeadline(items)).toEqual({ kind: "pivots", count: 3, total: 6, unlockSeq: 5, lastSeq: 30 });
  });

  it("breaks ties toward the earliest unlock", () => {
    expect(ghostHeadline([late("x", 9, 12), late("y", 4, 6)])).toMatchObject({ unlockSeq: 4, lastSeq: 6 });
  });

  it("reports a clean run when nothing pivoted late", () => {
    expect(ghostHeadline([{ objective: "a", verdict: "on_time", unlock_seq: 1, actual_seq: 2 }])).toEqual({ kind: "clean", total: 1 });
  });
});

describe("verdictCounts / ghostDetail", () => {
  it("counts every verdict", () => {
    expect(verdictCounts([late("b", 1, 5), late("c", 5, 11)]).late_pivot).toBe(2);
  });

  it("describes each verdict in one plain line", () => {
    expect(ghostDetail(late("b", 5, 20, 540_000))).toBe("Open from step 5, done at step 20 · 9 min later");
    expect(ghostDetail({ objective: "f", verdict: "skipped", unlock_seq: 1, actual_seq: null })).toBe("Open from step 1, never attempted");
    expect(ghostDetail({ objective: "o", verdict: "on_time", unlock_seq: 3, actual_seq: 4 })).toBe("Done at step 4, as soon as it opened");
  });
});
