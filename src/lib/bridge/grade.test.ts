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

  it("produces an explainable weighted score with all six components", () => {
    const g = computeGrade(report);
    expect(Object.keys(g.components).sort()).toEqual(["breadth", "coverage", "discipline", "efficiency", "independence", "progression"]);
    const recombined = Object.values(g.components).reduce((a, c) => a + c.weighted, 0);
    // score rounds the total; recombined sums per-component rounded weights — within rounding
    expect(Math.abs(g.score - recombined)).toBeLessThanOrEqual(0.5);
    expect(g.score).toBeGreaterThanOrEqual(0);
    expect(g.score).toBeLessThanOrEqual(100);
  });

  it("scores UKC progression as its own dimension", () => {
    const cloned = structuredClone(report);
    cloned.metrics.ukc_progression = 40;
    const g = computeGrade(cloned);
    expect(g.components.progression.raw).toBe(40);
    expect(g.components.progression.weight).toBeCloseTo(0.1, 9);
  });

  it("treats a legacy report without ukc_progression as full progression", () => {
    const cloned = structuredClone(report);
    delete cloned.metrics.ukc_progression;
    expect(computeGrade(cloned).components.progression.raw).toBe(100);
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

  it("excludes independence from the rubric when it was never measured — no false integrity flag", () => {
    const cloned = structuredClone(report);
    delete cloned.metrics.independence;
    const g = computeGrade(cloned);
    expect(g.independence_gate.measured).toBe(false);
    expect(g.independence_gate.flagged).toBe(false);
    expect(g.routed_to).toBe("grade");
    // the missing dimension carries zero weight; the remaining five re-normalize to 1.0 so the run
    // isn't silently docked 15 points
    expect(g.components.independence.weight).toBe(0);
    const activeWeight = (["coverage", "breadth", "efficiency", "progression", "discipline"] as const).reduce(
      (a, k) => a + g.components[k].weight,
      0,
    );
    expect(activeWeight).toBeCloseTo(1, 9);
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
