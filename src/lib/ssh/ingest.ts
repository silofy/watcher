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
import { parseScriptInputLog, stripInteractiveInput } from "./parse";

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
  /** the session's `--log-out` transcript, used to scrub un-echoed input (typed secrets). */
  outputLog?: string;
  /** the session's `--log-timing` transcript, used to drop keystrokes typed inside a full-screen TUI. */
  timingLog?: string;
}

const ANSI_ALL = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]/g;

/**
 * Drop typed lines that were never echoed to the output — the terminal echoes every command as you
 * type it, but a password at a no-echo prompt (sudo/ssh/su) is not echoed. So an input line absent
 * from the output stream is a secret or a program-prompt response, never a shell command: exclude it
 * before it can become an episode or reach the store. Without an output log we can't judge, so we
 * keep everything (documented weakness — pair the `.out` file to enable scrubbing).
 */
export function scrubUnechoed(commands: string[], outputLog?: string): string[] {
  if (!outputLog) return commands;
  const echoed = outputLog.replace(ANSI_ALL, "");
  return commands.filter((c) => {
    const needle = c.trim();
    // a real command is echoed verbatim; a secret isn't. Very short tokens are kept (not secrets,
    // and reliably echoed as part of normal output).
    return needle.length < 3 || echoed.includes(needle);
  });
}

/** One file the capture tap wrote under ~/.watcher/ssh (an `<id>.in` transcript or `<id>.meta`). */
export interface SshLogFile {
  name: string;
  content: string;
}

/**
 * Turn the tap's `~/.watcher/ssh` files into session inputs. Each `<id>.in` transcript is paired with
 * its `<id>.meta` sidecar (JSON: target, startedAtMs) written by watcher-ssh.sh. Missing meta degrades
 * gracefully — the provenance still marks it on-target, it just loses the host label and precise time.
 */
export function sshSessionsFromDir(files: SshLogFile[]): Array<SshIngestOptions & { inputLog: string }> {
  const meta = new Map<string, { target?: string; startedAtMs?: number }>();
  const outLog = new Map<string, string>();
  const tmLog = new Map<string, string>();
  for (const f of files) {
    const metaM = f.name.match(/^(.*)\.meta$/);
    if (metaM) {
      try {
        meta.set(metaM[1], JSON.parse(f.content));
      } catch {
        /* ignore a malformed sidecar */
      }
    }
    const outM = f.name.match(/^(.*)\.out$/);
    if (outM) outLog.set(outM[1], f.content);
    const tmM = f.name.match(/^(.*)\.tm$/);
    if (tmM) tmLog.set(tmM[1], f.content);
  }
  const out: Array<SshIngestOptions & { inputLog: string }> = [];
  for (const f of files) {
    const m = f.name.match(/^(.*)\.in$/);
    if (!m || !f.content.trim()) continue;
    const meta_ = meta.get(m[1]) ?? {};
    out.push({
      inputLog: f.content,
      outputLog: outLog.get(m[1]),
      timingLog: tmLog.get(m[1]),
      target: meta_.target ?? "target",
      startedAtMs: meta_.startedAtMs ?? 0,
    });
  }
  return out.sort((a, b) => a.startedAtMs - b.startedAtMs);
}

/**
 * Parse a `--log-in` transcript into on-target RawCommands. Timestamps are synthetic here (evenly
 * spaced); a production version threads `--log-timing` for real gaps. Every command is re-redacted.
 */
export function ingestSshSession(inputLog: string, opts: SshIngestOptions): RawCommand[] {
  const step = opts.stepMs ?? 1000;
  const contextPath = `host->ssh:${opts.target}`;
  // 1) drop keystrokes typed inside a full-screen TUI (vim/less/top), 2) drop un-echoed secrets.
  const shellInput = stripInteractiveInput(inputLog, opts.outputLog, opts.timingLog);
  const commands = scrubUnechoed(parseScriptInputLog(shellInput), opts.outputLog);
  return commands.map((cmd, i) => {
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
