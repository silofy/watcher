/** Machine identity helpers — a thin legacy shim over the neutral platform/Target identity. */
import type { WatcherReport } from "../types/report";
import { targetOf } from "./platform";

export interface MachineMeta {
  name: string;
  os?: string;
  difficulty?: string;
  avatar?: string | null;
  retired?: boolean;
  local?: boolean; // not an HTB box — a local/plain capture
}

/**
 * @deprecated use `targetOf()` from `../lib/platform` instead. Retained so un-migrated callers keep
 * working; down-maps the neutral Target to the old HTB-shaped MachineMeta. `retired` is read straight
 * off `session.machine` since Target (schema v1.2) doesn't carry it.
 */
export function machineOf(report: WatcherReport): MachineMeta {
  const t = targetOf(report);
  return {
    name: t.name,
    os: t.os,
    difficulty: t.difficulty?.label,
    avatar: t.emblem?.avatar ?? null,
    retired: report.session.machine?.retired,
    local: t.platform === "local",
  };
}

/** Re-exported so existing `hueFor` consumers of this module keep working — the real definition now
 *  lives in platform/detect.ts (a pure string→hue helper the adapters also need). */
export { hueFor } from "./platform/detect";

export const DIFFICULTY_COLOR: Record<string, string> = {
  Easy: "var(--color-match)",
  Medium: "var(--color-signal)",
  Hard: "var(--color-detour)",
  Insane: "var(--color-skipped)",
};
