/**
 * Fold a captured SSH session into the pipeline as on-target commands. The tap (`script` via the
 * injected `ssh()` function) writes the session's input log; this turns it into `RawCommand`s tagged
 * with an `ssh:<target>` provenance so the classifier reads them as post-exploitation, not local recon.
 *
 * Re-redaction is mandatory here (brief: never trust an upstream's scrubbing) — the transcript will
 * carry flags, hashes, and internal IPs. NOTE: pattern redaction masks IPs and flag-shaped tokens, not
 * arbitrary interactively-typed passwords; a `--log-in` tap can capture those, so a production version
 * should prefer command-boundary capture (remote OSC-133) or a secret-prompt scrubber over raw stdin.
 */
import type { RawCommand } from "../pipeline/types";
import { redactText } from "../redact";
import { parseScriptInputLog } from "./parse";

/** The target host from an `ssh [opts] user@host` / `ssh host` command, or null if not an ssh line. */
export function sshTargetOf(cmd: string): string | null {
  const m = cmd.match(/^\s*(?:sshpass\s+[^\s]+\s+)?ssh\b[^\n]*?(?:(\S+)@)?(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9.-]+\.[a-z]{2,}|[a-z0-9-]+)\s*$/i);
  return m ? m[2] : null;
}

export interface SshIngestOptions {
  /** target host label for the provenance chain (e.g. "10.10.10.5"). */
  target: string;
  /** wall-clock ms of the session start (from `--log-timing` or the session file). */
  startedAtMs: number;
  /** spacing between commands when precise timing isn't supplied (spike default). */
  stepMs?: number;
}

/**
 * Parse a `--log-in` transcript into on-target RawCommands. Timestamps are synthetic here (evenly
 * spaced); a production version threads `--log-timing` for real gaps. Every command is re-redacted.
 */
export function ingestSshSession(inputLog: string, opts: SshIngestOptions): RawCommand[] {
  const step = opts.stepMs ?? 1000;
  const contextPath = `host->ssh:${opts.target}`;
  return parseScriptInputLog(inputLog).map((cmd, i) => {
    const started = opts.startedAtMs + i * step;
    return {
      cmd: redactText(cmd),
      started_at_ms: started,
      ended_at_ms: started, // no per-command duration from a plain input log
      exit_code: null, // a transcript has no $? — see module note
      output_line_count: 0,
      context_path: contextPath,
    } satisfies RawCommand;
  });
}
