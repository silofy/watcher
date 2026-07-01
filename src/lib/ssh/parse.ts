/**
 * Parse a `script --log-in` transcript (raw keystrokes of an interactive session) into the command
 * lines that were run. This is the zero-remote-footprint tap for SSH sessions: `script` records the
 * PTY without hooks, and the input log is the cleanest command source (the output stream is polluted
 * by prompts, colors, and TUIs). Commands are split on Enter; readline editing is replayed.
 *
 * Fidelity caveats (spike): tab-completed text comes from the remote echo, not stdin, so completions
 * are missed; and a raw keystroke log CAN contain interactively-typed secrets (sudo/ssh passwords).
 * The ingester re-redacts, but pattern redaction won't catch an arbitrary password — see ingest.ts.
 */

// CSI sequences (arrow keys, cursor moves from readline) and other single-char escapes.
const CSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g;
const ESC = /\x1b[@-Z\\-_]/g;

/** Replay one raw input line: strip escapes, apply backspaces, drop other control chars. */
function replayLine(raw: string): string {
  const stripped = raw.replace(CSI, "").replace(ESC, "");
  const buf: string[] = [];
  for (const ch of stripped) {
    if (ch === "\x7f" || ch === "\x08") buf.pop(); // DEL / BS
    else if (ch === "\t") buf.push(" "); // tab → space (completion text isn't in stdin anyway)
    else if (ch >= " ") buf.push(ch); // printable
    // all other control chars dropped
  }
  return buf.join("").replace(/\s+$/g, "").trim();
}

/** Command lines from a `--log-in` transcript, in order. Aborted (Ctrl-C) lines are dropped. */
export function parseScriptInputLog(raw: string): string[] {
  const out: string[] = [];
  for (const segment of raw.split(/\r\n|\r|\n/)) {
    if (segment.includes("\x03")) continue; // Ctrl-C — line aborted, never executed
    const cmd = replayLine(segment);
    if (cmd) out.push(cmd);
  }
  return out;
}

// Alternate-screen enter/leave — how vim/less/top/man/nano/htop take over and release the terminal.
const ALT_ENTER = /\x1b\[\?(?:1049|1047|47)h/g;
const ALT_LEAVE = /\x1b\[\?(?:1049|1047|47)l/g;
const TIMING_LINE = /^([IO])\s+[\d.]+\s+(\d+)/;

/**
 * Remove keystrokes typed inside a full-screen program from the input transcript. Uses the
 * `--log-timing` interleave to walk input/output in order and track the alternate-screen buffer;
 * keystrokes typed while the output is in alt-screen mode are program input (vim/less/top/man/nano),
 * not shell commands, so parsing them yields junk episodes. Without the output+timing logs the input
 * is returned unchanged (documented weakness). Byte counts are approximated as UTF-16 units — exact
 * for ASCII shell/TUI sessions.
 */
export function stripInteractiveInput(inputLog: string, outputLog?: string, timingLog?: string): string {
  if (!outputLog || !timingLog) return inputLog;
  let inPos = 0;
  let outPos = 0;
  let alt = 0;
  let kept = "";
  for (const line of timingLog.split(/\r?\n/)) {
    const m = line.match(TIMING_LINE);
    if (!m) continue;
    const n = parseInt(m[2], 10);
    if (m[1] === "O") {
      const chunk = outputLog.slice(outPos, outPos + n);
      outPos += n;
      alt += (chunk.match(ALT_ENTER) ?? []).length;
      alt -= (chunk.match(ALT_LEAVE) ?? []).length;
      if (alt < 0) alt = 0;
    } else {
      const chunk = inputLog.slice(inPos, inPos + n);
      inPos += n;
      if (alt === 0) kept += chunk; // only keystrokes typed at the shell, not inside a TUI
    }
  }
  return kept;
}
