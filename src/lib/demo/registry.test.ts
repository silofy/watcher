import { describe, it, expect } from "vitest";
import { DEMOS, demoById, isDemoId } from "./registry";

describe("demo registry", () => {
  it("holds at least one demo, each with a graded report and stable id", () => {
    expect(DEMOS.length).toBeGreaterThanOrEqual(1);
    for (const d of DEMOS) {
      expect(d.id).toContain(":");
      expect(d.raw.length).toBeGreaterThan(0);
      expect(d.report.episodes.length).toBeGreaterThan(0);
      expect(demoById(d.id)).toBe(d);
      expect(isDemoId(d.id)).toBe(true);
    }
    expect(isDemoId("not-a-demo")).toBe(false);
  });
});
