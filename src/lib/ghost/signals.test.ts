import { describe, it, expect } from "vitest";
import { detectCredNotReused, computeSignalGhost } from "./signals";
import type { WatcherReport, Episode, Finding } from "../../types/report";

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
