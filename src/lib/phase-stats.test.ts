import { describe, it, expect } from "vitest";
import { phaseStats, phaseLead } from "./phase-stats";
import { fmtDuration } from "./format";

const cov = (satisfied: number, total: number) => ({ satisfied, total, pct: total ? (satisfied / total) * 100 : 0 });

describe("phaseStats", () => {
  it("reports objectives reached and zero loss under the waste floor", () => {
    expect(phaseStats({ coverage: cov(9, 10), wasted_ms: 12_000 })).toEqual({ objectives: { reached: 9, total: 10 }, lost: "0m", lostIsZero: true });
  });

  it("formats real loss and omits objectives when there is no reference", () => {
    const s = phaseStats({ coverage: cov(0, 0), wasted_ms: 95_000 });
    expect(s.objectives).toBeNull();
    expect(s.lost).toBe(fmtDuration(95_000));
    expect(s.lostIsZero).toBe(false);
  });
});

describe("phaseLead", () => {
  it("counts phases at full efficiency", () => {
    expect(phaseLead([{ efficiency: 100 }, { efficiency: 100 }, { efficiency: 72 }])).toEqual({ full: 2, total: 3 });
  });
});
