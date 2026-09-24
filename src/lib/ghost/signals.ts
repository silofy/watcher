import type { WatcherReport, Episode } from "../../types/report";
import type { GhostDiffItem } from "./ghost";

/** Signal slug → MITRE tactic, used by de-duplication against golden objectives. */
export const SIGNAL_TACTIC: Record<string, string> = {
  reuse_found_cred: "TA0006",
  audit_smb_shares: "TA0007",
  escalate_via_confirmed_path: "TA0004",
};

/** Cumulative elapsed (gap+duration) ms by seq, over episodes in seq order. */
export function elapsedBySeq(episodes: Episode[]): Map<number, number> {
  const ordered = [...episodes].sort((a, b) => a.seq - b.seq);
  const elapsed = new Map<number, number>();
  let acc = 0;
  for (const e of ordered) {
    acc += (e.gap_before_ms ?? 0) + (e.duration_ms ?? 0);
    elapsed.set(e.seq, acc);
  }
  return elapsed;
}

// Binaries whose invocation is an authentication attempt. smbclient/curl/wget are auth only with
// the right flag, so they are handled specially in isAuthAttempt (bare smbclient -L is enumeration).
const AUTH_BINARIES = new Set([
  "ssh", "su", "sshpass", "evil-winrm", "crackmapexec", "netexec",
  "mysql", "psql", "ftp", "rdesktop", "xfreerdp", "winrm", "psexec.py", "wmiexec.py",
]);

function isAuthAttempt(ep: Episode): boolean {
  const b = ep.binary;
  if (AUTH_BINARIES.has(b)) return true;
  if (b === "smbclient" && /(^|\s)-U(\s|=)/.test(ep.cmd)) return true;
  if (b === "curl" || b === "wget") {
    if (/(^|\s)-u(\s|=|[^\s=-])/.test(ep.cmd)) return true;      // -u <x> or -u=<x> or -uX (attached)
    if (/(^|\s)--user(?!-agent)(=|\s|$)/.test(ep.cmd)) return true; // --user / --user= but not --user-agent
    return false;
  }
  return false;
}

/**
 * Credential found, never used: a cred finding exists and NO later episode attempts any
 * authentication. Deliberately conservative — it never consults used_by_seq (unreliable under
 * redaction) and stays silent whenever any pivot was attempted, so it fires only for the
 * unambiguous "dumped creds, never pivoted" case.
 */
export function detectCredNotReused(report: WatcherReport): GhostDiffItem[] {
  const findings = report.findings ?? [];
  const episodes = report.episodes ?? [];
  const creds = findings.filter((f) => f.kind === "cred").sort((a, b) => a.source_seq - b.source_seq);
  if (!creds.length) return [];
  const earliest = creds[0];
  const pivoted = episodes.some((e) => e.seq > earliest.source_seq && isAuthAttempt(e));
  if (pivoted) return [];
  return [{
    objective: "reuse_found_cred",
    verdict: "skipped",
    unlock_seq: earliest.source_seq,
    actual_seq: null,
    lag_ms: 0,
    note: `You surfaced credentials at step ${earliest.source_seq} but never attempted to authenticate with them.`,
  }];
}

const DETECTORS: ((report: WatcherReport) => GhostDiffItem[])[] = [
  detectCredNotReused,
];

/** All write-up-free signal items for a report (pre-dedupe). */
export function computeSignalGhost(report: WatcherReport): GhostDiffItem[] {
  return DETECTORS.flatMap((d) => d(report));
}
