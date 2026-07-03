import type { PlatformAdapter } from "./types";
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
