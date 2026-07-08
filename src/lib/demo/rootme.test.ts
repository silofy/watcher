import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ROOTME } from "./rootme";

describe("THM RootMe demo", () => {
  it("grades to a real report on the thm platform", () => {
    expect(ROOTME.platform).toBe("thm");
    expect(ROOTME.report.episodes.length).toBeGreaterThan(5);
    // the chain reaches privilege escalation
    expect(ROOTME.report.phases.some((p) => p.mitre_tactic === "TA0004")).toBe(true);
  });
  it("is redacted: no flag hash / THM{...} token", () => {
    const blob = ROOTME.raw.map((r) => `${r.cmd} ${r.output_digest ?? ""}`).join("\n");
    expect(blob).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(blob).not.toMatch(/THM\{[^}]+\}/);
  });
  it("is redacted in the source file itself, not just the streamed raw (header comments included)", () => {
    const src = readFileSync(new URL("./rootme.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/\b[0-9a-f]{32}\b/i);
    expect(src).not.toMatch(/THM\{[^}]+\}/);
  });
  it("renders as a TryHackMe target with its real room icon", () => {
    const t = ROOTME.report.session.target;
    expect(t?.platform).toBe("thm");
    expect(t?.emblem?.avatar).toContain("tryhackme-images");
  });
});
