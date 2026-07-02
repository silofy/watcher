import { useReport } from "../store/report";
import { Section, tierColor } from "./ui";
import { computeGrade, gradeColor, type RubricKey } from "../lib/bridge/grade";
import { minimizedBundle } from "../lib/bridge/bundle";
import { isLiveRecording } from "../lib/live";

/** The radar axes ARE the grade's weighted dimensions — chart, math, and letter tell one story. */
const RUBRIC_AXES: { key: RubricKey; short: string }[] = [
  { key: "coverage", short: "Coverage" },
  { key: "breadth", short: "Breadth" },
  { key: "efficiency", short: "Efficiency" },
  { key: "progression", short: "Order" },
  { key: "discipline", short: "Discipline" },
  { key: "independence", short: "Indep." },
];

const CX = 120;
const CY = 115;
const R = 78;
function point(i: number, frac: number, n: number): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [CX + Math.cos(angle) * R * frac, CY + Math.sin(angle) * R * frac];
}

const RUBRIC_LABELS: Record<RubricKey, string> = {
  coverage: "Objective coverage",
  breadth: "Technique breadth",
  efficiency: "Efficiency",
  progression: "UKC progression",
  discipline: "Operational discipline",
  independence: "Independence",
};
const RUBRIC_COLS = "11rem minmax(0,1fr) 2.5rem 3rem 3.25rem";

/**
 * Grade — one coherent picture: the radar plots the five weighted rubric dimensions with the letter in
 * its center, and the table shows the score × weight → points math behind it. The actionable moves live
 * in the Phase Audit; this is the explainable scorecard. Independence is a gate routed to a human.
 */
export function Assessment() {
  const s = useReport();
  const { report } = s;

  // the grade is a verdict — premature while the capture is live; settle it only when the run ends
  if (isLiveRecording(report)) {
    return (
      <Section collapsible name="debrief-details" title="Grade" subtitle="the explainable rubric — settles when the run ends">
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

  // Independence is only a rubric axis when it was actually measured; otherwise it's excluded from the
  // grade (see computeGrade) and so it drops off the radar and the breakdown table too.
  const axes = RUBRIC_AXES.filter((a) => a.key !== "independence" || grade.independence_gate.measured);
  const n = axes.length;

  const valuePoly = axes.map((a, i) => point(i, grade.components[a.key].raw / 100, n).join(",")).join(" ");

  return (
    <Section
      collapsible
      name="debrief-details"
      title="Grade"
      subtitle="how your score breaks down — the explainable rubric"
      right={
        <span
          className="rounded-full border px-2 py-0.5"
          style={{
            color: flagged ? "var(--color-loud)" : "var(--color-match)",
            borderColor: flagged ? "color-mix(in oklch, var(--color-loud) 35%, transparent)" : "color-mix(in oklch, var(--color-match) 35%, transparent)",
          }}
        >
          {flagged ? "→ integrity queue" : "→ grade"}
        </span>
      }
    >
      <div className="grid gap-8 md:grid-cols-[300px_1fr] md:items-center">
        {/* the grade radar — the five weighted dimensions, letter in the center */}
        <svg viewBox="0 0 240 230" className="mx-auto w-full max-w-[300px]">
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
            const raw = grade.components[a.key].raw;
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
          <text x={CX} y={CY - 3} fontSize="30" fontWeight={700} fill={gradeColor(grade.letter)} textAnchor="middle" dominantBaseline="middle" className="font-display">
            {grade.letter}
          </text>
          <text x={CX} y={CY + 17} fontSize="10.5" fill="var(--color-faint)" textAnchor="middle">
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
              const c = grade.components[k];
              const gate = k === "independence" && flagged;
              const barColor = gate ? "var(--color-loud)" : tierColor(c.raw);
              return (
                <div key={k} className="grid items-center gap-2 px-1.5 py-1.5 text-sm" style={{ gridTemplateColumns: RUBRIC_COLS }}>
                  <span className="truncate text-muted">{RUBRIC_LABELS[k]}</span>
                  <div className="h-1.5 overflow-hidden rounded-full bg-edge">
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

      {/* what actually leaves the machine on sync — plain-language consent, not a jargon dump */}
      <div className="mt-5 rounded-lg border border-edge bg-ink/50 p-4 text-xs">
        <div className="mb-2.5">
          <div className="label text-fg">If you sync this to your institution</div>
          <p className="mt-1 text-muted">
            Only your <span className="text-fg">grade and scores</span> leave this machine. Your commands, their output,
            and the live IP never do.
          </p>
        </div>

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
