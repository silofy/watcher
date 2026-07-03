import { useReport } from "../store/report";
import { verdictMeta } from "../lib/ghost/ghost-view";
import { humanizeObjective } from "../lib/audits";
import { fmtMinutes } from "../lib/format";
import { Chip } from "./ui";

/** "You vs. the Ghost" — the counterfactual "optimal-from-your-state" comparison (schema v1.4).
 *  Leads with human wins (ahead / off-path captures) before the time lost to late pivots, then a
 *  per-objective breakdown deep-linking back into the timeline. Self-contained: renders nothing
 *  when the report carries no golden tree (`report.ghost` absent). */
export function GhostCard() {
  const ghost = useReport((s) => s.report.ghost);
  const reveal = useReport((s) => s.reveal);
  const items = ghost?.items ?? [];
  if (!items.length) return null;

  const wins = ghost?.human_wins ?? 0;
  const lostMs = ghost?.time_lost_ms ?? 0;

  return (
    <div className="flex flex-col gap-3">
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
          const body = (
            <>
              <Chip color={meta.tone}>{meta.label}</Chip>
              <span className="text-xs text-muted">{humanizeObjective(it.objective)}</span>
              {it.note && <span className="text-sm text-fg">{it.note}</span>}
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
