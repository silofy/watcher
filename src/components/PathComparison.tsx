import type { ReactNode } from "react";
import { useReport } from "../store/report";
import { Section, tierColor } from "./ui";
import { PathGraph } from "./PathGraph";
import { humanizeObjective } from "../lib/audits";
import { isLiveRecording } from "../lib/live";
import type { Episode, GoldenObjective } from "../types/report";
import { Check, Circle, Flag } from "./icons";

const LEGEND: [ReactNode, string, string][] = [
  [<Check key="did" size={12} />, "did", "var(--color-match)"],
  ["~", "alt method", "var(--color-alt)"],
  ["⤺", "out of order", "var(--color-stuck)"],
  [<Circle key="skipped" size={12} />, "skipped", "var(--color-skipped)"],
  [<Flag key="flag" size={12} />, "flag captured", "var(--color-flag)"],
];

/** An objective's outcome vs the intended path: skipped (never satisfied), or the alignment of the
 *  step that satisfied it (match / alternative / out_of_order). */
function statusOf(o: GoldenObjective, epBySeq: Map<number, Episode>): string {
  const seq = o.user_satisfied_by_seq ?? null;
  return seq == null ? "skipped" : epBySeq.get(seq)?.alignment ?? "match";
}

function Count({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <span className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ color, backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}>
      {n} {label}
    </span>
  );
}

export function PathComparison({ num }: { num?: string } = {}) {
  const { report } = useReport();
  const recording = isLiveRecording(report);
  const coverage = Math.round(report.metrics.objective_coverage_pct);
  const golden = report.golden_dag;
  const epBySeq = new Map(report.episodes.map((e) => [e.seq, e]));

  const skipped = golden.filter((o) => statusOf(o, epBySeq) === "skipped");
  const outOfOrder = golden.filter((o) => statusOf(o, epBySeq) === "out_of_order");
  const alt = golden.filter((o) => statusOf(o, epBySeq) === "alternative");
  const deviations = skipped.length + outOfOrder.length + alt.length;
  const matched = golden.length - deviations;

  return (
    <Section
      dataShot="path"
      num={num}
      title="What you'd do differently"
      subtitle="the intended write-up path vs your route"
      right={
        recording ? (
          <span className="label" style={{ color: "var(--color-loud)" }}>
            <span className="animate-pulse">●</span> recording
          </span>
        ) : null
      }
    >
      {recording ? (
        <p className="text-sm text-faint">
          The intended-path comparison unlocks when the run finishes — grading your route against the writeup needs the whole session.
        </p>
      ) : golden.length === 0 ? (
        <p className="text-sm text-faint">
          Add a <span className="text-fg">writeup reference</span> at the top of the debrief to unlock the intended-path comparison.
        </p>
      ) : (
        <>
          {/* the answer up front — how closely the run retraced the write-up's intended steps, in
              plain words, before the counts or the graph. This is the same objective_coverage_pct
              that used to be a small "{n}% coverage" tucked in the header corner. */}
          <div className="mb-3 rounded-lg border border-edge bg-panel-2/30 p-3">
            <p className="text-sm leading-snug text-fg">
              You followed <span className="mono text-base font-semibold tabular-nums" style={{ color: tierColor(coverage) }}>{coverage}%</span> of the
              write-up&rsquo;s intended path
            </p>
            <p className="mt-0.5 text-xs text-faint">objectives reached vs. its total — how closely you retraced its intended steps, in its intended order.</p>

            <div className="mt-2.5 flex flex-wrap items-center gap-2 border-t border-edge/60 pt-2.5">
              <Count n={matched} label="matched" color="var(--color-match)" />
              {alt.length > 0 && <Count n={alt.length} label="alt method" color="var(--color-alt)" />}
              {outOfOrder.length > 0 && <Count n={outOfOrder.length} label="out of order" color="var(--color-stuck)" />}
              {skipped.length > 0 && <Count n={skipped.length} label="skipped" color="var(--color-skipped)" />}
            </div>

            {deviations === 0 ? (
              <p className="mt-2.5 flex items-center gap-1.5 text-sm text-match">
                <Check size={14} /> You followed the intended path — nothing to change.
              </p>
            ) : (
              <>
                {skipped.length > 0 && (
                  <ul className="mt-2.5 space-y-1">
                    {skipped.map((o) => (
                      <li key={o.objective} className="flex flex-wrap items-center gap-x-2 text-sm">
                        <Circle size={12} className="shrink-0" style={{ color: "var(--color-skipped)" }} />
                        <span className="text-fg">{humanizeObjective(o.objective)}</span>
                        <span className="ml-auto shrink-0 text-xs text-faint">
                          try <span className="mono text-muted">{o.satisfied_by[0]}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {skipped.length === 0 && (
                  <p className="mt-2.5 text-xs text-faint">You hit every objective — some by a different route or order. See the graph for where.</p>
                )}
              </>
            )}
          </div>

          <PathGraph />
          {/* legend reads as the chart's caption, below the canvas */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            {LEGEND.map(([icon, label, c]) => (
              <span key={label} className="flex items-center gap-1.5">
                <span style={{ color: c }}>{icon}</span>
                {label}
              </span>
            ))}
            <span className="ml-auto">top → bottom · intended path on the left, deviations on the right · click to inspect</span>
          </div>
        </>
      )}
    </Section>
  );
}
