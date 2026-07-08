import { describe, it, expect } from "vitest";
import { assembleReport } from "../src/lib/pipeline/ingest";
import { ABDUCTED, ABDUCTED_GOLDEN, ABDUCTED_SESSION } from "../src/lib/demo/abducted";
import { detectFlags } from "../src/lib/flags";
import { finalizeLiveReport } from "../src/lib/finalize";
import { useReport } from "../src/store/report";

/**
 * The scripted demo doubles as a validation harness for the live branch: it exercises assembleReport →
 * finalizeLiveReport with a realistic kill chain and asserts the pipeline resolves it the way the demo
 * narrative promises (both flags land, the foothold is Execution, coverage is 20/21 with the share-
 * permission audit the only skip). If the classifier or alignment drifts, this fails before the demo
 * misleads a viewer.
 */
describe("demo playthrough (Abducted)", () => {
  const DEMO_RAW = ABDUCTED.raw;
  const report = assembleReport(DEMO_RAW, { session: ABDUCTED_SESSION, golden: ABDUCTED_GOLDEN });

  it("classifies the reverse-shell payload as Execution (the print-injection foothold)", () => {
    const shell = report.episodes.find((e) => e.cmd.includes("/dev/tcp/"));
    expect(shell?.tactic).toBe("TA0002");
  });

  it("detects both the user and root flags from telemetry", () => {
    const flags = detectFlags(report.episodes);
    expect(flags.user).not.toBeNull();
    expect(flags.system).not.toBeNull();
  });

  it("resolves to 20/21 objective coverage with only the share-permission audit skipped", () => {
    const satisfied = report.golden_dag.filter((o) => o.user_satisfied_by_seq != null);
    const skipped = report.golden_dag.filter((o) => o.user_satisfied_by_seq == null);
    expect(satisfied).toHaveLength(20);
    expect(skipped.map((o) => o.objective)).toEqual(["audit_share_permissions"]);
    expect(Math.round(report.metrics.objective_coverage_pct)).toBe(95);
  });

  it("registers a demo card in History (openable as a live playthrough)", () => {
    const s = useReport.getState();
    const card = s.sessionCards.find((c) => c.id === ABDUCTED.id);
    expect(card?.demo).toBe(true);
    expect(card?.machine.name).toBe("Abducted");
    // History is exactly the curated demos — no dev/sample fixtures leak in.
    expect(s.sessionCards.every((c) => c.demo)).toBe(true);
    expect(new Set(s.sessionCards.map((c) => c.machine.name))).toEqual(new Set(["Abducted", "RootMe"]));
  });

  it("marks a live snapshot as recording and resolves when it ends", () => {
    const partial = assembleReport(DEMO_RAW.slice(0, 4), { session: ABDUCTED_SESSION, golden: [] });
    const live = finalizeLiveReport({ ...partial, recording: true });
    expect(live.recording).toBe(true);
    const done = finalizeLiveReport({ ...report, recording: false });
    expect(done.recording).toBe(false);
  });
});
