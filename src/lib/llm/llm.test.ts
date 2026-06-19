import { describe, it, expect } from "vitest";
import fixture from "../../../fixtures/session-htb-easy.json";
import type { Episode, GoldenObjective, WatcherReport } from "../../types/report";
import { selectTier, probeHardware } from "./hardware";
import { CLASSIFY_GBNF, CLASSIFY_SCHEMA, EQUIV_SCHEMA, TACTICS } from "./grammar";
import { NullProvider, type GenOptions, type LlmProvider } from "./provider";
import { refineClassification, judgeEquivalence, refineReport, OVERRIDE_THRESHOLD } from "./refine";

const report = fixture as unknown as WatcherReport;
const nmap = report.episodes.find((e) => e.binary === "nmap")! as Episode;
const services = report.golden_dag.find((o) => o.objective === "enumerate_services")! as GoldenObjective;

/** A provider that returns a fixed value — stands in for a real model. */
class MockProvider implements LlmProvider {
  readonly name = "mock";
  constructor(private value: unknown | null) {}
  async available() {
    return true;
  }
  async generateJson(_p: string, _o?: GenOptions) {
    return this.value;
  }
}

describe("hardware-scaled model selection (§5.1)", () => {
  it("picks the right tier for each profile", () => {
    expect(selectTier({ ramGb: 32, cores: 16, hasGpu: true }).name).toBe("high");
    expect(selectTier({ ramGb: 16, cores: 8, hasGpu: false })).toMatchObject({ name: "default", quant: "Q4_K_M" });
    expect(selectTier({ ramGb: 8, cores: 4, hasGpu: false }).name).toBe("low");
    expect(selectTier({ ramGb: 4, cores: 2, hasGpu: false }).name).toBe("rules-only");
  });
  it("probes the host", () => {
    const p = probeHardware();
    expect(p.ramGb).toBeGreaterThan(0);
    expect(p.cores).toBeGreaterThan(0);
  });
});

describe("constrained decoding (§4.2)", () => {
  it("the grammar and schema cover every tactic", () => {
    for (const t of TACTICS) expect(CLASSIFY_GBNF).toContain(t);
    expect(CLASSIFY_SCHEMA.properties.tactic.enum).toEqual([...TACTICS]);
    expect(EQUIV_SCHEMA.properties.equivalent.type).toBe("boolean");
  });
});

describe("deterministic-first refinement", () => {
  it("rules-only (NullProvider) keeps the deterministic prior", async () => {
    const r = await refineClassification(new NullProvider(), nmap);
    expect(r.tactic).toBe(nmap.tactic);
  });

  it("adopts a confident model override", async () => {
    const r = await refineClassification(new MockProvider({ tactic: "TA0004", confidence: 0.9 }), nmap);
    expect(r.tactic).toBe("TA0004");
    expect(r.confidence).toBe(0.9);
  });

  it("ignores a low-confidence override (below the threshold)", async () => {
    const r = await refineClassification(new MockProvider({ tactic: "TA0004", confidence: OVERRIDE_THRESHOLD - 0.1 }), nmap);
    expect(r.tactic).toBe(nmap.tactic);
  });

  it("ignores an out-of-grammar tactic", async () => {
    const r = await refineClassification(new MockProvider({ tactic: "TA9999", confidence: 0.99 }), nmap);
    expect(r.tactic).toBe(nmap.tactic);
  });

  it("equivalence falls back to deterministic, and honors a model verdict", async () => {
    expect(await judgeEquivalence(new NullProvider(), nmap, services)).toBe(true); // deterministic match
    expect(await judgeEquivalence(new MockProvider({ equivalent: false }), nmap, services)).toBe(false);
  });

  it("refineReport with rules-only is a no-op", async () => {
    expect(await refineReport(report, new NullProvider())).toEqual(report);
  });
});
