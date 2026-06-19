import { describe, it, expect } from "vitest";
import fixture from "../../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../../types/report";
import { computeGrade, RUBRIC, INDEPENDENCE_GATE } from "./grade";

const report = fixture as unknown as WatcherReport;

describe("grading rubric (§6.4)", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(RUBRIC).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("produces an explainable weighted score with all five components", () => {
    const g = computeGrade(report);
    expect(Object.keys(g.components).sort()).toEqual(["breadth", "coverage", "discipline", "efficiency", "independence"]);
    const recombined = Object.values(g.components).reduce((a, c) => a + c.weighted, 0);
    // score rounds the total; recombined sums per-component rounded weights — within rounding
    expect(Math.abs(g.score - recombined)).toBeLessThanOrEqual(0.5);
    expect(g.score).toBeGreaterThanOrEqual(0);
    expect(g.score).toBeLessThanOrEqual(100);
  });

  it("normalizes technique breadth against the target", () => {
    // fixture breadth = 11 techniques, target 12 -> ~91.7
    expect(computeGrade(report).components.breadth.raw).toBeCloseTo((11 / 12) * 100, 0);
  });

  it("does not flag the fixture (independence 78 > gate)", () => {
    const g = computeGrade(report);
    expect(g.independence_gate.flagged).toBe(false);
    expect(g.routed_to).toBe("grade");
  });

  it("routes low independence to the integrity queue (a gate, not an average)", () => {
    const cloned = structuredClone(report);
    cloned.metrics.independence!.score = 20; // below the gate
    const g = computeGrade(cloned);
    expect(g.independence_gate.flagged).toBe(true);
    expect(g.routed_to).toBe("integrity_queue");
    expect(g.rationale.join(" ")).toContain("integrity queue");
    expect(INDEPENDENCE_GATE).toBe(40);
  });
});
