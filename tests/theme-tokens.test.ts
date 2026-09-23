import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { ACTOR_COLORS, ALIGNMENT_COLORS, DETOUR_COLOR } from "../src/lib/scale";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");
const token = (name: string): string => {
  const m = css.match(new RegExp(`--color-${name}:\\s*([^;]+);`));
  if (!m) throw new Error(`missing --color-${name}`);
  return m[1].trim();
};
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("editorial-dark tokens", () => {
  it("uses the neutral-black ground and the mint signal", () => {
    expect(token("ink")).toBe("#0b0b0c");
    expect(token("signal")).toBe("#2fe6b0");
  });

  it("keeps eyebrow (faint) and secondary (muted) text at >= 4.5:1 on the ground", () => {
    expect(contrast(token("faint"), token("ink"))).toBeGreaterThanOrEqual(4.5);
    expect(contrast(token("muted"), token("ink"))).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps scale.ts's SVG legend in sync with the CSS tokens", () => {
    expect(ACTOR_COLORS.machine_bound).toBe(token("tool"));
    expect(ACTOR_COLORS.human_active).toBe(token("manual"));
    expect(ALIGNMENT_COLORS.match).toBe(token("match"));
    expect(ALIGNMENT_COLORS.alternative).toBe(token("alt"));
    expect(DETOUR_COLOR).toBe(token("detour"));
  });

  it("drops Saira and flattens radii to 3px", () => {
    expect(css).not.toMatch(/Saira/);
    expect(css).toMatch(/--radius-lg:\s*3px/);
  });
});
