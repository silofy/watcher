import { useReport } from "../store/report";
import { Section, tierColor } from "./ui";
import { computeGrade, gradeColor, RUBRIC, type RubricKey } from "../lib/bridge/grade";
import { minimizedBundle } from "../lib/bridge/bundle";

const LABELS: Record<RubricKey, string> = {
  coverage: "Objective coverage",
  breadth: "Technique breadth",
  efficiency: "Efficiency",
  discipline: "Operational discipline",
  independence: "Independence",
};

const COLS = "11rem minmax(0,1fr) 2.5rem 3rem 3.25rem";

/**
 * Enterprise Bridge — the grade and the consent preview (brief §6.4). The institution never gets
 * raw telemetry: only a signed, manager-profile bundle of scores + evidence digests. The student
 * previews exactly that here before any sync. Independence is a gate routed to a human, not a verdict.
 */
export function BridgePanel() {
  const { report } = useReport();
  const grade = computeGrade(report);
  const bundle = minimizedBundle(report, grade);
  const flagged = grade.independence_gate.flagged;
  const satisfied = bundle.evidence_digests.filter((d) => d.satisfied).length;

  return (
    <Section
      title="Enterprise Bridge"
      subtitle="explainable grade · consent preview · signed at sync"
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
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
        {/* the grade — letter colored by tier, with the independence gate read */}
        <div className="flex flex-col items-center justify-center rounded-lg border border-edge bg-panel-2/40 p-4">
          <div className="font-display text-6xl font-bold leading-none" style={{ color: gradeColor(grade.letter) }}>
            {grade.letter}
          </div>
          <div className="mono mt-1.5 text-sm text-muted">{grade.score} / 100 weighted</div>
          <div className="mt-3 flex items-center gap-1.5 text-xs">
            <span className="text-faint">independence</span>
            <span className="mono" style={{ color: flagged ? "var(--color-loud)" : "var(--color-match)" }}>
              {grade.independence_gate.score}
            </span>
            <span className="text-faint">vs gate {grade.independence_gate.threshold}</span>
          </div>
        </div>

        {/* the rubric, made explainable: score × weight = points, summing to the grade */}
        <div>
          <div className="label grid gap-2 px-1.5 pb-1.5 text-xs" style={{ gridTemplateColumns: COLS }}>
            <span>metric</span>
            <span />
            <span className="text-right">score</span>
            <span className="text-right">weight</span>
            <span className="text-right">→ pts</span>
          </div>
          <div className="divide-y divide-edge/50">
            {(Object.keys(RUBRIC) as RubricKey[]).map((k) => {
              const c = grade.components[k];
              const gate = k === "independence" && flagged;
              const barColor = gate ? "var(--color-loud)" : tierColor(c.raw);
              return (
                <div key={k} className="grid items-center gap-2 px-1.5 py-1.5 text-sm" style={{ gridTemplateColumns: COLS }}>
                  <span className="truncate text-muted">{LABELS[k]}</span>
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
          <div className="mt-1.5 grid items-center gap-2 px-1.5 pt-1.5 text-sm" style={{ gridTemplateColumns: COLS }}>
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

      <div className="mt-4 rounded-lg border border-edge bg-ink/50 p-3 text-xs">
        <div className="label mb-1.5 text-faint">Consent preview — what syncs to the institution</div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-muted">
          <span className="mono">{bundle.session.target_scope}</span>
          <span>
            {satisfied}/{bundle.evidence_digests.length} objectives (digests)
          </span>
          <span>scores + grade only</span>
          <span className="text-match">no raw commands or output</span>
          <span>profile: {bundle.redaction_profile}</span>
          <span className="text-faint">· hash-chained + ed25519-signed on sync</span>
        </div>
      </div>

      {flagged && <p className="mt-3 text-xs text-loud">{grade.rationale[0]}</p>}
    </Section>
  );
}
