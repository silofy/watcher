import { describe, it, expect } from "vitest";
import { resolveProvider } from "./index";
import { isOffline } from "./mode";

describe("resolveProvider — mode selection", () => {
  it("rules mode is the deterministic (rules-only) provider", async () => {
    expect((await resolveProvider({ mode: "rules" })).name).toBe("rules-only");
  });

  it("a cloud mode with no key configured falls back to rules-only", async () => {
    // outside the desktop app there's no key store, so the cloud provider is unavailable
    expect((await resolveProvider({ mode: "anthropic" })).name).toBe("rules-only");
  });
});

describe("isOffline", () => {
  it("marks rules and local as on-device, cloud modes as not", () => {
    expect(isOffline("rules")).toBe(true);
    expect(isOffline("local")).toBe(true);
    expect(isOffline("anthropic")).toBe(false);
    expect(isOffline("gemini")).toBe(false);
  });
});
