import { describe, it, expect } from "vitest";
import fixture from "../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../types/report";
import {
  computeMetrics,
  percentile,
  thinkBaselineP75,
  episodeNoise,
  contextNoiseFactor,
  wasteBreakdown,
  efficiencyByTactic,
  round,
} from "./metrics";
import type { Episode } from "../types/report";
import { fmtMinutes } from "./format";

const report = fixture as unknown as WatcherReport;

describe("percentile (deterministic, nearest-rank)", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 0.75)).toBe(0);
  });
  it("matches a hand-computed P75", () => {
    // 20 values 1..20, ceil(0.75*20)=15 -> 15th value = 15
    const vals = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(percentile(vals, 0.75)).toBe(15);
  });
  it("is order-independent", () => {
    expect(percentile([30, 10, 20], 0.5)).toBe(percentile([20, 30, 10], 0.5));
  });
});

describe("episodeNoise (brief §6.1: w × (1 + log10 volume))", () => {
  it("scales weight by volume", () => {
    expect(episodeNoise({ noise_weight: 6, volume: 4614 } as never)).toBeCloseTo(27.985, 2);
  });
  it("is zero when weight is zero (a think_pause)", () => {
    expect(episodeNoise({ noise_weight: 0, volume: 0 } as never)).toBe(0);
  });
  it("treats volume < 1 as 1 (log10 floor)", () => {
    expect(episodeNoise({ noise_weight: 3, volume: 0 } as never)).toBe(3);
  });
});

describe("context-aware noise (host vs network surface)", () => {
  const ep = (binary: string, contextPath?: string): Episode => ({
    seq: 1,
    cmd: binary,
    binary,
    duration_ms: 0,
    gap_before_ms: 0,
    actor: "human_active",
    tactic: "TA0002",
    noise_weight: 1,
    volume: 1,
    context_path: contextPath,
  });
  const ssh = "host->ssh:10.10.10.5";

  it("leaves external commands on the network-tuned weight", () => {
    expect(contextNoiseFactor(ep("nc"))).toBe(1);
    expect(episodeNoise(ep("nc"))).toBeCloseTo(1);
  });

  it("amplifies host-artifact tools run on the target", () => {
    // a reverse shell / listener is loud host-side even though nc's network weight is 1
    expect(contextNoiseFactor(ep("nc", ssh))).toBeCloseTo(1.6);
    expect(episodeNoise(ep("nc", ssh))).toBeGreaterThan(episodeNoise(ep("nc")));
    expect(episodeNoise(ep("bash", ssh))).toBeGreaterThan(episodeNoise(ep("bash")));
  });

  it("damps passive reads on the target (quiet host-side)", () => {
    expect(contextNoiseFactor(ep("cat", ssh))).toBeCloseTo(0.7);
    expect(episodeNoise(ep("cat", ssh))).toBeLessThan(episodeNoise(ep("cat")));
  });
});

describe("think baseline", () => {
  it("the operator's P75 think gap is 30s for this session", () => {
    expect(thinkBaselineP75(report.episodes)).toBe(30000);
  });
});

describe("waste invariants (Wasted = D + S + L)", () => {
  it("productive + wasted equals active, exactly", () => {
    const w = wasteBreakdown(report.episodes);
    const wasted = w.detour_ms + w.stuck_ms + w.loop_ms;
    expect(w.productive_ms + wasted).toBe(w.t_active_ms);
  });
  it("efficiency = (1 - wasted/active) x 100", () => {
    const w = wasteBreakdown(report.episodes);
    const wasted = w.detour_ms + w.stuck_ms + w.loop_ms;
    expect(w.efficiency_pct).toBeCloseTo((1 - wasted / w.t_active_ms) * 100, 6);
  });
});

describe("reproduces the brief's example framing", () => {
  const byTactic = efficiencyByTactic(report.episodes);

  it('recon is "91% efficient"', () => {
    expect(round(byTactic.TA0007)).toBe(91);
  });
  it('privesc is "40%"', () => {
    expect(round(byTactic.TA0004)).toBe(40);
  });
  it('"23 minutes lost" shows up as the stuck bucket', () => {
    const m = computeMetrics(report);
    expect(fmtMinutes(m.time_waster.stuck_ms)).toBe("23 min");
  });
  it("execution phase was clean (100%)", () => {
    expect(round(byTactic.TA0002)).toBe(100);
  });
});

describe("conformance: the engine reproduces the fixture's stored metrics", () => {
  const m = computeMetrics(report);
  const stored = report.metrics;

  it("overall efficiency", () => {
    expect(round(m.efficiency_pct)).toBe(stored.efficiency_pct);
  });
  it("time-waster breakdown (exact ms)", () => {
    expect(m.time_waster).toEqual(stored.time_waster);
  });
  it("stealth score", () => {
    expect(round(m.stealth_score)).toBe(stored.stealth_score);
  });
  it("objective coverage", () => {
    expect(round(m.objective_coverage_pct)).toBe(stored.objective_coverage_pct);
  });
  it("technique breadth", () => {
    expect(m.technique_breadth).toBe(stored.technique_breadth);
  });
  it("loudest moments (same episodes, hydra first)", () => {
    expect(m.loud_moments.map((l) => l.seq)).toEqual(stored.loud_moments!.map((l) => l.seq));
    expect(m.loud_moments[0].seq).toBe(11);
  });
  it("per-phase efficiency matches the stored phase map", () => {
    for (const phase of report.phases) {
      expect(round(m.efficiency_by_tactic[phase.mitre_tactic])).toBe(phase.efficiency_pct);
    }
  });
});

describe("determinism", () => {
  it("two runs over the same episodes are byte-identical", () => {
    expect(computeMetrics(report)).toEqual(computeMetrics(report));
  });
});
