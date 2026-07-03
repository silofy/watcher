import { useState } from "react";
import { useReport } from "../store/report";
import { Section, tierColor } from "./ui";
import { computeGrade, gradeColor, type RubricKey } from "../lib/bridge/grade";
import { minimizedBundle } from "../lib/bridge/bundle";
import { isLiveRecording } from "../lib/live";
import { radarPoint, RADAR_GEOMETRY } from "../lib/radar";

/** The radar axes ARE the grade's weighted dimensions — chart, math, and letter tell one story.
 *  Methodology + focus only render when the active grade actually carries them (v2 reports); see the
 *  `axes` filter below, which reads `grade.components` rather than assuming a fixed axis count. */
const RUBRIC_AXES: { key: RubricKey; short: string }[] = [
  { key: "coverage", short: "Coverage" },
  { key: "breadth", short: "Breadth" },
  { key: "efficiency", short: "Efficiency" },
  { key: "progression", short: "Order" },
  { key: "discipline", short: "Discipline" },
  { key: "independence", short: "Indep." },
  { key: "methodology", short: "Method." },
  { key: "focus", short: "Focus" },
];

const { cx: CX, cy: CY } = RADAR_GEOMETRY;
const point = (i: number, frac: number, n: number) => radarPoint(i, frac, n);

const RUBRIC_LABELS: Record<RubricKey, string> = {
  coverage: "Objective coverage",
  breadth: "Technique breadth",
  efficiency: "Efficiency",
  progression: "UKC progression",
  discipline: "Operational discipline",
  independence: "Independence",
  methodology: "Methodology",
  focus: "Focus discipline",
};
// The metric-label and bar columns are both `minmax(0, …)` — an explicit 0 minimum, so the track
// (and the `truncate`d label inside it) can shrink rather than forcing a ~11rem floor that would
// force a horizontal scrollbar on narrower widths. The three numeric columns stay fixed — they're
// already narrow, tabular-nums content that never needs to shrink.
const RUBRIC_COLS = "minmax(0,1.4fr) minmax(0,1fr) 2.25rem 2.75rem 3rem";

/**
 * Grade — one coherent picture: the radar plots the active rubric's weighted dimensions (6 for v1, 8
 * for v2) with the letter in its center, and the table shows the score × weight → points math behind
 * it. The actionable moves live in the Phase Audit; this is the explainable scorecard. Independence is
 * a gate routed to a human. Lives inside the debrief's "Evidence & detail" drawer (see App.tsx) —
 * the raw grade breakdown, one click away from the hero takeaway.
 */
