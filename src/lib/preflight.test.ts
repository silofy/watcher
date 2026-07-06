import { describe, it, expect } from "vitest";
import { preflightMessage } from "./preflight";

describe("preflightMessage", () => {
  it("unreachable Burp explains the fix", () => {
    const m = preflightMessage("unreachable", { port: 9876 });
    expect(m).toContain("9876");
    expect(m).toContain("MCP Server extension");
    expect(m).toContain("docs/web-capture.md");
  });
  it("empty scope warns without failing", () => {
    expect(preflightMessage("empty_scope")).toContain("ingest all proxied traffic");
  });
  it("detected nudges with the flag", () => {
    expect(preflightMessage("detected")).toContain("--web");
  });
});
