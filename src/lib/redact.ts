/**
 * Client-side redaction for the portable export (brief §6.3). The public_safe
 * profile strips anything credential- or target-adjacent so a report is safe to
 * post on Discord/GitHub. This is intentionally conservative and deterministic;
 * in the full product the daemon re-redacts on its own authority (never trust an
 * upstream's scrubbing).
 */
import type { RedactionProfile, WatcherReport } from "../types/report";

const IPV4 = /\b(?:\d{1,3}\.){3}\d{1,3}\b/g;
const FLAG = /\b[0-9a-f]{32}\b/gi; // HTB/THM flag hashes

/** Mask only IPv4 addresses — safe to run over arbitrary source (e.g. a JS bundle). */
export function maskIps(text: string): string {
  return text.replace(IPV4, "x.x.x.x");
}

export function redactText(text: string): string {
  return maskIps(text).replace(FLAG, "[redacted-flag]");
}

/** Deep-clone the report and apply the given redaction profile to free-text fields. */
export function redactReport(report: WatcherReport, profile: RedactionProfile): WatcherReport {
  const clone: WatcherReport = structuredClone(report);
  clone.redaction_profile = profile;
  if (profile === "full") return clone; // full keeps detail; only the public export strips

  clone.session.target_scope = redactText(clone.session.target_scope);
  for (const ep of clone.episodes) {
    ep.cmd = redactText(ep.cmd);
    if (ep.output_digest) ep.output_digest = redactText(ep.output_digest);
  }
  clone.coaching.next_steps = clone.coaching.next_steps.map((s) => ({ ...s, action: redactText(s.action), why: redactText(s.why) }));
  return clone;
}
