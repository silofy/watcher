import { describe, it, expect } from "vitest";
import { ADAPTERS } from "./index";
import { checkAdapter } from "./conformance";

describe("adapter conformance", () => {
  for (const a of ADAPTERS) {
    it(`${a.id} conforms`, async () => {
      expect(await checkAdapter(a)).toEqual([]);
    });
  }
});
