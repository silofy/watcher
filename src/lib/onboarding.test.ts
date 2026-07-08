import { describe, it, expect } from "vitest";
import { shouldOpenOnboarding, ONBOARDED_KEY, ONBOARDED_VALUE } from "./onboarding";

describe("shouldOpenOnboarding", () => {
  it("opens on a fresh install (no stored flag)", () => {
    expect(shouldOpenOnboarding({ stored: null, force: false })).toBe(true);
  });

  it("stays closed once onboarding is marked done", () => {
    expect(shouldOpenOnboarding({ stored: ONBOARDED_VALUE, force: false })).toBe(false);
  });

  it("force-opens regardless of the stored flag", () => {
    expect(shouldOpenOnboarding({ stored: ONBOARDED_VALUE, force: true })).toBe(true);
  });

  it("uses the agreed storage key and value", () => {
    expect(ONBOARDED_KEY).toBe("watcher.onboarded");
    expect(ONBOARDED_VALUE).toBe("1");
  });
});
