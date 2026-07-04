import { describe, it, expect } from "vitest";
import { DEEP_DIVE_TABS, isDeepDiveTab } from "./deep-dive";

describe("DEEP_DIVE_TABS", () => {
  it("has the 6 tabs in order", () => {
    expect(DEEP_DIVE_TABS.map((t) => t.id)).toEqual(["timeline", "stealth", "deviation", "frameworks", "findings", "log"]);
  });

  it("gives every tab a non-empty label", () => {
    for (const t of DEEP_DIVE_TABS) expect(t.label.length).toBeGreaterThan(0);
  });
});

describe("isDeepDiveTab", () => {
  it("accepts every id in DEEP_DIVE_TABS", () => {
    for (const t of DEEP_DIVE_TABS) expect(isDeepDiveTab(t.id)).toBe(true);
  });

  it("rejects an unknown id", () => {
    expect(isDeepDiveTab("nope")).toBe(false);
  });
});
