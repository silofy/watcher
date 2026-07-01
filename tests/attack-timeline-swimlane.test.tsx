import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { AttackTimeline } from "../src/components/AttackTimeline";
import { episodeLane } from "../src/lib/scale";
import type { Episode } from "../src/types/report";

/**
 * Swim-lanes only appear when a shell was tapped (an `ssh:<target>` context shows up). A host-only
 * engagement must stay a single full-height ribbon — no lane split, no "on-target" label. The
 * positive lane classification is covered by episodeLane's unit tests; here we guard against the
 * split misfiring on ordinary local sessions (the default fixture is host-only).
 */
describe("AttackTimeline lanes", () => {
  it("keeps a host-only session in one full-height lane", () => {
    const html = renderToStaticMarkup(<AttackTimeline />);
    expect(html).not.toContain(">on-target<");
    expect(html).toContain('height="44"'); // full ribbon height (RIB_H), not the split RIB_H/2
    expect(html).not.toContain('y="22"'); // nothing pushed to the lower lane band
  });

  it("routes an ssh-tapped episode to the target lane (the split's predicate)", () => {
    const onTarget: Episode = { seq: 1, cmd: "id", binary: "id", duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", context_path: "ssh:10.10.10.5" };
    const local: Episode = { seq: 2, cmd: "nmap", binary: "nmap", duration_ms: 0, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007", context_path: "host" };
    expect(episodeLane(onTarget)).toBe("target");
    expect(episodeLane(local)).toBe("host");
  });
});
