import { useState, type ReactNode } from "react";
import { useReport } from "../store/report";
import { Section, Tag, TallyKey } from "./ui";
import { PathGraph } from "./PathGraph";
import { humanizeObjective } from "../lib/audits";
import { isLiveRecording } from "../lib/live";
import { ditherMask, ditherTrack } from "../lib/dither";
import { routeSteps, routeCounts, type RouteStep, type RouteStatus } from "../lib/route";
import { Check, Circle, Flag } from "./icons";

const LEGEND: [ReactNode, string, string][] = [
  [<Check key="did" size={12} />, "did", "var(--color-match)"],
  ["~", "alt method", "var(--color-alt)"],
  ["⤺", "out of order", "var(--color-stuck)"],
  [<Circle key="skipped" size={12} />, "skipped", "var(--color-skipped)"],
  [<Flag key="flag" size={12} />, "flag captured", "var(--color-flag)"],
];

const ROUTE: Record<RouteStatus, { color: string; label: string }> = {
  match: { color: "var(--color-match)", label: "Matched" },
  alternative: { color: "var(--color-alt)", label: "Alt method" },
  out_of_order: { color: "var(--color-stuck)", label: "Out of order" },
  skipped: { color: "var(--color-skipped)", label: "Skipped" },
};
const ROUTE_ORDER: RouteStatus[] = ["match", "alternative", "out_of_order", "skipped"];

/** The intended path as one row of cells: where your route differed, at a glance. */
function RouteBar({ steps }: { steps: RouteStep[] }) {
  const counts = routeCounts(steps);
  return (
    <div>
      <div className="grid h-[22px] gap-[3px]" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s) => (
          <span
            key={s.objective}
            title={`${humanizeObjective(s.objective)} · ${ROUTE[s.status].label}${s.seq != null ? ` · step ${s.seq}` : ""}`}
            style={s.status === "skipped" ? { ...ditherTrack(0.3), border: "1px dashed var(--color-skipped)" } : { background: ROUTE[s.status].color, ...ditherMask() }}
          />
        ))}
      </div>
      <div className="label mt-[7px] flex justify-between">
        <span>Write-up step 1</span>
        <span>Step {steps.length}</span>
      </div>
      <TallyKey items={ROUTE_ORDER.map((k) => ({ label: ROUTE[k].label, count: counts[k], color: ROUTE[k].color }))} />
    </div>
  );
}

function fixText(s: RouteStep): ReactNode {
  if (s.status === "skipped")
    return s.suggestion ? (
      <>
        Never attempted · try <code className="mono ml-1 text-signal">{s.suggestion}</code>
      </>
    ) : (
      "Never attempted"
    );
  if (s.status === "out_of_order") return `Done at step ${s.seq}, earlier than the write-up's order`;
  return (
    <>
      Done at step {s.seq} with <code className="mono ml-1 text-signal">{s.binary ?? "another tool"}</code>
    </>
  );
}

/** Only the deviations, one ruled row each: the section's actual answer. */
function ChangeList({ steps }: { steps: RouteStep[] }) {
  const dev = steps.filter((s) => s.status !== "match");
  return (
    <div>
      <div className="label mb-2.5">Change next time</div>
      {dev.length === 0 ? (
        <p className="border-y border-edge py-3 text-[15px] font-semibold text-signal">You followed the intended path. Nothing to change.</p>
      ) : (
        <ul className="border-b border-edge">
          {dev.map((s) => (
            <li key={s.objective} className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-4 gap-y-1 border-t border-edge py-3 sm:grid-cols-[110px_minmax(0,1fr)_auto]">
              <span className="justify-self-start">
                <Tag color={ROUTE[s.status].color}>{ROUTE[s.status].label}</Tag>
              </span>
              <span className="text-[15px] font-semibold text-fg">{humanizeObjective(s.objective)}</span>
              <span className="col-start-2 text-[13px] text-muted sm:col-start-auto">{fixText(s)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PathComparison({ num }: { num?: string } = {}) {
  const { report } = useReport();
  const recording = isLiveRecording(report);
  const coverage = Math.round(report.metrics.objective_coverage_pct);
  const golden = report.golden_dag;
  const [mapOpen, setMapOpen] = useState(false);
  const steps = routeSteps(golden, report.episodes);

  return (
    <Section
      dataShot="path"
      num={num}
      title="What you'd do differently"
      subtitle="the intended write-up path vs your route"
      lead={golden.length && !recording ? { value: coverage, unit: "%", caption: "of the write-up's path followed" } : undefined}
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
        <div className="flex flex-col gap-[22px]">
          <RouteBar steps={steps} />
          <ChangeList steps={steps} />
          <button
            type="button"
            aria-expanded={mapOpen}
            onClick={() => setMapOpen((o) => !o)}
            className="flex h-11 w-full items-center justify-center rounded-[3px] border border-edge-bright font-mono text-[11.5px] font-medium uppercase tracking-[0.16em] text-muted transition-colors hover:border-muted hover:bg-panel hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
          >
            {mapOpen ? "Hide path map ↑" : "Show full path map ↓"}
          </button>
          {mapOpen && (
            <div>
              <PathGraph />
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                {LEGEND.map(([icon, label, c]) => (
                  <span key={label} className="flex items-center gap-1.5">
                    <span style={{ color: c }}>{icon}</span>
                    {label}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
