import { describe, it, expect } from "vitest";
import { narrateReport } from "./narrate";
import { draftReport } from "./draft";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";
import type { LlmProvider } from "../llm/provider";

const report = demo as unknown as WatcherReport;
const nullProvider: LlmProvider = { name: "test-null", async available() { return false; }, async generateJson() { return null; } };

describe("narrateReport", () => {
  it("with an unavailable provider, returns deterministic findings and no summary", async () => {
    const out = await narrateReport(report, nullProvider);
    expect(out.summary).toBeUndefined();
    expect(out.findings).toEqual(deriveReportFindings(report));
    // draft is unchanged vs the fully deterministic draft
    expect(draftReport(report, out)).toBe(draftReport(report));
  });

  it("with a stub provider, only prose fields change", async () => {
    const stub: LlmProvider = {
      name: "test-stub",
      async available() { return true; },
      async generateJson() { return { summary: "POLISHED SUMMARY", descriptions: {} }; },
    };
    const out = await narrateReport(report, stub);
    expect(out.summary).toBe("POLISHED SUMMARY");
    // structural fields (id/severity/evidence) untouched
    expect(out.findings.map((f) => f.id)).toEqual(deriveReportFindings(report).map((f) => f.id));
    expect(out.findings.map((f) => f.severity)).toEqual(deriveReportFindings(report).map((f) => f.severity));
  });
});
