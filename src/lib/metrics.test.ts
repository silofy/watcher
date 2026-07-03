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
import { computeGrade, RUBRIC_V2 } from "./bridge/grade";
import { computeGhost } from "./ghost/ghost";

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

describe("analysis signals wiring (schema v1.3)", () => {
  it("adds analysis fields without changing existing metrics; a report without methodology still grades as v1, unchanged", () => {
    const before = computeGrade(report);
    const m = computeMetrics(report);
    expect(typeof m.methodology_coverage_pct).toBe("number");
    expect(typeof m.focus_discipline_pct).toBe("number");
    expect(m.recovery_median_ms === null || typeof m.recovery_median_ms === "number").toBe(true);
    // existing fields still match the fixture's stored metrics (non-tautological: compares
    // computed output to a value baked into the fixture, not to itself):
    expect(round(m.objective_coverage_pct)).toBe(report.metrics.objective_coverage_pct);
    // the stored fixture report itself carries no methodology_coverage_pct, so it stays on the
    // frozen v1 rubric — grade must be byte-identical to before.
    expect(report.metrics.methodology_coverage_pct).toBeUndefined();
    expect(computeGrade(report)).toEqual(before);
    expect(before.version).toBe(1);
  });

  it("a report that carries methodology_coverage_pct + focus_discipline_pct grades as v2 (candidate C), not the frozen v1 total", () => {
    const m = computeMetrics(report);
    // splice in the computed v1.3 analysis fields explicitly — the fixture's own metrics never carry
    // them, so this is the "a live/newer report reaches grade.ts with these fields set" case.
    const withAnalysis: WatcherReport = {
      ...report,
      metrics: {
        ...report.metrics,
        methodology_coverage_pct: m.methodology_coverage_pct,
        focus_discipline_pct: m.focus_discipline_pct,
        recovery_median_ms: m.recovery_median_ms,
      },
    };
    const after = computeGrade(withAnalysis);
    expect(after.version).toBe(2);
    expect(after.components.methodology).toBeDefined();
    expect(after.components.focus).toBeDefined();
    // candidate C intentionally folds methodology + focus into the score, so this is NOT expected to
    // equal the frozen v1 total unless methodology/focus happen to match the v1 blend exactly.
    const expected =
      m.objective_coverage_pct * RUBRIC_V2.coverage +
      (m.technique_breadth / 12) * 100 * RUBRIC_V2.breadth +
      m.efficiency_pct * RUBRIC_V2.efficiency +
      (report.metrics.ukc_progression ?? 100) * RUBRIC_V2.progression +
      m.stealth_score * RUBRIC_V2.discipline +
      (report.metrics.independence?.score ?? 0) * RUBRIC_V2.independence +
      (m.methodology_coverage_pct ?? 0) * RUBRIC_V2.methodology +
      (m.focus_discipline_pct ?? 100) * RUBRIC_V2.focus;
    expect(after.score).toBeCloseTo(Math.round(expected * 10) / 10, 1);
  });
});

describe("ghost wiring (schema v1.4)", () => {
  it("adds ghost fields without changing existing metrics or the grade", () => {
    const before = computeGrade(report);
    const m = computeMetrics(report);
    expect(m.ghost_time_lost_ms === null || typeof m.ghost_time_lost_ms === "number").toBe(true);
    expect(m.ghost_human_wins === null || typeof m.ghost_human_wins === "number").toBe(true);
    // existing metric still matches the fixture's stored value (non-tautological: compares
    // computed output to a value baked into the fixture, not to itself):
    expect(round(m.objective_coverage_pct)).toBe(report.metrics.objective_coverage_pct);
    // grade unchanged when the ghost block + the two summary-card metrics are actually present
    // (grade.ts must keep ignoring them — ghost never feeds the grade). Spreading `report`/`report.metrics`
    // alone would be vacuous — the fixture never carries these fields — so splice them in explicitly.
    const withGhost: WatcherReport = {
      ...report,
      metrics: {
        ...report.metrics,
        ghost_time_lost_ms: m.ghost_time_lost_ms,
        ghost_human_wins: m.ghost_human_wins,
      },
      ghost: computeGhost(report) ?? undefined,
    };
    expect(withGhost.ghost).toBeTruthy();
    expect(computeGrade(withGhost)).toEqual(before);
  });
});
