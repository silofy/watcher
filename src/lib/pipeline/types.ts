/**
 * Phase 3 — deterministic processing pipeline (brief §4).
 *
 * Input is the normalized telemetry the capture layer produces (§3.3); the pipeline
 * turns it into the episode/phase/alignment shape the report contract consumes. Every
 * stage here is deterministic — the LLM (not implemented in this phase) only ever
 * refines these priors, it never replaces them.
 */

/**
 * A single joined command record: shell-hook command boundaries (cmd, cwd, exit)
 * joined by timestamp to its VT-parsed output digest (§3.1). Absolute ms timestamps;
 * think-time is derived from the gap between consecutive commands.
 */
export interface RawCommand {
  cmd: string;
  started_at_ms: number;
  ended_at_ms: number;
  exit_code: number | null;
  /** line count of captured output — a machine-bound signal (§4.1). */
  output_line_count: number;
  output_digest?: string;
  context_path?: string;
  /** request/volume count for the noise metric, when known (e.g. gobuster reqs). */
  volume?: number;
  /** present when this record is an HTTP exchange rather than a shell command. */
  web?: WebExchange;
}

/** A joined HTTP request/response, the web analogue of RawCommand's shell hook. */
export interface WebExchange {
  method: string;
  url: string;
  req_body?: string;
  status?: number;
  resp_body?: string;
  mime?: string;
}

export interface SegmentConfig {
  /** Gap above which the operator is assumed to have walked away — excluded from analytics. */
  idleGapMs: number;
  /** Gap above which a standalone think_pause episode is emitted (break on long pause, §4.1). */
  thinkPauseSplitMs: number;
  /** A command is machine_bound only if it ran at least this long. */
  machineBoundMinDurationMs: number;
  /** ...and either used a scanning binary or produced at least this many output lines. */
  machineBoundMinLines: number;
  /** Binaries that grind (scanners/brute/enumeration) — the machine-bound signal. */
  scanningBinaries: Set<string>;
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  idleGapMs: 1_800_000, // 30 min → idle
  thinkPauseSplitMs: 300_000, // 5 min → its own think_pause episode
  machineBoundMinDurationMs: 20_000, // 20 s
  machineBoundMinLines: 500,
  scanningBinaries: new Set([
    "nmap",
    "rustscan",
    "masscan",
    "gobuster",
    "ffuf",
    "feroxbuster",
    "dirb",
    "wfuzz",
    "nikto",
    "hydra",
    "sqlmap",
    "pspy",
    "pspy64",
    "linpeas",
    "linpeas.sh",
    "linux-exploit-suggester",
  ]),
};

/** First-token binary extraction, stripping any directory and keeping `sudo` as the binary. */
export function extractBinary(cmd: string): string {
  const trimmed = cmd.trim();
  if (!trimmed) return "";
  // skip leading env assignments like FOO=bar cmd
  const tokens = trimmed.split(/\s+/).filter((t) => !/^[A-Z_][A-Z0-9_]*=/.test(t));
  const first = tokens[0] ?? "";
  // strip directory and any path prefix (/tmp/lp.sh -> lp.sh, ./x -> x)
  const base = first.replace(/^.*[\\/]/, "");
  return base;
}
