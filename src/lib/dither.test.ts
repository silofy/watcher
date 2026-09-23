import { describe, it, expect } from "vitest";
import { ditherCells, ditherOn, ditherTile, ditherMask, ditherTrack, gradientDensity, DITHER } from "./dither";

describe("Bayer dither", () => {
  it("lights cells in threshold order", () => {
    expect(ditherCells(0)).toHaveLength(0);
    expect(ditherCells(0.28)).toHaveLength(4); // the sparse track
    expect(ditherCells(0.5)).toHaveLength(8);
    expect(ditherCells(0.9)).toHaveLength(14); // the dense value
    expect(ditherCells(1)).toHaveLength(16);
  });

  it("wraps rows and columns past the 4x4 matrix", () => {
    expect(ditherOn(0.5, 4, 4)).toBe(ditherOn(0.5, 0, 0));
  });

  it("encodes a 12px SVG tile with one 2px dot per lit cell", () => {
    const url = ditherTile(0.5, "#fff");
    expect(url.startsWith('url("data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(url.slice('url("data:image/svg+xml,'.length, -2));
    expect(svg).toContain("width='12'");
    expect(svg.match(/<rect /g)).toHaveLength(8);
    expect(svg).toContain("width='2' height='2'");
  });

  it("builds mask and track styles at the 12px tile size", () => {
    expect(ditherMask().maskSize).toBe("12px 12px");
    expect(ditherMask().WebkitMaskImage).toBe(ditherTile(DITHER.value));
    expect(ditherTrack().backgroundImage).toBe(ditherTile(DITHER.track, DITHER.trackColor));
  });

  it("interpolates a gradient from top to bottom", () => {
    expect(gradientDensity(0, 11, 0.9, 0.2)).toBeCloseTo(0.9);
    expect(gradientDensity(10, 11, 0.9, 0.2)).toBeCloseTo(0.2);
    expect(gradientDensity(5, 11, 0.9, 0.2)).toBeCloseTo(0.55);
    expect(gradientDensity(0, 1, 0.9, 0.2)).toBe(0.9);
  });
});
