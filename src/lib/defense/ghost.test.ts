import { describe, it, expect } from "vitest";
import { investigationGhost } from "./ghost";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = { target_scope: "x", entities: [], artifacts: [
  { id: "a1", label: "injection", phase: "execution", technique: "", indicators: [], entities: [], weight: 6, depends_on: [], source_seq: 7 },
  { id: "a2", label: "persistence", phase: "privilege-escalation", technique: "", indicators: [], entities: [], weight: 5, depends_on: ["a1"], source_seq: 25 },
]};

describe("investigationGhost", () => {
  it("emits a GhostResult with one item per artifact, missed ones marked skipped", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [1], noise_seqs: [],
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
      ] };
    const g = investigationGhost(res);
    expect(g.items).toHaveLength(2);
    expect(g.items.find((i) => i.objective === "persistence")!.verdict).toBe("skipped");
    expect(typeof g.time_lost_ms).toBe("number");
  });

  it("returns items in ascending source_seq order regardless of input artifact order", () => {
    const descInc: Incident = { target_scope: "x", entities: [], artifacts: [
      { id: "a2", label: "persistence", phase: "privilege-escalation", technique: "", indicators: [], entities: [], weight: 5, depends_on: [], source_seq: 25 },
      { id: "a1", label: "injection", phase: "execution", technique: "", indicators: [], entities: [], weight: 6, depends_on: [], source_seq: 7 },
    ]};
    const res: InvestigationResult = { incident: descInc, advancing_seqs: [], noise_seqs: [],
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: true, found_by_seq: 2, found_at_ms: 0, matched_indicator: "x" },
      ] };
    const g = investigationGhost(res);
    expect(g.items[0].unlock_seq).toBe(7);
    expect(g.items[1].unlock_seq).toBe(25);
  });
});
