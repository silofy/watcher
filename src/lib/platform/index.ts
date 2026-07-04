import type { PlatformAdapter } from "./types";
import type { PlatformId, Target, WatcherReport } from "../../types/report";
import { htbAdapter } from "./htb";
import { thmAdapter } from "./thm";
import { offsecAdapter } from "./offsec";
import { immersiveAdapter } from "./immersive";
import { localAdapter } from "./local";
import { ipsInScope, type DetectContext } from "./detect";

export * from "./types";
export * from "./detect";
export { htbAdapter, thmAdapter, offsecAdapter, immersiveAdapter, localAdapter };

// Order matters for ties: HTB before THM so the 10.10.10.x overlap resolves to HTB by default.
export const ADAPTERS: PlatformAdapter[] = [htbAdapter, thmAdapter, offsecAdapter, immersiveAdapter, localAdapter];

/** Look up an adapter by platform id — the seam call sites (e.g. the write-up gate) use to try a
 *  target's native intended-path extraction, if the adapter has one, before falling back to
 *  write-up extraction. Generic over any future adapter; not just HTB/THM. */
export function adapterFor(id: PlatformId): PlatformAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id);
}

/** The human-readable platform name ("Hack The Box", "TryHackMe", …) for a `platform` id — the
 *  label every consumer (rail identity, History rows, Progress rows) surfaces so a run's platform
 *  reads at a glance instead of only living in the raw id. Falls back to the id itself if it's
 *  ever unrecognized, so a future/unknown id still renders something rather than crashing. */
export function platformLabel(id: PlatformId): string {
  return ADAPTERS.find((a) => a.id === id)?.label ?? id;
}

/** Highest detect() confidence wins; localAdapter's 0.1 floor guarantees a winner. */
export function resolveAdapter(ctx: DetectContext): PlatformAdapter {
  const enriched: DetectContext = { ...ctx, targetIps: ctx.targetIps ?? ipsInScope(ctx.targetScope) };
  let best = ADAPTERS[0];
  let bestScore = -1;
  for (const a of ADAPTERS) {
    const s = a.detect(enriched);
    if (s > bestScore) { bestScore = s; best = a; }
  }
  return best;
}

/** Neutral target identity for a report: an explicit session.target wins, otherwise it's resolved
 *  from the platform adapters (session.machine's presence is itself an HTB signal). */
export function targetOf(report: WatcherReport): Target {
  if (report.session.target) return report.session.target;
  const s = report.session;
  const ctx: DetectContext = {
    targetScope: s.target_scope,
    contextPath: s.context_path,
    platformHint: s.machine ? "htb" : undefined,
  };
  return resolveAdapter(ctx).identify(s.machine, ctx);
}
