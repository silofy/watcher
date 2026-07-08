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
