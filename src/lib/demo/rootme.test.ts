import { describe, it, expect } from "vitest";
import { ROOTME } from "./rootme";

describe("THM RootMe demo", () => {
  it("grades to a real report on the thm platform", () => {
    expect(ROOTME.platform).toBe("thm");
    expect(ROOTME.report.episodes.length).toBeGreaterThan(5);
  });
  it("is redacted: no flag hash / THM{...} token", () => {
    const blob = ROOTME.raw.map((r) => `${r.cmd} ${r.output_digest ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(blob).not.toMatch(/THM\{[^}]+\}/);
  });
});
