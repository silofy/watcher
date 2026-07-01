import { useReport } from "../store/report";
import { Section, tierColor } from "./ui";
import { PathGraph } from "./PathGraph";

const LEGEND: [string, string][] = [
  ["✓ did", "var(--color-match)"],
  ["~ alt method", "var(--color-alt)"],
  ["⤺ out of order", "var(--color-stuck)"],
  ["○ skipped", "var(--color-skipped)"],
  ["⚑ flag captured", "var(--color-flag)"],
];

export function PathComparison() {
  const { report } = useReport();
  const coverage = Math.round(report.metrics.objective_coverage_pct);

  return (
    <Section
      collapsible
      name="debrief-details"
      title="What you'd do differently"
      subtitle="the intended write-up path vs your route"
      right={
        <span className="mono tabular-nums" style={{ color: tierColor(coverage) }}>
          {coverage}% coverage
        </span>
      }
    >
      {report.golden_dag.length === 0 ? (
        <p className="text-sm text-faint">
          Add a <span className="text-fg">reference path</span> at the top of the debrief to unlock the intended-path comparison.
        </p>
      ) : (
        <>
          <PathGraph />
          {/* legend reads as the chart's caption, below the canvas */}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
            {LEGEND.map(([t, c]) => (
              <span key={t} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[1px]" style={{ background: c }} />
                {t}
              </span>
            ))}
            <span className="ml-auto">top → bottom · intended path on the left, deviations on the right · click to inspect</span>
          </div>
        </>
      )}
    </Section>
  );
}
