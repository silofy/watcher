import { describe, it, expect } from "vitest";
import { extractJson, CLOUD_DEFAULT_MODEL } from "./cloud";

describe("extractJson", () => {
  it("returns a bare JSON object unchanged", () => {
    expect(extractJson('{"a":1}')).toBe('{"a":1}');
  });
  it("unwraps a ```json fenced block", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });
  it("pulls the object out of surrounding prose", () => {
    expect(extractJson('Here is the result: {"a":1} — hope that helps')).toBe('{"a":1}');
  });
});

describe("CLOUD_DEFAULT_MODEL", () => {
  it("defaults Claude to the current Opus model", () => {
    expect(CLOUD_DEFAULT_MODEL.anthropic).toBe("claude-opus-4-8");
  });
});
