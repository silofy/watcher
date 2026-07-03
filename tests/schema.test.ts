import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import Ajv from "ajv/dist/2020";
import addFormats from "ajv-formats";
import schema from "../schema/watcher-report.schema.json";
import fixture from "../fixtures/session-htb-easy.json";

const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
const validate = ajv.compile(schema);

describe("watcher-report schema", () => {
  const dir = join(import.meta.dirname, "..", "fixtures");
  const files = readdirSync(dir).filter((f) => /^session-.*\.json$/.test(f));

  it("has fixtures to validate", () => expect(files.length).toBeGreaterThan(0));

  for (const f of files) {
    it(`validates ${f}`, () => {
      const doc = JSON.parse(readFileSync(join(dir, f), "utf8"));
      const ok = validate(doc);
      if (!ok) console.error(f, validate.errors);
      expect(ok).toBe(true);
    });
  }
});

describe("fixture conforms to watcher-report.schema.json v1.0", () => {
  it("validates the bundled HTB-easy fixture", () => {
    const ok = validate(fixture);
    if (!ok) console.error(validate.errors);
    expect(ok).toBe(true);
  });

  it("rejects a missing required top-level key (negative control)", () => {
    const broken = structuredClone(fixture) as Record<string, unknown>;
    delete broken.metrics;
    expect(validate(broken)).toBe(false);
  });

  it("rejects an out-of-range efficiency", () => {
    const broken = structuredClone(fixture) as { metrics: { efficiency_pct: number } };
    broken.metrics.efficiency_pct = 142;
    expect(validate(broken)).toBe(false);
  });

  it("rejects an unknown actor mode", () => {
    const broken = structuredClone(fixture) as { episodes: { actor: string }[] };
    broken.episodes[0].actor = "robot";
    expect(validate(broken)).toBe(false);
  });

  it("rejects a malformed MITRE tactic id", () => {
    const broken = structuredClone(fixture) as { episodes: { tactic: string }[] };
    broken.episodes[0].tactic = "discovery";
    expect(validate(broken)).toBe(false);
  });
});
