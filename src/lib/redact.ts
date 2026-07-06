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
// key=value / key: value credential tokens — mirrors watcher_core::redact so the TS and Rust paths
// scrub the same shapes (a credential must never survive on either side of the seam). Bounded to
// [^\s&]+ (not \S+) so a trailing query param after the secret (e.g. `token=<jwt>&user=admin`)
// survives — the value stops at the next param delimiter, never swallowing the rest of the string.
const SECRET = /\b(password|passwd|pass|secret|token|api[_-]?key)\b\s*[:=]\s*[^\s&]+/gi;
// token shapes — mirrors watcher_core::redact_tokens (crates/core/src/redact.rs) so the TS and
// Rust paths scrub the same credential-bearing shapes in web url/body text.
const BEARER = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;
const JWT = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const API_KEY = /\b(?:sk|pk|ghp|xox[baprs])[_-][A-Za-z0-9_-]{10,}\b/g;

/** Mask only IPv4 addresses — safe to run over arbitrary source (e.g. a JS bundle). */
export function maskIps(text: string): string {
  return text.replace(IPV4, "x.x.x.x");
}

/**
 * The TS peer of watcher_core::redact_body: masks IPs, 32-hex flags, key=value credentials, and
 * credential-shaped tokens (Bearer headers, JWTs, common API-key prefixes), preserving surrounding
 * request shape — param names and delimiters are never masked, only the secret value itself.
 */
export function redactText(text: string): string {
  return maskIps(text)
    .replace(FLAG, "[redacted-flag]")
    .replace(SECRET, (_m, key: string) => `${key}=[redacted]`)
    .replace(BEARER, "Bearer [redacted]")
    .replace(JWT, "[redacted-jwt]")
    .replace(API_KEY, "[redacted-key]");
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
