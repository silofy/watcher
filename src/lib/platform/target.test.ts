import { describe, it, expect } from "vitest";
import { targetOf } from "./index";
import type { WatcherReport } from "../../types/report";

const base = (over: Partial<WatcherReport["session"]>): WatcherReport => ({
  schema_version: "1.2",
  session: { uuid: "x", started_at: "2026-01-01T00:00:00Z", ended_at: "2026-01-01T00:01:00Z", target_scope: "HTB::Forge (Medium)", shell: "bash", source: "local_pty", ...over },
  episodes: [], phases: [], golden_dag: [],
  metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
  coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] },
  redaction_profile: "full",
});

describe("targetOf", () => {
  it("prefers an explicit session.target when present", () => {
    const r = base({ target: { platform: "thm", kind: "room", name: "Blue" } });
    expect(targetOf(r).platform).toBe("thm");
  });
  it("resolves HTB identity from machine + scope", () => {
    const r = base({ machine: { name: "Forge", os: "Linux", difficulty: "Medium" } });
    const t = targetOf(r);
    expect(t.platform).toBe("htb");
    expect(t.name).toBe("Forge");
    expect(t.difficulty?.label).toBe("Medium");
  });
});
