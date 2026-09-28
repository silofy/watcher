import { describe, it, expect } from "vitest";
import { stripAiTells } from "./text-filter";

describe("stripAiTells", () => {
  it("replaces em, en, figure dashes and horizontal bar with a hyphen", () => {
    expect(stripAiTells("root — not user – yet ‒ ―")).toBe("root - not user - yet - -");
  });

  it("straightens curly quotes and expands the ellipsis glyph", () => {
    expect(stripAiTells("“done”… it’s fine")).toBe('"done"... it\'s fine');
  });

  it("collapses nbsp variants to a space and removes zero-width characters", () => {
    expect(stripAiTells("a b​c d")).toBe("a bc d");
  });

  it("leaves plain ASCII command output untouched", () => {
    const s = "$ nmap -p- 10.10.10.10  # scan\n22/tcp open ssh";
    expect(stripAiTells(s)).toBe(s);
  });
});
