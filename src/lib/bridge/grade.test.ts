import { describe, it, expect } from "vitest";
import fixture from "../../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../../types/report";
import { computeGrade, RUBRIC, RUBRIC_V1, RUBRIC_V2, INDEPENDENCE_GATE } from "./grade";

const report = fixture as unknown as WatcherReport;

describe("v1 rubric (frozen — reports with no methodology signal)", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(RUBRIC).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("RUBRIC is an alias for RUBRIC_V1", () => {
    expect(RUBRIC).toBe(RUBRIC_V1);
  });

  it("a report with no methodology_coverage_pct grades as version 1, with exactly the six v1 components", () => {
    expect(report.metrics.methodology_coverage_pct).toBeUndefined();
    const g = computeGrade(report);
    expect(g.version).toBe(1);
    expect(Object.keys(g.components).sort()).toEqual(["breadth", "coverage", "discipline", "efficiency", "independence", "progression"]);
    expect(g.components.methodology).toBeUndefined();
    expect(g.components.focus).toBeUndefined();
  });

  it("produces an explainable weighted score matching a hand-computed v1 total (history frozen)", () => {
    const g = computeGrade(report);
    // hand-computed against RUBRIC_V1 from the fixture's stored metrics: coverage 92, breadth 11/12,
    // efficiency 53, progression 100 (unset), discipline 53, independence 78 — this is the pre-existing
    // v1 baseline and must not move. 78.95 rounds to 79.0 — pin the exact rounded value (not
    // toBeCloseTo) so drift can't slip through right on the rounding seam.
    const expected =
      92 * RUBRIC_V1.coverage +
      (11 / 12) * 100 * RUBRIC_V1.breadth +
      53 * RUBRIC_V1.efficiency +
      100 * RUBRIC_V1.progression +
      53 * RUBRIC_V1.discipline +
      78 * RUBRIC_V1.independence;
    expect(expected).toBeCloseTo(78.95, 2);
    expect(g.score).toBe(79);
    expect(g.letter).toBe("C");
    const recombined = Object.values(g.components).reduce((a, c) => a + c!.weighted, 0);
    expect(Math.abs(g.score - recombined)).toBeLessThanOrEqual(0.5);
    expect(g.score).toBeGreaterThanOrEqual(0);
    expect(g.score).toBeLessThanOrEqual(100);
  });

  it("scores UKC progression as its own dimension", () => {
    const cloned = structuredClone(report);
    cloned.metrics.ukc_progression = 40;
    const g = computeGrade(cloned);
    expect(g.version).toBe(1);
    expect(g.components.progression!.raw).toBe(40);
    expect(g.components.progression!.weight).toBeCloseTo(0.1, 9);
  });

  it("treats a legacy report without ukc_progression as full progression", () => {
    const cloned = structuredClone(report);
    delete cloned.metrics.ukc_progression;
    expect(computeGrade(cloned).components.progression!.raw).toBe(100);
  });

  it("normalizes technique breadth against the target", () => {
    // fixture breadth = 11 techniques, target 12 -> ~91.7
    expect(computeGrade(report).components.breadth!.raw).toBeCloseTo((11 / 12) * 100, 0);
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
    expect(g.components.independence!.weight).toBe(0);
    const activeWeight = (["coverage", "breadth", "efficiency", "progression", "discipline"] as const).reduce(
      (a, k) => a + g.components[k]!.weight,
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

describe("v2 rubric (candidate C — reports carrying the methodology signal)", () => {
  it("weights sum to 1.0", () => {
    const sum = Object.values(RUBRIC_V2).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 9);
  });

  it("a report with methodology_coverage_pct and focus_discipline_pct grades as version 2, with all eight components", () => {
    const withAnalysis: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 80, focus_discipline_pct: 90 },
    };
    const g = computeGrade(withAnalysis);
    expect(g.version).toBe(2);
    expect(Object.keys(g.components).sort()).toEqual([
      "breadth",
      "coverage",
      "discipline",
      "efficiency",
      "focus",
      "independence",
      "methodology",
      "progression",
    ]);
  });

  it("matches a hand-computed candidate-C weighted sum", () => {
    const withAnalysis: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 80, focus_discipline_pct: 90 },
    };
    const g = computeGrade(withAnalysis);
    // fixture raws: coverage 92, breadth 11/12*100, efficiency 53, progression 100 (unset), discipline
    // 53, independence 78 (measured — full weight, no renormalization), methodology 80, focus 90.
    const expected =
      92 * RUBRIC_V2.coverage +
      (11 / 12) * 100 * RUBRIC_V2.breadth +
      53 * RUBRIC_V2.efficiency +
      100 * RUBRIC_V2.progression +
      53 * RUBRIC_V2.discipline +
      78 * RUBRIC_V2.independence +
      80 * RUBRIC_V2.methodology +
      90 * RUBRIC_V2.focus;
    expect(g.score).toBeCloseTo(expected, 1);
    expect(g.score).toBeCloseTo(81.2, 1);
    expect(g.letter).toBe("B");
  });

  it("a report with methodology_coverage_pct = 0 still grades as version 2 (0 is a legit measured value, not absence)", () => {
    const zeroMethodology: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 0, focus_discipline_pct: 90 },
    };
    const g = computeGrade(zeroMethodology);
    expect(g.version).toBe(2);
    expect(g.components.methodology).not.toBeUndefined();
  });

  it("discriminates on methodology — a higher methodology score scores higher, all else equal", () => {
    const low: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 30, focus_discipline_pct: 90 },
    };
    const high: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 95, focus_discipline_pct: 90 },
    };
    const gLow = computeGrade(low);
    const gHigh = computeGrade(high);
    expect(gLow.version).toBe(2);
    expect(gHigh.version).toBe(2);
    expect(gHigh.score).toBeGreaterThan(gLow.score);
  });

  it("independence gate still routes low independence to the integrity queue under v2", () => {
    const withAnalysis: WatcherReport = {
      ...report,
      metrics: { ...report.metrics, methodology_coverage_pct: 80, focus_discipline_pct: 90, independence: { ...report.metrics.independence!, score: 20 } },
    };
    const g = computeGrade(withAnalysis);
    expect(g.version).toBe(2);
    expect(g.independence_gate.flagged).toBe(true);
    expect(g.routed_to).toBe("integrity_queue");
  });

  it("unmeasured independence re-normalizes the remaining seven weights under v2", () => {
    const cloned = structuredClone(report);
    (cloned.metrics as { methodology_coverage_pct?: number }).methodology_coverage_pct = 80;
    (cloned.metrics as { focus_discipline_pct?: number }).focus_discipline_pct = 90;
    delete cloned.metrics.independence;
    const g = computeGrade(cloned);
    expect(g.version).toBe(2);
    expect(g.independence_gate.measured).toBe(false);
    expect(g.independence_gate.flagged).toBe(false);
    expect(g.components.independence!.weight).toBe(0);
    const activeWeight = (["coverage", "breadth", "efficiency", "progression", "discipline", "methodology", "focus"] as const).reduce(
      (a, k) => a + g.components[k]!.weight,
      0,
    );
    expect(activeWeight).toBeCloseTo(1, 9);
  });
});
