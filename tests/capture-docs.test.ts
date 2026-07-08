import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(import.meta.url), "../..");
const surfaces = ["README.md", "crates/capture/CAPTURE.md", "src/components/Install.tsx"];

describe("capture setup surfaces lead with npm run capture", () => {
  for (const rel of surfaces) {
    it(`${rel} documents the npm run capture command`, () => {
      const text = readFileSync(resolve(root, rel), "utf8");
      expect(text).toContain("npm run capture");
    });
  }
});
