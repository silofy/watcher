import { useEffect, useState } from "react";
import { useReport } from "../store/report";
import { refinedNotes } from "../lib/ghost/ghost-view";
import { narrateGhost } from "../lib/ghost/narrate";
import type { GhostDiffItem, GhostResult } from "../lib/ghost/ghost";
import { resolveProvider } from "../lib/llm";
import { ghostHeadline, verdictCounts, VERDICT, VERDICT_ORDER } from "../lib/ghost/headline";
import { PivotStrip } from "./PivotStrip";
import { TallyKey } from "./ui";
import { ditherMask } from "../lib/dither";

/** "You vs. the Ghost" — the counterfactual "optimal-from-your-state" comparison (schema v1.4).
 *  Leads with human wins (ahead / off-path captures) before the time lost to late pivots, then a
 *  per-objective breakdown deep-linking back into the timeline. Self-contained: renders nothing
 *  when the report carries no golden tree (`report.ghost` absent).
 *
 *  Notes are deterministic by default; if a local/cloud model is configured (same opt-in path as
 *  the per-step coaching in DeviationTimeline), `narrateGhost` sharpens them post-hoc — a rules-only
 *  setup (NullProvider) never changes what's rendered. */
export function GhostCard() {
  const ghost = useReport((s) => s.report.ghost);
  const reveal = useReport((s) => s.reveal);
  const total = useReport((s) => s.report.episodes.length);
  const items = ghost?.items ?? [];
  const [narrated, setNarrated] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let alive = true;
    setNarrated(new Map());
    if (!items.length) return;
    (async () => {
      const provider = await resolveProvider();
      // GhostItem's fields are optional (schema round-trip); GhostDiffItem requires them — fill the
      // same defaults computeGhost itself uses, so nothing here changes what narrateGhost reads.
      const diffItems: GhostDiffItem[] = items.map((it) => ({
        objective: it.objective,
        verdict: it.verdict,
        unlock_seq: it.unlock_seq ?? null,
        actual_seq: it.actual_seq ?? null,
        lag_ms: it.lag_ms ?? 0,
        note: it.note ?? "",
      }));
      const base: GhostResult = { time_lost_ms: ghost?.time_lost_ms ?? 0, human_wins: ghost?.human_wins ?? 0, items: diffItems };
      const out = await narrateGhost(base, provider);
      if (!alive) return;
      const m = refinedNotes(base, out);
      if (m.size) setNarrated(m);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length, ghost?.time_lost_ms, ghost?.human_wins]);

  if (!items.length) return null;

  const head = ghostHeadline(items);
  const counts = verdictCounts(items);

  return (
    <div className="flex flex-col gap-[18px]" data-shot="ghost">
      <p className="max-w-[60ch] text-[17px] font-semibold leading-snug text-fg">
        {head.kind === "pivots" ? (
          <>
            {head.count} of {head.total} objectives were reachable from <span className="text-loud">step {head.unlockSeq}</span>. You worked through them one at a time until step{" "}
            {head.lastSeq}.
          </>
        ) : (
          "You stayed on the optimal line."
        )}
      </p>
      <div>
        <div className="flex h-2.5 gap-0.5" aria-hidden="true">
          {VERDICT_ORDER.filter((k) => counts[k]).map((k) => (
            <i key={k} style={{ flex: counts[k], background: VERDICT[k].color, ...ditherMask() }} />
          ))}
        </div>
        <TallyKey items={VERDICT_ORDER.map((k) => ({ label: VERDICT[k].label, count: counts[k], color: VERDICT[k].color }))} />
      </div>
      <PivotStrip items={items} total={total} notes={narrated} onReveal={reveal} />
    </div>
  );
}
