import { useReport } from "../store/report";
import { Section, Gauge, tierColor } from "./ui";

/**
 * The three-lens readout: ATT&CK alone is a flat, unordered matrix, so the grade overlays two
 * orthogonal axes — UKC for attack *ordering* (did the run advance or thrash) and CWE for the
 * *weakness class* exploited (so breadth counts distinct weaknesses, not distinct techniques).
 * All three are deterministic; this panel just renders what the metrics engine already computed.
 */
export function FrameworkAxes() {
  const { report, metrics } = useReport();
  const hasRef = report.golden_dag.length > 0;

  return (
    <Section
      title="Frameworks"
      subtitle="ATT&CK · UKC · CWE — three lenses on the same run"
      collapsible
      name="debrief-details"
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {/* UKC progression — the precision ATT&CK can't give: it has no order. */}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-4">
          <Gauge label="Progression" value={metrics.ukc_progression} caption="UKC phases hit in order" />
        </div>

        {/* UKC coverage — like objective coverage, it needs the intended path to compare against. */}
        <div className="flex flex-col items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-4">
          {hasRef ? (
            <Gauge label="Phase coverage" value={metrics.ukc_coverage_pct} caption="of the path's UKC phases" />
          ) : (
            <div className="flex flex-col items-center gap-1.5">
              <div className="flex h-[108px] w-[108px] items-center justify-center">
                <span className="font-display text-3xl font-bold text-faint">—</span>
              </div>
              <div className="text-center">
                <div className="label text-fg">Phase coverage</div>
                <div className="mt-0.5 text-xs text-faint">needs a write-up</div>
              </div>
            </div>
          )}
        </div>

        {/* Weakness breadth — a count, so a plain readout rather than a 0–100 gauge. */}
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-edge bg-panel px-3 py-4">
          <div className="flex h-[108px] flex-col items-center justify-center">
            <span className="font-display text-5xl font-bold leading-none" style={{ color: tierColor(metrics.weakness_breadth > 0 ? 70 : 30) }}>
              {metrics.weakness_breadth}
            </span>
            <span className="mt-1 text-xs text-faint">CWE {metrics.weakness_breadth === 1 ? "class" : "classes"}</span>
          </div>
          <div className="text-center">
            <div className="label text-fg">Weakness breadth</div>
            <div className="mt-0.5 text-xs text-faint">vs {metrics.technique_breadth} ATT&CK techniques</div>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-faint">
        ATT&CK says <span className="text-muted">what</span> you did; UKC adds the <span className="text-muted">order</span> it
        should happen in (so backtracking is visible); CWE adds the <span className="text-muted">weakness class</span> you
        exploited (so two different bugs don't collapse into one technique).
      </p>
    </Section>
  );
}
