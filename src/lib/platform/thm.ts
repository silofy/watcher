import type { GoldenObjective, Machine, Target } from "../../types/report";
import type { PlatformAdapter } from "./types";
import { cidrConfidence, hueFor, ipsInScope, type DetectContext } from "./detect";

const DIFF_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = { Info: 1, Easy: 1, Medium: 3, Hard: 4, Insane: 5 };

// Reuse the existing keyword→tactic detectors from the write-up heuristic.
const TACTIC_HINTS: { re: RegExp; tactic: string; tool: string }[] = [
  { re: /\b(nmap|scan|enumerat|recon|port)\b/i, tactic: "TA0007", tool: "nmap" },
  { re: /\b(exploit|shell|access|foothold|smb|upload|rce)\b/i, tactic: "TA0002", tool: "exploit" },
  { re: /\b(cred|password|hash|brute)\b/i, tactic: "TA0006", tool: "credentials" },
  { re: /\b(privilege|privesc|escalat|root|system|suid|sudo)\b/i, tactic: "TA0004", tool: "privesc" },
];

function tacticFor(title: string, body: string): { tactic: string; tool: string } {
  const text = `${title} ${body}`;
  for (const h of TACTIC_HINTS) if (h.re.test(text)) return { tactic: h.tactic, tool: h.tool };
  return { tactic: "TA0002", tool: "manual" };
}

/** Parse a pasted THM room (Task N — Title, followed by body lines) into a linear objective tree. */
export function parseThmTasks(raw: string): GoldenObjective[] {
  const lines = raw.split(/\r?\n/);
  const tasks: { title: string; body: string }[] = [];
  let current: { title: string; body: string } | null = null;
  for (const line of lines) {
    const m = /^\s*Task\s+\d+\b[.:]?\s*(.*)$/i.exec(line);
    if (m) {
      if (current) tasks.push(current);
      current = { title: m[1].trim(), body: "" };
    } else if (current) {
      current.body += " " + line.trim();
    }
  }
  if (current) tasks.push(current);
  if (tasks.length < 2) return []; // not a task list

  const out: GoldenObjective[] = tasks.map((t, i) => {
    const { tactic, tool } = tacticFor(t.title, t.body);
    const objective = (t.title || `task_${i + 1}`).toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "").slice(0, 40) || `task_${i + 1}`;
    return { objective, tactic, satisfied_by: [tool], depends_on: [] };
  });
  for (let i = 1; i < out.length; i++) out[i].depends_on = [out[i - 1].objective];
  return out;
}

export const thmAdapter: PlatformAdapter = {
  id: "thm",
  label: "TryHackMe",
  kindNoun: "room",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "thm") return 1;
    if (/\bthm|tryhackme\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^thm::/i.test(ctx.targetScope ?? "")) return 0.8;
    return cidrConfidence(ctx.targetIps ?? ipsInScope(ctx.targetScope), "thm");
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const ts = ctx.targetScope ?? "room";
    const name = machine?.name ?? ((ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].trim() || ts);
    const label = machine?.difficulty;
    const difficulty = label && DIFF_LEVEL[label] ? { level: DIFF_LEVEL[label], label } : null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return { platform: "thm", kind: "room", name, slug, os: machine?.os, difficulty, emblem: { avatar: null, hue: hueFor(name) }, url: `https://tryhackme.com/room/${slug}` };
  },
  async intendedPath(input) {
    const tree = input.raw ? parseThmTasks(input.raw) : [];
    return tree.length ? tree : null;
  },
};
