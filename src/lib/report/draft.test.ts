import { describe, it, expect } from "vitest";
import { draftReport } from "./draft";
import { deriveReportFindings } from "./findings";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

const report = demo as unknown as WatcherReport;

describe("draftReport", () => {
  const md = draftReport(report);

  it("contains every top-level section in order", () => {
    const heads = (md.match(/^## .+$/gm) || []).map((h) => h.replace(/^## /, ""));
    expect(heads).toEqual(["Executive summary", "Scope", "Methodology", "Findings", "Walkthrough", "Appendix"]);
    expect(md).toMatch(/^# Abducted/m);
  });

  it("has one findings entry per derived finding", () => {
    const n = deriveReportFindings(report).length;
    expect((md.match(/^### \d+\. /gm) || []).length).toBe(n);
  });

  it("is deterministic and leaks no raw flag", () => {
    expect(draftReport(report)).toBe(md);
    expect(md).not.toMatch(/HTB\{[^}]/);
  });

  it("honors an injected summary and findings override", () => {
    const md2 = draftReport(report, { summary: "CUSTOM SUMMARY LINE." });
    expect(md2).toContain("CUSTOM SUMMARY LINE.");
  });
});
