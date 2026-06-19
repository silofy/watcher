/**
 * Flag-capture detection — the milestones of a box. A flag is captured when a flag file is read
 * (user.txt / root.txt / local.txt / proof.txt …), optionally confirmed by a flag-shaped value in
 * the output. Telemetry-derived and deterministic: no write-up reference needed, unlike the
 * golden-DAG objectives. The daemon redacts the flag itself, so we key off the read, not the value.
 */
import type { Episode } from "../types/report";

export interface FlagStatus {
  /** seq of the step that captured the user flag (or implied it), null if none seen. */
  user: number | null;
  /** seq of the step that captured the system/root flag, null if none seen. */
  system: number | null;
  /** every flag-capture step, in order. */
  events: { seq: number; kinds: ("user" | "system")[]; cmd: string }[];
}

const READ = /\b(cat|type|more|less|head|tail|nl|strings|gc|get-content|powershell|xxd|base64)\b/i;
const USER_FILE = /\b(user|local)\.txt\b/i;
const ROOT_FILE = /\b(root|proof|system)\.txt\b/i;
// a redacted flag, a raw 32-hex, or an explicit "flag captured" note in the cleaned output
const FLAGGY_OUT = /\[redacted-flag\]|flags?\s+captured|\b[0-9a-f]{32}\b/i;

export function detectFlags(episodes: Episode[]): FlagStatus {
  let user: number | null = null;
  let system: number | null = null;
  const events: FlagStatus["events"] = [];

  for (const e of episodes) {
    const cmd = e.cmd ?? "";
    const out = e.output_digest ?? "";
    const readsUser = USER_FILE.test(cmd);
    const readsRoot = ROOT_FILE.test(cmd);
    if (!readsUser && !readsRoot) continue;
    // confirm it's actually a read (not a write/mention), or that a flag value showed up
    if (!READ.test(cmd) && !FLAGGY_OUT.test(out)) continue;

    const kinds: ("user" | "system")[] = [];
    if (readsUser && user == null) {
      user = e.seq;
      kinds.push("user");
    }
    if (readsRoot && system == null) {
      system = e.seq;
      kinds.push("system");
    }
    if (kinds.length) events.push({ seq: e.seq, kinds, cmd });
  }

  return { user, system, events };
}
