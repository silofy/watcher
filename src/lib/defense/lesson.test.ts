import { describe, it, expect } from "vitest";
import { defenseLesson } from "./lesson";
import type { Incident, InvestigationResult } from "./types";

const inc: Incident = { target_scope: "x", entities: [], artifacts: [
  { id: "a1", label: "injection", phase: "execution", technique: "", indicators: [], entities: [], weight: 6, depends_on: [], source_seq: 7 },
  { id: "a2", label: "writable systemd drop-in", phase: "privilege-escalation", technique: "", indicators: [], entities: [], weight: 8, depends_on: [], source_seq: 25 },
]};

describe("defenseLesson", () => {
  it("names the highest-weight missed artifact, deep-linked to its source step", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [], noise_seqs: [],
      hits: [
        { artifact_id: "a1", found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" },
        { artifact_id: "a2", found: false, found_by_seq: null, found_at_ms: null, matched_indicator: null },
      ] };
    const l = defenseLesson(res)!;
    expect(l.text).toContain("writable systemd drop-in");
    expect(l.evidence_seq).toBe(25);
  });

  it("returns null when every artifact was found", () => {
    const res: InvestigationResult = { incident: inc, advancing_seqs: [], noise_seqs: [],
      hits: inc.artifacts.map((a) => ({ artifact_id: a.id, found: true, found_by_seq: 1, found_at_ms: 0, matched_indicator: "x" })) };
    expect(defenseLesson(res)).toBeNull();
  });
});
