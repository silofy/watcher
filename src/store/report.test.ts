import { describe, it, expect } from "vitest";
import { DEMOS } from "../lib/demo/registry";
import { ONBOARDED_KEY } from "../lib/onboarding";
import { useReport } from "./report";

describe("demo registry wired into the store", () => {
  it("pre-registers a session card for every demo", () => {
    const cards = useReport.getState().sessionCards;
    for (const d of DEMOS) {
      const card = cards.find((c) => c.id === d.id);
      expect(card, `card for ${d.id}`).toBeTruthy();
      expect(card!.demo).toBe(true);
    }
  });
});

describe("onboarding wizard state", () => {
  it("exposes onboardingOpen plus open/close actions", () => {
    const s = useReport.getState();
    expect(typeof s.onboardingOpen).toBe("boolean");
    expect(typeof s.openOnboarding).toBe("function");
    expect(typeof s.closeOnboarding).toBe("function");
  });

  it("closeOnboarding closes the wizard, openOnboarding reopens it", () => {
    useReport.getState().closeOnboarding();
    expect(useReport.getState().onboardingOpen).toBe(false);
    useReport.getState().openOnboarding();
    expect(useReport.getState().onboardingOpen).toBe(true);
  });

  it("keeps the agreed storage key available for the store to persist", () => {
    expect(ONBOARDED_KEY).toBe("watcher.onboarded");
  });
});

describe("onboarding activation-flow state", () => {
  it("exposes step + done state and setters", () => {
    const s = useReport.getState();
    expect(typeof s.onboardingStep).toBe("number");
    expect(s.onboardingDone).toEqual(expect.objectContaining({ demo: expect.any(Boolean), ai: expect.any(Boolean) }));
    expect(typeof s.setOnboardingStep).toBe("function");
    expect(typeof s.markOnboardingStep).toBe("function");
  });

  it("clamps step and marks completion", () => {
    useReport.getState().setOnboardingStep(99);
    expect(useReport.getState().onboardingStep).toBe(3);
    useReport.getState().setOnboardingStep(-5);
    expect(useReport.getState().onboardingStep).toBe(0);
    useReport.getState().markOnboardingStep("demo");
    expect(useReport.getState().onboardingDone.demo).toBe(true);
  });
});
