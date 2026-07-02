import { describe, it, expect } from "vitest";
import { assembleReport } from "../src/lib/pipeline/ingest";
import { DEMO_RAW, DEMO_SESSION, DEMO_GOLDEN } from "../src/lib/demo/playthrough";
import { detectFlags } from "../src/lib/flags";
import { finalizeLiveReport } from "../src/lib/finalize";

/**
 * The scripted demo doubles as a validation harness for the live branch: it exercises assembleReport →
 * finalizeLiveReport with a realistic kill chain and asserts the pipeline resolves it the way the demo
 * narrative promises (both flags land, the foothold is Execution, coverage is 9/10 with the cron check
 * the only skip). If the classifier or alignment drifts, this fails before the demo misleads a viewer.
 */
describe("demo playthrough", () => {
  const report = assembleReport(DEMO_RAW, { session: DEMO_SESSION, golden: DEMO_GOLDEN });

  it("classifies the reverse-shell one-liner as Execution (the foothold)", () => {
    const shell = report.episodes.find((e) => e.cmd.includes("/dev/tcp/"));
    expect(shell?.tactic).toBe("TA0002");
  });

  it("detects both the user and root flags from telemetry", () => {
    const flags = detectFlags(report.episodes);
    expect(flags.user).not.toBeNull();
    expect(flags.system).not.toBeNull();
  });

  it("resolves to 9/10 objective coverage with only the cron check skipped", () => {
    const satisfied = report.golden_dag.filter((o) => o.user_satisfied_by_seq != null);
    const skipped = report.golden_dag.filter((o) => o.user_satisfied_by_seq == null);
    expect(satisfied).toHaveLength(9);
    expect(skipped.map((o) => o.objective)).toEqual(["check_cron_jobs"]);
    expect(Math.round(report.metrics.objective_coverage_pct)).toBe(90);
  });

  it("marks a live snapshot as recording and resolves when it ends", () => {
    const partial = assembleReport(DEMO_RAW.slice(0, 4), { session: DEMO_SESSION, golden: [] });
    const live = finalizeLiveReport({ ...partial, recording: true });
    expect(live.recording).toBe(true);
    const done = finalizeLiveReport({ ...report, recording: false });
    expect(done.recording).toBe(false);
  });
});
