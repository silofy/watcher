import { describe, it, expect } from "vitest";
import { routeSteps, routeCounts } from "./route";
import type { Episode, GoldenObjective } from "../types/report";

const obj = (objective: string, seq: number | null, satisfied_by = ["tool"]): GoldenObjective =>
  ({ objective, tactic: "TA0007", satisfied_by, user_satisfied_by_seq: seq }) as GoldenObjective;
const ep = (seq: number, alignment?: string, binary = "nmap") => ({ seq, alignment, binary }) as unknown as Episode;

describe("routeSteps", () => {
  const steps = routeSteps(
    [obj("enumerate_services", 1), obj("audit_share_permissions", null, ["smbmap"]), obj("get_foothold", 3), obj("read_config", 2)],
    [ep(1, "match"), ep(2, "out_of_order"), ep(3, "alternative", "nc")],
  );

  it("keeps the write-up's order and classifies each objective", () => {
    expect(steps.map((s) => s.status)).toEqual(["match", "skipped", "alternative", "out_of_order"]);
  });

  it("carries the fix: the suggested tool for a skip, the binary used for an alternative", () => {
    expect(steps[1]).toMatchObject({ seq: null, suggestion: "smbmap" });
    expect(steps[2]).toMatchObject({ seq: 3, binary: "nc" });
  });

  it("treats an unaligned or detour step as matched (same as the old statusOf)", () => {
    expect(routeSteps([obj("x", 7)], [ep(7, "detour")])[0].status).toBe("match");
    expect(routeSteps([obj("x", 7)], [ep(7, undefined)])[0].status).toBe("match");
  });

  it("counts statuses", () => {
    expect(routeCounts(steps)).toEqual({ match: 1, alternative: 1, out_of_order: 1, skipped: 1 });
  });
});
