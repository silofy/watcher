import { useReport } from "../store/report";
import { Section, Tag, tierColor } from "./ui";
import { LevelBar } from "./dither";
import { computeGrade, gradeColor, type RubricKey } from "../lib/bridge/grade";
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

/** What each dimension means and what it's scored against — surfaced as a hover card on the metric
 *  name (see the `RUBRIC_COLS` row below), mirroring `TechniqueChip`'s hover-card pattern so a reader
 *  never has to already know what "breadth" or "independence" means to trust the number next to it. */
const RUBRIC_DESC: Record<RubricKey, string> = {
  coverage: "Objectives you reached vs. the write-up's intended path (0–100%).",
  breadth: "Distinct MITRE ATT&CK techniques used, scored against a target of 12.",
  efficiency: "Share of active time that moved an objective forward — vs. dead-ends, loops, and stalls.",
  progression: "Kill-chain phase transitions that advanced rather than backtracked.",
  discipline: "Stealth — how quiet you stayed vs. this box's loud reference-solve baseline.",
  methodology: "Disciplined checks your findings made relevant that you performed (e.g. found 445 → enumerate SMB).",
  focus: "Focus discipline — the inverse of time lost rabbit-holing on one low-yield surface.",
  independence: "Integrity signal — routed to a human reviewer, never an automated verdict.",
};
// The metric-label and bar columns are both `minmax(0, …)` — an explicit 0 minimum, so the track
// (and the `truncate`d label inside it) can shrink rather than forcing a ~11rem floor that would
// force a horizontal scrollbar on narrower widths. The three numeric columns stay fixed — they're
// already narrow, tabular-nums content that never needs to shrink.
const RUBRIC_COLS = "minmax(0,1.4fr) minmax(0,1fr) 3rem 3.5rem 3rem";

/**
 * Grade — one coherent picture: the radar plots the active rubric's weighted dimensions (6 for v1, 8
 * for v2) with the letter in its center, and the table shows the score × weight → points math behind
 * it. The actionable moves live in the Phase Audit; this is the explainable scorecard. Independence is
 * a gate routed to a human. Rendered as its own visible section in the main narrative (see App.tsx) —
 * above the collapsed "Evidence & detail" drawer, since the grade is a verdict, not raw detail.
 */
export function Assessment({ num }: { num?: string } = {}) {
  const s = useReport();
  const { report } = s;

  // the grade is a verdict — premature while the capture is live; settle it only when the run ends
  if (isLiveRecording(report)) {
    return (
      <Section dataShot="grade" num={num} title="Grade" subtitle="the explainable rubric — settles when the run ends">
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
  const flagged = grade.independence_gate.flagged;

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
      dataShot="grade"
      num={num}
      title="Grade"
      subtitle="how your score breaks down — the explainable rubric"
      lead={{ value: grade.letter, unit: ` · ${grade.score.toFixed(1)}`, caption: `weighted across ${n} rubric metrics`, color: gc }}
      right={
        <div className="flex items-center gap-2">
          {/* subtle — which rubric produced this grade, not a badge that competes with the verdict */}
          <span className="text-faint" title={`Scored against rubric v${grade.version}`}>
            v{grade.version}
          </span>
          {/* a status chip, not a link — this panel IS the grade, so it never points anywhere; the
              flagged case still names where the gate sends it (a human review queue) */}
          <Tag color={flagged ? "var(--color-loud)" : "var(--color-match)"}>{flagged ? "Integrity queue" : "Graded"}</Tag>
        </div>
      }
    >
      {/* Always stacked (radar over the rubric table) — a side-by-side split (keyed on viewport width,
          not column width) would squeeze the table into a sliver at typical desktop widths. */}
      <div className="grid gap-6">
        {/* the grade radar — the active rubric's weighted dimensions, letter in the center. Capped at
            a fixed max width (not `w-full`) so it renders as a normal ~294px radar even at the full
            width of its section — only the rendered size is capped, the viewBox geometry (cx/cy/r in
            radar.ts) is untouched. */}
        <svg viewBox="0 0 240 230" className="mx-auto h-auto w-[294px] max-w-full">
          {/* the frame is a track, not a mesh — dotted like every other headroom mark (sparse = track):
              only the 100 boundary, plus dotted spokes to read each axis. No inner rings. */}
          <polygon points={axes.map((_, i) => point(i, 1, n).join(",")).join(" ")} fill="none" stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="1 3" />
          {axes.map((_, i) => {
            const [x, y] = point(i, 1, n);
            return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--color-edge)" strokeWidth={1} strokeDasharray="1 3" strokeOpacity={0.6} />;
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
          <div className="label grid gap-2 px-1.5 pb-1.5" style={{ gridTemplateColumns: RUBRIC_COLS }}>
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
                  <span className="group/rubric relative inline-block min-w-0 max-w-full">
                    <span className="block cursor-help truncate text-muted underline decoration-dotted decoration-faint/60 underline-offset-2 transition-colors group-hover/rubric:text-fg">
                      {RUBRIC_LABELS[k]}
                    </span>
                    <span
                      role="tooltip"
                      className="invisible absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border border-edge bg-panel p-3 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover/rubric:visible group-hover/rubric:opacity-100"
                    >
                      <span className="block font-display text-sm font-semibold text-fg">{RUBRIC_LABELS[k]}</span>
                      <span className="mt-1.5 block text-xs leading-relaxed text-muted">{RUBRIC_DESC[k]}</span>
                    </span>
                  </span>
                  <div className="min-w-0">
                    <LevelBar value={c.raw} color={barColor} height={8} label={RUBRIC_LABELS[k]} />
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

      {flagged && <p className="mt-3 text-xs text-loud">{grade.rationale[0]}</p>}
    </Section>
  );
}
