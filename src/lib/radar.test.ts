import { describe, it, expect } from "vitest";
import { radarPoint, RADAR_GEOMETRY } from "./radar";

const { cx, cy, r } = RADAR_GEOMETRY;

describe("radarPoint", () => {
  it("frac=0 is always the center, regardless of axis index or axis count", () => {
    for (const n of [6, 8]) {
      for (let i = 0; i < n; i++) {
        expect(radarPoint(i, 0, n)).toEqual([cx, cy]);
      }
    }
  });

  it("axis 0 always points straight up, for any axis count", () => {
    for (const n of [6, 8]) {
      const [x, y] = radarPoint(0, 1, n);
      expect(x).toBeCloseTo(cx, 9);
      expect(y).toBeCloseTo(cy - r, 9);
    }
  });

  it("n=6: opposite axis (i=3) points straight down", () => {
    const [x, y] = radarPoint(3, 1, 6);
    expect(x).toBeCloseTo(cx, 9);
    expect(y).toBeCloseTo(cy + r, 9);
  });

  it("n=8: opposite axis (i=4) points straight down", () => {
    const [x, y] = radarPoint(4, 1, 8);
    expect(x).toBeCloseTo(cx, 9);
    expect(y).toBeCloseTo(cy + r, 9);
  });

  // wraps a raw angle delta into (-π, π] so it's comparable regardless of how atan2 folded it
  const wrap = (delta: number) => delta - 2 * Math.PI * Math.round(delta / (2 * Math.PI));

  it("n=6: axes are evenly spaced 60 degrees apart", () => {
    const angleOf = (i: number, n: number) => {
      const [x, y] = radarPoint(i, 1, n);
      return Math.atan2(y - cy, x - cx);
    };
    for (let i = 0; i < 6; i++) {
      const delta = angleOf((i + 1) % 6, 6) - angleOf(i, 6);
      expect(Math.abs(wrap(delta))).toBeCloseTo((2 * Math.PI) / 6, 9);
    }
  });

  it("n=8: axes are evenly spaced 45 degrees apart", () => {
    const angleOf = (i: number, n: number) => {
      const [x, y] = radarPoint(i, 1, n);
      return Math.atan2(y - cy, x - cx);
    };
    for (let i = 0; i < 8; i++) {
      const delta = angleOf((i + 1) % 8, 8) - angleOf(i, 8);
      expect(Math.abs(wrap(delta))).toBeCloseTo((2 * Math.PI) / 8, 9);
    }
  });

  it("scales linearly with frac, holding angle fixed", () => {
    const [x1, y1] = radarPoint(2, 0.5, 8);
    const [xFull, yFull] = radarPoint(2, 1, 8);
    expect(x1).toBeCloseTo(cx + (xFull - cx) * 0.5, 9);
    expect(y1).toBeCloseTo(cy + (yFull - cy) * 0.5, 9);
  });

  it("respects a custom geometry (different center/radius) independent of axis count", () => {
    const geo = { cx: 0, cy: 0, r: 10 };
    const [x, y] = radarPoint(0, 1, 8, geo);
    expect(x).toBeCloseTo(0, 9);
    expect(y).toBeCloseTo(-10, 9);
  });

  it("produces n distinct points at frac=1 for both 6 and 8 axes", () => {
    for (const n of [6, 8]) {
      const pts = Array.from({ length: n }, (_, i) => radarPoint(i, 1, n).join(","));
      expect(new Set(pts).size).toBe(n);
    }
  });
});
