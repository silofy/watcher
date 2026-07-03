import { describe, it, expect } from "vitest";
import { progressSeries, progressSummary, progressPath, type ProgressCard } from "./progress";

const card = (o: Partial<ProgressCard> & { id: string }): ProgressCard => ({
  ended_at: "2026-01-01T00:00:00Z", target: { platform: "htb", kind: "box", name: "X" },
  grade: 70, letter: "C", coverage: 50, breadth: 4, methodology: 60, rooted: false, demo: false, ...o,
});

describe("progressSeries", () => {
  it("returns non-demo points sorted by date ascending", () => {
    const pts = progressSeries([
      card({ id: "b", ended_at: "2026-02-01T00:00:00Z" }),
      card({ id: "a", ended_at: "2026-01-01T00:00:00Z" }),
      card({ id: "demo", demo: true }),
    ]);
    expect(pts.map((p) => p.id)).toEqual(["a", "b"]);
  });
  it("carries a null methodology through without NaN", () => {
    const pts = progressSeries([card({ id: "a", methodology: null }), card({ id: "b", ended_at: "2026-03-01T00:00:00Z" })]);
    expect(pts[0].methodology).toBeNull();
  });
});

describe("progressSummary", () => {
  it("computes runs, rooted rate, best/median grade, platforms", () => {
    const pts = progressSeries([
      card({ id: "a", grade: 60, rooted: true, target: { platform: "htb", kind: "box", name: "X" } }),
      card({ id: "b", ended_at: "2026-02-01T00:00:00Z", grade: 80, rooted: false, target: { platform: "thm", kind: "room", name: "Y" } }),
      card({ id: "c", ended_at: "2026-03-01T00:00:00Z", grade: 90, rooted: true, target: { platform: "htb", kind: "box", name: "Z" } }),
    ]);
    const s = progressSummary(pts);
    expect(s.runs).toBe(3);
    expect(s.bestGrade).toBe(90);
    expect(s.medianGrade).toBe(80);
    expect(Math.round(s.rootedRate)).toBe(67);
    expect(s.platforms.sort()).toEqual(["htb", "thm"]);
  });

  it("computes medianGrade as the rounded average of the two middle values (even count)", () => {
    const pts = progressSeries([
      card({ id: "a", grade: 60 }),
      card({ id: "b", ended_at: "2026-02-01T00:00:00Z", grade: 81 }),
      card({ id: "c", ended_at: "2026-03-01T00:00:00Z", grade: 90 }),
      card({ id: "d", ended_at: "2026-04-01T00:00:00Z", grade: 100 }),
    ]);
    const s = progressSummary(pts);
    expect(s.medianGrade).toBe(Math.round((81 + 90) / 2));
  });
});

describe("progressPath", () => {
  it("builds an SVG polyline path over the value range, skipping nulls", () => {
    const d = progressPath([0, 50, 100], 100, 20, 0, 100);
    expect(d.startsWith("M")).toBe(true);
    expect(d).toContain("L");
  });
  it("returns empty string for < 2 non-null values", () => {
    expect(progressPath([null, 5], 100, 20)).toBe("");
  });
  it("breaks the line at an internal null, producing two subpaths", () => {
    const d = progressPath([10, null, 30], 100, 20, 0, 100);
    expect((d.match(/M/g) || []).length).toBe(2);
  });
  it("keeps a contiguous run as a single subpath", () => {
    const d = progressPath([0, 50, 100], 100, 20, 0, 100);
    expect((d.match(/M/g) || []).length).toBe(1);
    expect(d).toContain("L");
  });
});
