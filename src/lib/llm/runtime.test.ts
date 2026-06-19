import { describe, it, expect, vi, afterEach } from "vitest";
import { describeStatus, llmStatus } from "./runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("describeStatus", () => {
  it("labels availability", () => {
    expect(describeStatus({ available: true, runtime: "ollama", version: "0.5.1" })).toBe("LLM · ollama 0.5.1");
    expect(describeStatus({ available: false, runtime: "rules-only" })).toBe("LLM · rules-only");
  });
});

describe("llmStatus (browser/dev path — no Tauri)", () => {
  it("reports ollama when the local server responds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true }));
    expect(await llmStatus()).toMatchObject({ available: true, runtime: "ollama" });
  });

  it("falls back to rules-only when Ollama is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await llmStatus()).toEqual({ available: false, runtime: "rules-only" });
  });
});
