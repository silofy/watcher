import { describe, it, expect } from "vitest";
import { draftReport } from "./draft";
import demo from "../../../fixtures/session-demo-full.json";
import type { WatcherReport } from "../../types/report";

describe("export smoke", () => {
  it("produces a non-empty markdown report with a header and findings", () => {
    const md = draftReport(demo as unknown as WatcherReport);
    expect(md.length).toBeGreaterThan(200);
    expect(md).toMatch(/^# Abducted/m);
    expect(md).toContain("## Findings");
  });
});
