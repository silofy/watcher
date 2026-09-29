import { useReport } from "../store/report";
import { Section, Gauge, tierColor } from "./ui";
import { runWeaknesses, cweLabel } from "../lib/pipeline/frameworks";
import { KillChainTrajectory } from "./KillChainTrajectory";

/**
 * The three-lens readout: ATT&CK alone is a flat, unordered matrix, so the grade overlays two
 * orthogonal axes — UKC for attack *ordering* (did the run advance or thrash) and CWE for the
 * *weakness class* exploited (so breadth counts distinct weaknesses, not distinct techniques).
 * All three are deterministic; this panel just renders what the metrics engine already computed.
 */
export function FrameworkAxes() {
  const { report, metrics } = useReport();
  const hasRef = report.golden_dag.length > 0;
  const weaknesses = runWeaknesses(report.episodes);

  return (
    <Section title="Frameworks" subtitle="ATT&CK · UKC · CWE — three lenses on the same run">
      {/* three headline readouts */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="flex flex-col items-center gap-2 rounded-lg border border-edge bg-panel px-3 py-4">
          <Gauge label="Progression" value={metrics.ukc_progression} caption="UKC phases hit in order" />
        </div>

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

        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-edge bg-panel px-3 py-4">
          <div className="flex h-[108px] flex-col items-center justify-center">
            <span className="font-display text-5xl font-bold leading-none" style={{ color: tierColor(weaknesses.length > 0 ? 70 : 30) }}>
              {weaknesses.length}
            </span>
            <span className="mt-1 text-xs text-faint">CWE {weaknesses.length === 1 ? "class" : "classes"}</span>
          </div>
          <div className="text-center">
            <div className="label text-fg">Weakness breadth</div>
            <div className="mt-0.5 text-xs text-faint">vs {metrics.technique_breadth} ATT&CK techniques</div>
          </div>
        </div>
      </div>

      {/* the kill-chain trajectory — the run's actual path up the chain, backtracks and all */}
      <div className="mt-5">
        <div className="label mb-2 text-faint">Kill chain — the path you took, on the shared timeline</div>
        <KillChainTrajectory progression={metrics.ukc_progression} />
      </div>

      {/* CWE weakness classes — named, not just counted */}
      <div className="mt-4">
        <div className="label mb-2 text-faint">Weakness classes exploited</div>
        {weaknesses.length ? (
          <div className="flex flex-wrap gap-1.5">
            {weaknesses.map((id) => (
              <span key={id} className="mono rounded border border-tool/40 bg-tool/10 px-1.5 py-0.5 text-xs text-fg">
                {cweLabel(id)}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-xs text-faint">
            None recognized yet — CWE tags are mapped only from tooling that exploits one unambiguous weakness, so the
            list stays honest as it grows.
          </p>
        )}
      </div>

      <p className="mt-4 text-xs leading-relaxed text-faint">
        ATT&CK says <span className="text-muted">what</span> you did; UKC adds the <span className="text-muted">order</span> it
        should happen in (so backtracking is visible); CWE adds the <span className="text-muted">weakness class</span> you
        exploited (so two different bugs don't collapse into one technique).
      </p>
    </Section>
  );
}
