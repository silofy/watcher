import { describe, it, expect } from "vitest";
import { DEMOS } from "../lib/demo/registry";
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
