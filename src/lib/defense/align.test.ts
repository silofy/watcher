import { describe, it, expect } from "vitest";
import { alignInvestigation } from "./align";
import type { Incident } from "./types";
import type { WatcherReport } from "../../types/report";

const incident: Incident = {
  target_scope: "Abducted",
  entities: ["abducted.htb"],
  artifacts: [
    { id: "art:seq7", label: "injection", phase: "execution", technique: "T1059", indicators: ["CVE-2026-4480", "|bash"], entities: [], weight: 6, depends_on: [], source_seq: 7 },
    { id: "art:seq25", label: "persistence", phase: "privilege-escalation", technique: "T1543", indicators: ["override.conf"], entities: [], weight: 5, depends_on: ["art:seq7"], source_seq: 25 },
  ],
};

const run = {
  session: {},
  episodes: [
    { seq: 1, cmd: "grep -ri CVE-2026-4480 /var/log", binary: "grep", started_at_ms: 0, output_digest: "match: samba print injection CVE-2026-4480" },
    { seq: 2, cmd: "ls -la /home", binary: "ls", started_at_ms: 5000, output_digest: "nothing useful" },
  ],
} as unknown as WatcherReport;

describe("alignInvestigation", () => {
  it("marks an artifact found when a run episode surfaces its indicator, and flags noise", () => {
    const res = alignInvestigation(incident, run);
    const inj = res.hits.find((h) => h.artifact_id === "art:seq7")!;
    expect(inj.found).toBe(true);
    expect(inj.found_by_seq).toBe(1);
    expect(inj.matched_indicator).toBe("CVE-2026-4480");
    const persist = res.hits.find((h) => h.artifact_id === "art:seq25")!;
    expect(persist.found).toBe(false);
    expect(res.advancing_seqs).toContain(1);
    expect(res.noise_seqs).toContain(2); // the ls found nothing
  });
});
