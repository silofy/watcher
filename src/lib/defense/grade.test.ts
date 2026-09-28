import { describe, it, expect } from "vitest";
import { gradeDefense, letterFromScore } from "./grade";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = {
  target_scope: "x", entities: ["a.htb", "b.htb"],
  artifacts: [
    { id: "a1", label: "", phase: "execution", technique: "", indicators: [], entities: ["a.htb"], weight: 6, depends_on: [], source_seq: 1 },
    { id: "a2", label: "", phase: "privilege-escalation", technique: "", indicators: [], entities: ["b.htb"], weight: 4, depends_on: ["a1"], source_seq: 2 },
  ],
};

function res(over: Partial<InvestigationResult>): InvestigationResult {
  return { incident: inc, hits: [], advancing_seqs: [], noise_seqs: [], ...over };
}

describe("gradeDefense", () => {
  it("scores a full, in-order, clean investigation near the top", () => {
    const r = res({
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: true, found_by_seq: 2, found_at_ms: 1000, matched_indicator: "y" },
      ],
      advancing_seqs: [1, 2], noise_seqs: [],
    });
    const g = gradeDefense(r);
    expect(g.score).toBeGreaterThan(85);
    expect(g.metrics.find((m) => m.name === "Coverage")!.score).toBe(100);
    expect(g.metrics.reduce((s, m) => s + m.weight, 0)).toBeCloseTo(1, 5);
  });

  it("penalizes partial coverage, out-of-order finds, and noise", () => {
    const r = res({
      hits: [
        { artifact_id: "a1", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
        { artifact_id: "a2", found: true, found_by_seq: 5, found_at_ms: 9000, matched_indicator: "y" }, // found dependent before its prereq
      ],
      advancing_seqs: [5], noise_seqs: [1, 2, 3, 4],
    });
    const g = gradeDefense(r);
    expect(g.metrics.find((m) => m.name === "Coverage")!.score).toBeLessThan(60);
    expect(g.metrics.find((m) => m.name === "Reconstruction")!.score).toBeLessThan(100);
    expect(g.metrics.find((m) => m.name === "Discipline")!.score).toBeLessThan(50);
  });
});

describe("letterFromScore", () => {
  it("maps score bands to letters", () => {
    expect(letterFromScore(92)).toBe("A");
    expect(letterFromScore(83)).toBe("B");
    expect(letterFromScore(50)).toBe("F");
  });
});
