import { describe, it, expect } from "vitest";
import { detectCredNotReused, detectEnumNotAudited, computeSignalGhost, slowLineItem, detectPrivescSlowLine, dedupeSignals } from "./signals";
import type { WatcherReport, Episode, Finding, GoldenObjective } from "../../types/report";
import type { GhostDiffItem } from "./ghost";

function ep(seq: number, binary: string, cmd: string, extra: Partial<Episode> = {}): Episode {
  return { seq, binary, cmd, duration_ms: 0, gap_before_ms: 0, actor: "human_active", tactic: "TA0007", ...extra };
}
function cred(source_seq: number): Finding {
  return { id: `cred:${source_seq}`, kind: "cred", value: "password: [redacted]", source_seq, used_by_seq: [] };
}
function report(episodes: Episode[], findings: Finding[]): WatcherReport {
  return { episodes, findings } as WatcherReport;
}

describe("detectCredNotReused", () => {
  it("fires when a cred is found and no later episode attempts authentication", () => {
    const r = report([ep(5, "cat", "cat rclone.conf"), ep(6, "ls", "ls -la")], [cred(5)]);
    const items = detectCredNotReused(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "reuse_found_cred", verdict: "skipped", unlock_seq: 5, actual_seq: null, lag_ms: 0 });
  });

  it("stays silent when a later episode attempts authentication (ssh)", () => {
    const r = report([ep(5, "cat", "cat rclone.conf"), ep(7, "ssh", "ssh user@host")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("stays silent when smbclient -U is used after the cred", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(8, "smbclient", "smbclient //h/share -U scott")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("emits nothing when there are no cred findings", () => {
    const r = report([ep(1, "nmap", "nmap host")], []);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("computeSignalGhost includes the cred item", () => {
    const r = report([ep(5, "cat", "cat creds")], [cred(5)]);
    expect(computeSignalGhost(r).map((i) => i.objective)).toContain("reuse_found_cred");
  });

  it("stays silent when curl -uadmin:pass is used after the cred (attached short form)", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "curl", "curl -uadmin:pass http://target")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("stays silent when curl --user user:pass is used after the cred", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "curl", "curl --user user:pass http://target")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("stays silent when curl -u=user:pass (equals form) is used after the cred", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "curl", "curl -u=user:pass http://target")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("fires when curl --user-agent is used (not an auth attempt) but no real auth", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "curl", "curl --user-agent=Firefox http://target")], [cred(5)]);
    const items = detectCredNotReused(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "reuse_found_cred", verdict: "skipped" });
  });

  it("stays silent when wget with -u flag is used after the cred", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "wget", "wget -u user:pass http://target")], [cred(5)]);
    expect(detectCredNotReused(r)).toEqual([]);
  });

  it("fires when wget --user-agent is used (not an auth attempt) but no real auth", () => {
    const r = report([ep(5, "cat", "cat creds"), ep(9, "wget", "wget --user-agent=Lynx http://target")], [cred(5)]);
    const items = detectCredNotReused(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "reuse_found_cred", verdict: "skipped" });
  });
});

describe("detectEnumNotAudited", () => {
  it("fires on a null SMB listing with no later share audit", () => {
    const r = report([ep(4, "smbclient", "smbclient -L //host/ -N", { exit_code: 0 }), ep(5, "cat", "cat notes")], []);
    const items = detectEnumNotAudited(r);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ objective: "audit_smb_shares", verdict: "skipped", unlock_seq: 4, actual_seq: null });
  });

  it("stays silent when shares were later audited (smbmap)", () => {
    const r = report([ep(4, "smbclient", "smbclient -L //host/ -N", { exit_code: 0 }), ep(6, "smbmap", "smbmap -H host")], []);
    expect(detectEnumNotAudited(r)).toEqual([]);
  });

  it("stays silent when there was no null listing", () => {
    const r = report([ep(1, "nmap", "nmap -sCV host")], []);
    expect(detectEnumNotAudited(r)).toEqual([]);
  });
});

describe("privesc slow-line", () => {
  it("slowLineItem translates a slow_line into a late_pivot with computed lag", () => {
    const episodes = [ep(11, "ls", "ls -la /etc"), ep(16, "cat", "cat root.txt", { gap_before_ms: 60000, duration_ms: 0 })];
    const item = slowLineItem({ available_seq: 11, rooted_seq: 16, path: { title: "writable systemd dir" } } as any, episodes);
    expect(item).toMatchObject({ objective: "escalate_via_confirmed_path", verdict: "late_pivot", unlock_seq: 11, actual_seq: 16 });
    expect(item.lag_ms).toBeGreaterThan(0);
    expect(item.note).toContain("writable systemd dir");
  });

  it("detectPrivescSlowLine emits nothing when there is no privesc signal", () => {
    const r = report([ep(1, "nmap", "nmap host")], []);
    expect(detectPrivescSlowLine(r)).toEqual([]);
  });
});

const sig = (objective: string, unlock_seq: number): GhostDiffItem =>
  ({ objective, verdict: "skipped", unlock_seq, actual_seq: null, lag_ms: 0, note: "" });

describe("dedupeSignals", () => {
  it("returns all signals when there are no golden items", () => {
    const s = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals(s, [], [], [])).toEqual(s);
  });

  it("drops a signal that shares a golden objective's slug", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_smb_shares", tactic: "TA0007", satisfied_by: [] }];
    const goldenItems = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals([sig("audit_smb_shares", 4)], goldenItems, golden, [])).toEqual([]);
  });

  it("drops a signal with the same tactic and an adjacent unlock seq", () => {
    const golden: GoldenObjective[] = [{ objective: "audit_share_permissions", tactic: "TA0007", satisfied_by: [] }];
    const goldenItems = [sig("audit_share_permissions", 5)];
    const episodes = [ep(4, "smbclient", "smbclient -L //h/ -N"), ep(5, "x", "x")];
    // audit_smb_shares is TA0007; golden unlock 5 is adjacent to signal unlock 4 → dropped
    expect(dedupeSignals([sig("audit_smb_shares", 4)], goldenItems, golden, episodes)).toEqual([]);
  });

  it("keeps a signal when the golden objective is a different tactic / far away", () => {
    const golden: GoldenObjective[] = [{ objective: "capture_root_flag", tactic: "TA0004", satisfied_by: [] }];
    const goldenItems = [sig("capture_root_flag", 30)];
    const episodes = Array.from({ length: 30 }, (_, i) => ep(i + 1, "x", "x"));
    const s = [sig("audit_smb_shares", 4)];
    expect(dedupeSignals(s, goldenItems, golden, episodes)).toEqual(s);
  });
});
