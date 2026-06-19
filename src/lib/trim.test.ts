import { describe, it, expect } from "vitest";
import fixture from "../../fixtures/session-htb-easy.json";
import type { WatcherReport } from "../types/report";
import { applyTrim, seqBounds } from "./trim";
import { computeMetrics } from "./metrics";

const full = fixture as unknown as WatcherReport;

describe("applyTrim", () => {
  it("returns the full report when range is null", () => {
    expect(applyTrim(full, null)).toBe(full);
  });

  it("scopes episodes to the inclusive seq window", () => {
    const view = applyTrim(full, [9, 16]);
    expect(view.episodes.every((e) => e.seq >= 9 && e.seq <= 16)).toBe(true);
    expect(view.episodes.length).toBe(8);
    expect(view.episodes.length).toBeLessThan(full.episodes.length);
  });

  it("re-derives phases from only the windowed episodes", () => {
    // recon-only window (seq 1..8 are all TA0007)
    const view = applyTrim(full, [1, 8]);
    expect(view.phases.map((p) => p.mitre_tactic)).toEqual(["TA0007"]);
  });

  it("re-scopes objective coverage to the window", () => {
    const reconOnly = applyTrim(full, [1, 8]);
    // only the recon objectives can be satisfied in this window
    expect(reconOnly.metrics.objective_coverage_pct).toBeLessThan(full.metrics.objective_coverage_pct);
    const satisfied = reconOnly.golden_dag.filter((o) => o.user_satisfied_by_seq != null);
    expect(satisfied.every((o) => o.user_satisfied_by_seq! <= 8)).toBe(true);
  });

  it("the trimmed view is itself a valid input to the metrics engine (deterministic)", () => {
    const view = applyTrim(full, [20, 29]); // privesc window
    const m = computeMetrics(view);
    expect(m.time_waster.t_active_ms).toBeGreaterThan(0);
    // the 23-min stall lives in this window, so it should dominate the waste
    expect(m.time_waster.stuck_ms).toBeGreaterThan(m.time_waster.detour_ms);
  });

  it("is order-independent on the range tuple", () => {
    expect(applyTrim(full, [16, 9])).toEqual(applyTrim(full, [9, 16]));
  });
});

describe("seqBounds", () => {
  it("returns the full session's seq range", () => {
    expect(seqBounds(full)).toEqual([1, 30]);
  });
});
