import { describe, it, expect } from "vitest";
import { shouldOpenOnboarding, ONBOARDED_KEY, ONBOARDED_VALUE } from "./onboarding";
import { STEP_COUNT, clampStep, shouldShowNudge, deriveChecklist } from "./onboarding";

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

describe("activation-flow step logic", () => {
  it("clamps step into [0, STEP_COUNT-1]", () => {
    expect(clampStep(-2)).toBe(0);
    expect(clampStep(0)).toBe(0);
    expect(clampStep(STEP_COUNT - 1)).toBe(STEP_COUNT - 1);
    expect(clampStep(STEP_COUNT + 5)).toBe(STEP_COUNT - 1);
  });

  it("nudges only when onboarded but no real capture yet", () => {
    expect(shouldShowNudge({ onboarded: true, hasRealCapture: false })).toBe(true);
    expect(shouldShowNudge({ onboarded: true, hasRealCapture: true })).toBe(false);
    expect(shouldShowNudge({ onboarded: false, hasRealCapture: false })).toBe(false);
  });

  it("derives a 3-item checklist reflecting completion", () => {
    const list = deriveChecklist({ demoDone: true, hasRealCapture: false, aiDone: true });
    expect(list.map((i) => i.key)).toEqual(["demo", "capture", "ai"]);
    expect(list.find((i) => i.key === "demo")!.done).toBe(true);
    expect(list.find((i) => i.key === "capture")!.done).toBe(false);
    expect(list.find((i) => i.key === "ai")!.done).toBe(true);
  });
});
