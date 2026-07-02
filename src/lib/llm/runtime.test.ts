import { describe, it, expect, vi, afterEach } from "vitest";
import { describeStatus, llmStatus, nextSetupStep } from "./runtime";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("nextSetupStep", () => {
  const model = "llama3.2";
  it("stays rules-based on the web build (can't install)", () => {
    expect(nextSetupStep({ available: false, runtime: "rules-only" }, { isDesktop: false })).toBe("web");
  });
  it("needs Ollama when the server is unreachable", () => {
    expect(nextSetupStep({ available: false, runtime: "rules-only" }, { isDesktop: true })).toBe("needs-ollama");
  });
  it("needs a model when the server is up but nothing is pulled", () => {
    expect(nextSetupStep({ available: true, runtime: "ollama", models: [] }, { isDesktop: true, model })).toBe("needs-model");
  });
  it("is ready when the wanted model is present, ignoring its tag", () => {
    expect(nextSetupStep({ available: true, runtime: "ollama", models: ["llama3.2:latest"] }, { isDesktop: true, model })).toBe("ready");
  });
  it("still needs the wanted model when only a different one is installed", () => {
    expect(nextSetupStep({ available: true, runtime: "ollama", models: ["qwen2.5:7b"] }, { isDesktop: true, model })).toBe("needs-model");
  });
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
