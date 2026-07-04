import { useEffect, useState } from "react";
import { useReport } from "../store/report";
import { refinedNotes, verdictMeta } from "../lib/ghost/ghost-view";
import { narrateGhost } from "../lib/ghost/narrate";
import type { GhostDiffItem, GhostResult } from "../lib/ghost/ghost";
import { resolveProvider } from "../lib/llm";
import { humanizeObjective } from "../lib/audits";
import { fmtMinutes } from "../lib/format";
import { Chip } from "./ui";

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

  const wins = ghost?.human_wins ?? 0;
  const lostMs = ghost?.time_lost_ms ?? 0;

  return (
    <div className="flex flex-col gap-3" data-shot="ghost">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {wins > 0 && (
          <p className="text-sm font-medium" style={{ color: "var(--color-match)" }}>
            You beat the optimal line {wins}× — the write-up didn't see that coming.
          </p>
        )}
        {lostMs > 0 && (
          <p className="text-sm text-faint">
            <span className="mono text-fg">{fmtMinutes(lostMs)}</span> lost to late pivots.
          </p>
        )}
        {wins === 0 && lostMs === 0 && <p className="text-sm text-faint">You tracked the optimal line step for step.</p>}
      </div>

      <ul className="flex flex-col gap-1">
        {items.map((it) => {
          const meta = verdictMeta(it.verdict);
          const seq = it.actual_seq ?? it.unlock_seq;
          const refined = narrated.get(it.objective);
          const note = refined ?? it.note;
          const body = (
            <>
              <Chip color={meta.tone}>{meta.label}</Chip>
              <span className="text-xs text-muted">{humanizeObjective(it.objective)}</span>
              {note && <span className="text-sm text-fg">{note}</span>}
              {refined && <span className="label rounded bg-signal/20 px-1.5 text-xs text-signal">ai</span>}
            </>
          );
          return (
            <li key={it.objective}>
              {seq != null ? (
                <button
                  type="button"
                  onClick={() => reveal(seq)}
                  className="flex w-full flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded px-1.5 py-1 text-left transition-colors hover:bg-panel-2/60"
                  title={`jump to step #${seq}`}
                >
                  {body}
                </button>
              ) : (
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-1.5 py-1">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
