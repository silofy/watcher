import type { WatcherReport, Episode } from "../../types/report";
import type { GhostDiffItem } from "./ghost";
import { analyzePrivesc } from "../analysis/privesc";
import type { PrivescResult } from "../analysis/privesc";

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

function isNullSmbListing(ep: Episode): boolean {
  return ep.binary === "smbclient"
    && /(^|\s)-L(\s|$)/.test(ep.cmd)
    && (/(^|\s)-N(\s|$)/.test(ep.cmd) || /-U\s*(""|'')/.test(ep.cmd))
    && (ep.exit_code == null || ep.exit_code === 0);
}

function isShareAudit(ep: Episode): boolean {
  const b = ep.binary;
  if (b === "smbmap" || b === "smbcacls") return true;
  if ((b === "crackmapexec" || b === "netexec") && /--shares/.test(ep.cmd)) return true;
  return false;
}

/**
 * Enumerated, never audited: an anonymous/null SMB listing succeeded but the shares' permissions
 * were never audited. Mirrors the run's own "next step you skipped" coaching signal.
 */
export function detectEnumNotAudited(report: WatcherReport): GhostDiffItem[] {
  const episodes = report.episodes ?? [];
  const listing = episodes.find(isNullSmbListing);
  if (!listing) return [];
  const audited = episodes.some((e) => e.seq > listing.seq && isShareAudit(e));
  if (audited) return [];
  return [{
    objective: "audit_smb_shares",
    verdict: "skipped",
    unlock_seq: listing.seq,
    actual_seq: null,
    lag_ms: 0,
    note: `An anonymous SMB listing succeeded at step ${listing.seq}, but you never audited the shares' permissions (smbmap / crackmapexec --shares).`,
  }];
}

/** Pure translator: a privesc slow_line + episodes → one late_pivot GhostDiffItem. */
export function slowLineItem(slow: NonNullable<PrivescResult["slow_line"]>, episodes: Episode[]): GhostDiffItem {
  const elapsed = elapsedBySeq(episodes);
  const lag = Math.max(0, (elapsed.get(slow.rooted_seq) ?? 0) - (elapsed.get(slow.available_seq) ?? 0));
  return {
    objective: "escalate_via_confirmed_path",
    verdict: "late_pivot",
    unlock_seq: slow.available_seq,
    actual_seq: slow.rooted_seq,
    lag_ms: lag,
    note: `A confirmed root path (${slow.path.title}) was observable at step ${slow.available_seq}; you rooted at step ${slow.rooted_seq} by a slower route.`,
  };
}

/** Privesc slow-line: adapts analyzePrivesc's slow_line signal into a Ghost item. */
export function detectPrivescSlowLine(report: WatcherReport): GhostDiffItem[] {
  const pr = analyzePrivesc(report);
  return pr.slow_line ? [slowLineItem(pr.slow_line, report.episodes ?? [])] : [];
}

const DETECTORS: ((report: WatcherReport) => GhostDiffItem[])[] = [
  detectCredNotReused,
  detectEnumNotAudited,
  detectPrivescSlowLine,
];

/** All write-up-free signal items for a report (pre-dedupe). */
export function computeSignalGhost(report: WatcherReport): GhostDiffItem[] {
  return DETECTORS.flatMap((d) => d(report));
}
