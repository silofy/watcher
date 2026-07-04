import type { ReactNode } from "react";
import { useReport } from "../store/report";
import { progressSeries, progressSummary, progressPath, progressDots, type ProgressPoint } from "../lib/progress";
import { platformLabel } from "../lib/platform";
import { Section, tierColor } from "./ui";

// chart geometry — a fixed logical size, scaled to the container by the responsive <svg>
const W = 600;
const H = 140;
const PAD_L = 26; // room for the 0/50/100 y-axis labels
const PAD_T = 8;

const SERIES: { key: "grade" | "coverage" | "methodology"; label: string; color: string }[] = [
  // --color-match and --color-signal render identically in this theme (same teal), so methodology and
  // coverage borrow the gold/lavender accents instead — three hues spread across the wheel, legible on
  // both the dark ground and a light background.
  { key: "grade", label: "Grade", color: "var(--color-match)" },
  { key: "coverage", label: "Coverage", color: "var(--color-flag)" },
  { key: "methodology", label: "Methodology", color: "var(--color-tool)" },
];

function fmtDate(ms: number): string {
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function Tile({ label, value, color }: { label: string; value: ReactNode; color?: string }) {
  return (
    <div className="rounded-lg border border-edge bg-panel px-3 py-2.5">
      <div className="label text-faint">{label}</div>
      <div className="mono mt-0.5 truncate text-xl font-semibold tabular-nums" style={color ? { color } : undefined}>
        {value}
      </div>
    </div>
  );
}

/** One run's affordance below the chart — a real `<button>` so the deep-link is keyboard-reachable,
 *  not just a mouse target on the SVG dots above. */
function RunButton({ p, onOpen }: { p: ProgressPoint; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open ${p.label}`}
      className="flex shrink-0 flex-col items-center gap-0.5 rounded-lg border border-edge bg-panel px-2.5 py-2 text-center transition-colors hover:border-edge-bright"
    >
      <span className="label text-[10px] text-faint">{platformLabel(p.platform)}</span>
      <span className="max-w-[10ch] truncate text-xs text-muted">{p.label}</span>
      <span className="font-display text-sm font-bold" style={{ color: tierColor(p.grade) }}>
        {p.letter}
      </span>
      <span className="text-[10px] text-faint">{fmtDate(p.date)}</span>
    </button>
  );
}

/** The longitudinal trend chart — grade/coverage/methodology over the run order, each its own line +
 *  dots. Dots are a mouse-only click shortcut into the debrief; the RunButton row below is the
 *  accessible, keyboard-reachable version of the same deep-link. */
function TrendChart({ points, onOpen }: { points: ProgressPoint[]; onOpen: (id: string) => void }) {
  const series = {
    grade: points.map((p) => p.grade),
    coverage: points.map((p) => p.coverage),
    methodology: points.map((p) => p.methodology),
  };

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${W + PAD_L} ${H + PAD_T * 2}`}
        style={{ width: "100%", minWidth: 420, height: "auto" }}
        role="img"
        aria-label="Grade, coverage, and methodology trend across runs, scored 0 to 100"
      >
        <g transform={`translate(${PAD_L}, ${PAD_T})`}>
          {[0, 50, 100].map((v) => {
            const y = H - (v / 100) * H;
            return (
              <g key={v}>
                <line x1={0} y1={y} x2={W} y2={y} stroke="var(--color-edge)" strokeWidth={1} />
                <text x={-6} y={y} textAnchor="end" dominantBaseline="middle" fontSize={9} fill="var(--color-faint)">
                  {v}
                </text>
              </g>
            );
          })}
          {SERIES.map((s) => (
            <path key={s.key} d={progressPath(series[s.key], W, H)} fill="none" stroke={s.color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {SERIES.map((s) =>
            progressDots(series[s.key], W, H).map((d) => (
              <circle key={`${s.key}-${d.i}`} cx={d.x} cy={d.y} r={3.5} fill={s.color} className="cursor-pointer" onClick={() => onOpen(points[d.i].id)}>
                <title>{`${points[d.i].label} — ${s.label} ${Math.round(d.value)}`}</title>
              </circle>
            )),
          )}
        </g>
      </svg>
    </div>
  );
}

/** Progress — the longitudinal view: how the operator's runs trend over time, not a single debrief.
 *  Reads `sessionCards` from the store and layers `progress.ts`'s pure series/summary math on top. */
export function Progress() {
  const cards = useReport((s) => s.sessionCards);
  const switchSession = useReport((s) => s.switchSession);
  const points = progressSeries(cards);
  const summary = progressSummary(points);

  if (points.length < 2) {
    return (
      <Section title="Progress" subtitle="longitudinal trend across runs">
        <div className="rounded-lg border border-dashed border-edge bg-panel px-6 py-16 text-center">
          <div className="font-display text-lg text-muted">Not enough runs yet</div>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-faint">
            Run a couple of boxes to see your trend — grade, coverage, and methodology over time.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section title="Progress" subtitle={`${summary.runs} runs · ${points[0].label} → ${points[points.length - 1].label}`}>
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Tile label="Runs" value={summary.runs} />
        <Tile label="Rooted" value={`${Math.round(summary.rootedRate)}%`} color={tierColor(summary.rootedRate)} />
        <Tile label="Best grade" value={Math.round(summary.bestGrade)} color={tierColor(summary.bestGrade)} />
        <Tile label="Median grade" value={Math.round(summary.medianGrade)} color={tierColor(summary.medianGrade)} />
        <Tile label="Platforms" value={summary.platforms.join(", ") || "—"} />
      </div>

      <div className="mb-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {SERIES.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-xs text-muted">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
            {s.label}
          </span>
        ))}
        <span className="ml-auto text-xs text-faint">0–100 · older → newer</span>
      </div>

      <TrendChart points={points} onOpen={switchSession} />

      <div className="mt-4 overflow-x-auto">
        <div className="flex gap-2 pb-1">
          {points.map((p) => (
            <RunButton key={p.id} p={p} onOpen={() => switchSession(p.id)} />
          ))}
        </div>
      </div>
    </Section>
  );
}