export function Assessment() {
  const s = useReport();
  const { report } = s;
  // detail behind "Sync to institution" — collapsed by default so the rail reads as grade + radar +
  // rubric + one action, not an essay; the trust copy stays in the DOM (just visually hidden) so it's
  // one click away rather than gone. Declared before the live-recording return so hook order stays
  // stable across renders.
  const [showSyncDetail, setShowSyncDetail] = useState(false);

  // the grade is a verdict — premature while the capture is live; settle it only when the run ends
  if (isLiveRecording(report)) {
    return (
      <Section title="Grade" subtitle="the explainable rubric — settles when the run ends">
        <p className="text-sm text-faint">
          <span className="animate-pulse" style={{ color: "var(--color-loud)" }}>
            ●
          </span>{" "}
          Recording — the grade is provisional while the run is live. It resolves into a final, explainable score when the capture ends.
        </p>
      </Section>
    );
  }

  const grade = computeGrade(report);
  const bundle = minimizedBundle(report, grade);
  const flagged = grade.independence_gate.flagged;
  const satisfied = bundle.evidence_digests.filter((d) => d.satisfied).length;

  // Render exactly the dimensions the ACTIVE grade carries: v1 reports have 6 components (no
  // methodology/focus keys at all — see computeGrade), v2 have 8. Independence is additionally
  // excluded when it was never measured, even though computeGrade still emits a zero-weight
  // placeholder for it — otherwise it'd drop off the grade but linger on the radar.
  const axes = RUBRIC_AXES.filter((a) => grade.components[a.key] !== undefined && (a.key !== "independence" || grade.independence_gate.measured));
  const n = axes.length;

  const valuePoly = axes.map((a, i) => point(i, grade.components[a.key]!.raw / 100, n).join(",")).join(" ");
  const gc = gradeColor(grade.letter);

  return (
    <Section
      title="Grade"
      subtitle="how your score breaks down — the explainable rubric"
      right={
        <div className="flex items-center gap-2">
          {/* subtle — which rubric produced this grade, not a badge that competes with the verdict */}
          <span className="text-faint" title={`Scored against rubric v${grade.version}`}>
            v{grade.version}
          </span>
          {/* a status chip, not a link — this panel IS the grade, so it never points anywhere; the
              flagged case still names where the gate sends it (a human review queue) */}
          <span
            className="rounded-full border px-2 py-0.5"
            style={{
              color: flagged ? "var(--color-loud)" : "var(--color-match)",
              borderColor: flagged ? "color-mix(in oklch, var(--color-loud) 35%, transparent)" : "color-mix(in oklch, var(--color-match) 35%, transparent)",
            }}
          >
            {flagged ? "Integrity queue" : "Graded"}
          </span>
        </div>
      }
    >
      {/* Always stacked (radar over the rubric table) — a side-by-side split (keyed on viewport width,
          not column width) would squeeze the table into a sliver at typical desktop widths. */}
      <div className="grid gap-6">
        {/* the grade radar — the active rubric's weighted dimensions, letter in the center */}
        <svg viewBox="0 0 240 230" className="mx-auto h-auto w-full max-w-full">
          {[0.25, 0.5, 0.75, 1].map((ring) => (
            <polygon key={ring} points={axes.map((_, i) => point(i, ring, n).join(",")).join(" ")} fill="none" stroke="var(--color-edge)" strokeWidth={1} />
          ))}
          {axes.map((_, i) => {
            const [x, y] = point(i, 1, n);
            return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--color-edge)" strokeWidth={1} />;
          })}
          <polygon points={valuePoly} fill="var(--color-alt)" fillOpacity={0.18} stroke="var(--color-alt)" strokeWidth={2} />
          {/* vertices colored by tier — independence turns red when it trips the gate */}
          {axes.map((a, i) => {
            const raw = grade.components[a.key]!.raw;
            const [x, y] = point(i, raw / 100, n);
            const col = a.key === "independence" && flagged ? "var(--color-loud)" : tierColor(raw);
            return <circle key={a.key} cx={x} cy={y} r={3.2} fill={col} />;
          })}
          {axes.map((a, i) => {
            const [x, y] = point(i, 1.24, n);
            const lit = a.key === "independence" && flagged;
            return (
              <text key={a.key} x={x} y={y} fontSize="11" fill={lit ? "var(--color-loud)" : "var(--color-faint)"} textAnchor="middle" dominantBaseline="middle">
                {a.short}
              </text>
            );
          })}
          {/* center medallion — masks the converging axis lines + polygon fill so the grade reads as a
              clean verdict instead of getting lost in the mesh. Drawn over the radar, under the text. */}
          <circle cx={CX} cy={CY} r={29} fill={`color-mix(in oklch, ${gc} 12%, var(--color-ink))`} stroke={gc} strokeOpacity={0.55} strokeWidth={1.5} />
          {/* the grade itself, at the center of its own breakdown */}
          <text x={CX} y={CY - 3} fontSize="34" fontWeight={700} fill={gc} textAnchor="middle" dominantBaseline="middle" className="font-display">
            {grade.letter}
          </text>
          <text x={CX} y={CY + 18} fontSize="10" fill="var(--color-faint)" textAnchor="middle">
            {grade.score}/100
          </text>
        </svg>

        {/* the rubric math behind the chart */}
        <div>
          <div className="label grid gap-2 px-1.5 pb-1.5 text-xs" style={{ gridTemplateColumns: RUBRIC_COLS }}>
            <span>metric</span>
            <span />
            <span className="text-right">score</span>
            <span className="text-right">weight</span>
            <span className="text-right">→ pts</span>
          </div>
          <div className="divide-y divide-edge/50">
            {axes.map(({ key: k }) => {
              const c = grade.components[k]!;
              const gate = k === "independence" && flagged;
              const barColor = gate ? "var(--color-loud)" : tierColor(c.raw);
              return (
                <div key={k} className="grid items-center gap-2 px-1.5 py-1.5 text-sm" style={{ gridTemplateColumns: RUBRIC_COLS }}>
                  <span className="min-w-0 truncate text-muted">{RUBRIC_LABELS[k]}</span>
                  <div className="min-w-0 h-1.5 overflow-hidden rounded-full bg-edge">
                    <div className="h-full rounded-full" style={{ width: `${c.raw}%`, backgroundColor: barColor }} />
                  </div>
                  <span className="mono text-right tabular-nums" style={{ color: barColor }}>
                    {c.raw}
                  </span>
                  <span className="mono text-right text-xs text-faint">{Math.round(c.weight * 100)}%</span>
                  <span className="mono text-right tabular-nums text-fg">{c.weighted}</span>
                </div>
              );
            })}
          </div>
          <div className="mt-1.5 grid items-center gap-2 px-1.5 pt-1.5 text-sm" style={{ gridTemplateColumns: RUBRIC_COLS }}>
            <span className="label text-faint">weighted total</span>
            <span />
            <span />
            <span />
            <span className="mono text-right font-semibold tabular-nums" style={{ color: gradeColor(grade.letter) }}>
              {grade.score}
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-xs text-faint">
        {grade.version === 2
          ? "Recovery is surfaced as coaching — not yet weighted into the grade."
          : "Methodology, focus, and recovery are surfaced as coaching — not yet weighted into the grade."}
      </p>

      {/* what actually leaves the machine on sync — a single compact action, not an inline consent
          essay. The plain-language breakdown (what they receive / never see / the signature) is one
          click away via `showSyncDetail`, kept in the DOM (just visually `hidden`) rather than
          unmounted, so the transparency copy is never actually gone. */}
      <div className="mt-5 flex items-center justify-between gap-3 rounded-lg border border-edge bg-ink/50 p-3.5">
        <p className="text-xs text-muted">
          Only your <span className="text-fg">grade and scores</span> leave this machine — never your commands or the live IP.
        </p>
        <button
          type="button"
          onClick={() => setShowSyncDetail((v) => !v)}
          aria-expanded={showSyncDetail}
          aria-controls="sync-detail"
          className="label shrink-0 rounded-full border border-signal/50 px-3 py-1.5 text-signal transition-colors hover:bg-signal/15"
        >
          Sync to institution{" "}
          <span className="inline-block transition-transform duration-200" style={showSyncDetail ? { transform: "rotate(90deg)" } : undefined}>
            ▸
          </span>
        </button>
      </div>

      <div id="sync-detail" hidden={!showSyncDetail} className="mt-2 rounded-lg border border-edge bg-ink/50 p-4 text-xs">
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {/* what they receive */}
          <div>
            <div className="label mb-1.5 flex items-center gap-1.5 text-match">
              <span>✓</span> They receive
            </div>
            <ul className="space-y-1 text-muted">
              <li>The box: <span className="text-fg">{bundle.session.target_scope}</span> <span className="text-faint">(IP removed)</span></li>
              <li>Your grade, plus the {axes.length} scores behind it</li>
              <li>
                Which objectives you reached — <span className="text-fg">{satisfied} of {bundle.evidence_digests.length}</span>{" "}
                <span className="text-faint">(just a checkmark per objective, not how you did it)</span>
              </li>
            </ul>
          </div>

          {/* what never leaves */}
          <div>
            <div className="label mb-1.5 flex items-center gap-1.5 text-detour">
              <span>✕</span> They never see
            </div>
            <ul className="space-y-1 text-muted">
              <li>The commands you typed</li>
              <li>Any command output or files</li>
              <li>The target's IP address</li>
            </ul>
          </div>
        </div>

        <p className="mt-3 border-t border-edge/60 pt-2.5 text-faint">
          Signed before it sends, so your institution can confirm the grade is genuinely yours and hasn't been edited
          after the fact.
        </p>
      </div>

      {flagged && <p className="mt-3 text-xs text-loud">{grade.rationale[0]}</p>}
    </Section>
  );
}
