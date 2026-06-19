/** Machine identity helpers — the HTB box (name/os/difficulty/avatar) that anchors a report. */
import type { WatcherReport } from "../types/report";

export interface MachineMeta {
  name: string;
  os?: string;
  difficulty?: string;
  avatar?: string | null;
  retired?: boolean;
  local?: boolean; // not an HTB box — a local/plain capture
}

/** Resolve the machine from session.machine, falling back to parsing the target scope. */
export function machineOf(report: WatcherReport): MachineMeta {
  const m = report.session.machine;
  if (m?.name) {
    return { name: m.name, os: m.os, difficulty: m.difficulty, avatar: m.avatar, retired: m.retired };
  }
  const ts = report.session.target_scope ?? "session";
  if (/live capture|local/i.test(ts)) return { name: ts.replace(/\s*\(.*\)\s*/, "").trim() || "Local capture", local: true };
  const name = (ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].split("—")[0].trim() || ts;
  const difficulty = /\beasy\b/i.test(ts) ? "Easy" : /\bmedium\b/i.test(ts) ? "Medium" : /\bhard\b/i.test(ts) ? "Hard" : /\binsane\b/i.test(ts) ? "Insane" : undefined;
  return { name, difficulty };
}

/** Deterministic hue (0–360) seeded from a string, for the generated emblem. */
export function hueFor(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) >>> 0;
  return h % 360;
}

export const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: "var(--color-match)",
  Medium: "var(--color-signal)",
  Hard: "var(--color-detour)",
  Insane: "var(--color-skipped)",
};
