import { useReport } from "../store/report";
import { Section, Gauge, tierColor } from "./ui";
import { UKC_ORDER, type UkcPhase, ukcOf, ukcRank, runWeaknesses, cweLabel } from "../lib/pipeline/frameworks";
import type { Episode } from "../types/report";

const UKC_SHORT: Record<UkcPhase, string> = {
  reconnaissance: "Recon",
  exploitation: "Exploit",
  execution: "Exec",
  persistence: "Persist",
  "defense-evasion": "Evade",
  "credential-access": "Creds",
  "privilege-escalation": "PrivEsc",
  "lateral-movement": "Lateral",
  "command-and-control": "C2",
  collection: "Collect",
  exfiltration: "Exfil",
  objectives: "Objectives",
};

/**
 * Kill-chain trajectory: each command plotted as its UKC phase-rank over the run. The line climbing
 * means the operator advanced in order; a dip means they dropped back to an earlier phase. So order,
 * coverage (which rows exist), and the progression metric (how often the line climbs) are all one
 * picture — something a flat "phases reached" row can't show.
 */
function KillChainTrajectory({ episodes, progression }: { episodes: Episode[]; progression: number }) {
  const seq = episodes
    .filter((e) => e.binary)
    .map((e) => ukcOf(e))
    .filter(Boolean)
    .map((p) => ({ phase: p as UkcPhase, rank: ukcRank(p as UkcPhase) }));

  if (seq.length < 2) {
    return <p className="text-xs text-faint">Not enough classified commands to chart a trajectory yet.</p>;
  }

  const reachedRanks = [...new Set(seq.map((s) => s.rank))].sort((a, b) => a - b);
  const rowOf = new Map(reachedRanks.map((r, i) => [r, i])); // 0 = lowest rank (bottom)
  const rows = reachedRanks.length;

  const W = 560;
  const labelW = 92;
  const rightPad = 16;
  const topPad = 12;
  const rowH = 30;
  const xAxisH = 24;
  const plotW = W - labelW - rightPad;
  const plotBottom = topPad + rows * rowH;
  const H = plotBottom + xAxisH;

  const y = (rank: number) => topPad + (rows - 1 - rowOf.get(rank)!) * rowH + rowH / 2;
  const x = (i: number) => (seq.length === 1 ? labelW + plotW / 2 : labelW + (i / (seq.length - 1)) * plotW);

  const maxRank = Math.max(...seq.map((s) => s.rank));
  const furthestIdx = seq.findIndex((s) => s.rank === maxRank);

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }} role="img" aria-label="Kill-chain trajectory">
        {/* per-row guide lines + phase labels */}
        {reachedRanks.map((r) => {
          const phase = UKC_ORDER[r];
          return (
            <g key={r}>
              <line x1={labelW} y1={y(r)} x2={W - rightPad} y2={y(r)} stroke="var(--color-edge)" strokeWidth={1} strokeDasharray="2 3" opacity={0.5} />
              <text x={labelW - 8} y={y(r)} fontSize="10.5" fill="var(--color-faint)" textAnchor="end" dominantBaseline="middle">
                {UKC_SHORT[phase]}
              </text>
            </g>
          );
        })}

        {/* x-axis */}
        <line x1={labelW} y1={plotBottom} x2={W - rightPad} y2={plotBottom} stroke="var(--color-edge)" strokeWidth={1} />
        <text x={labelW + plotW / 2} y={plotBottom + 16} fontSize="10" fill="var(--color-faint)" textAnchor="middle">
          commands over time →
        </text>

        {/* trajectory — one segment per step, colored by direction (climb vs backtrack) */}
        {seq.slice(1).map((s, i) => {
          const prev = seq[i];
          const climb = s.rank >= prev.rank;
          return (
            <line
              key={i}
              x1={x(i)}
              y1={y(prev.rank)}
              x2={x(i + 1)}
              y2={y(s.rank)}
              stroke={climb ? "var(--color-match)" : "var(--color-detour)"}
              strokeWidth={2}
              strokeLinecap="round"
              opacity={climb ? 0.85 : 0.95}
            />
          );
        })}

        {/* command dots */}
        {seq.map((s, i) => (
          <circle key={i} cx={x(i)} cy={y(s.rank)} r={2.4} fill="var(--color-fg)" opacity={0.7} />
        ))}

        {/* furthest reached — the objective-most point */}
        <circle cx={x(furthestIdx)} cy={y(maxRank)} r={4.5} fill="var(--color-match)" stroke="var(--color-ink)" strokeWidth={1.5}>
          <title>Furthest: {UKC_SHORT[UKC_ORDER[maxRank]]}</title>
        </circle>
      </svg>

      {/* legend + summary */}
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-match)" }} /> advanced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-detour)" }} /> backtracked
        </span>
        <span className="ml-auto">
          progression <span style={{ color: tierColor(progression) }}>{Math.round(progression)}%</span> · {reachedRanks.length}/{UKC_ORDER.length} phases
        </span>
      </div>
    </div>
  );
}

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
    <Section
      title="Frameworks"
      subtitle="ATT&CK · UKC · CWE — three lenses on the same run"
      collapsible
      name="debrief-details"
    >
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
        <div className="label mb-2 text-faint">Kill chain — the path you took, in attack order</div>
        <KillChainTrajectory episodes={report.episodes} progression={metrics.ukc_progression} />
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
