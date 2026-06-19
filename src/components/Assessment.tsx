import ReactMarkdown from "react-markdown";
import { useReport } from "../store/report";
import { Section, Chip, tierColor } from "./ui";
import { CAT_COLOR, normalizeCoaching } from "../lib/coaching";
import { computeGrade, gradeColor, RUBRIC, type RubricKey } from "../lib/bridge/grade";
import { minimizedBundle } from "../lib/bridge/bundle";
import type { SkillRadar } from "../types/report";

const AXES: { key: keyof SkillRadar; label: string }[] = [
  { key: "recon", label: "Recon" },
  { key: "web", label: "Web" },
  { key: "exploit", label: "Exploit" },
  { key: "privesc", label: "PrivEsc" },
  { key: "opsec", label: "OpSec" },
];

const CX = 120;
const CY = 115;
const R = 78;
function point(i: number, frac: number): [number, number] {
  const angle = -Math.PI / 2 + (i * 2 * Math.PI) / AXES.length;
  return [CX + Math.cos(angle) * R * frac, CY + Math.sin(angle) * R * frac];
}
function quality(v: number): string {
  return v >= 80 ? "Strong" : v >= 65 ? "Solid" : v >= 50 ? "Developing" : "Needs work";
}

const RUBRIC_LABELS: Record<RubricKey, string> = {
  coverage: "Objective coverage",
  breadth: "Technique breadth",
  efficiency: "Efficiency",
  discipline: "Operational discipline",
  independence: "Independence",
};
const RUBRIC_COLS = "11rem minmax(0,1fr) 2.5rem 3rem 3.25rem";
const MD_CODE = "[&_code]:mono [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg [&_p]:m-0";

/**
 * Grade & coaching — one piece: where you scored (the explainable Enterprise Bridge rubric), then how
 * to level up (skills + playbook), then what syncs to the institution. The grade frames the coaching;
 * the coaching is how you raise it. Independence stays a gate routed to a human, not a verdict.
 */
export function Assessment() {
  const s = useReport();
  const { report } = s;
  const grade = computeGrade(report);
  const bundle = minimizedBundle(report, grade);
  const flagged = grade.independence_gate.flagged;
  const satisfied = bundle.evidence_digests.filter((d) => d.satisfied).length;

  const radar = report.coaching.skill_radar;
  const steps = normalizeCoaching(report.coaching.next_steps).filter((st) => st.category !== "Recap");
  const valuePoly = AXES.map((a, i) => point(i, radar[a.key] / 100).join(",")).join(" ");
  const ranked = [...AXES].sort((a, b) => radar[b.key] - radar[a.key]);
  const top = ranked[0];
  const low = ranked[ranked.length - 1];

  return (
    <Section
      title="Coaching & grade"
      subtitle="how you scored — and how to level up"
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
      {/* 1 — the grade & the rubric math (explainable Enterprise Bridge) */}
      <div className="grid gap-6 md:grid-cols-[240px_1fr]">
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

        <div>
          <div className="label grid gap-2 px-1.5 pb-1.5 text-xs" style={{ gridTemplateColumns: RUBRIC_COLS }}>
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

      {/* divider into the coaching half */}
      <div className="my-5 flex items-center gap-3">
        <span className="label text-faint">How to level up</span>
        <div className="h-px flex-1 bg-edge" />
      </div>

      {/* the verdict that frames the coaching */}
      <p className="mb-5 text-base leading-relaxed text-muted">
        Your edge is{" "}
        <span className="font-semibold" style={{ color: tierColor(radar[top.key]) }}>
          {top.label} ({radar[top.key]})
        </span>
        . The gap holding you back is{" "}
        <span className="font-semibold" style={{ color: tierColor(radar[low.key]) }}>
          {low.label} ({radar[low.key]})
        </span>{" "}
        — every move below is ordered by how much time it would have saved you.
      </p>

      {/* 2 — skills + playbook */}
      <div className="grid gap-7 lg:grid-cols-[300px_1fr]">
        <div className="lg:border-r lg:border-edge lg:pr-6">
          <h3 className="label mb-2 text-faint">Skill radar</h3>
          <svg viewBox="0 0 240 230" className="w-full max-w-[280px]">
            {[0.25, 0.5, 0.75, 1].map((ring) => (
              <polygon key={ring} points={AXES.map((_, i) => point(i, ring).join(",")).join(" ")} fill="none" stroke="var(--color-edge)" strokeWidth={1} />
            ))}
            {AXES.map((_, i) => {
              const [x, y] = point(i, 1);
              return <line key={i} x1={CX} y1={CY} x2={x} y2={y} stroke="var(--color-edge)" strokeWidth={1} />;
            })}
            <polygon points={valuePoly} fill="var(--color-alt)" fillOpacity={0.22} stroke="var(--color-alt)" strokeWidth={2} />
            {AXES.map((a, i) => {
              const [x, y] = point(i, 1.2);
              return (
                <text key={a.key} x={x} y={y} fontSize="12" fill="var(--color-faint)" textAnchor="middle" dominantBaseline="middle">
                  {a.label}
                </text>
              );
            })}
          </svg>
          <ul className="mt-4 space-y-2.5">
            {ranked.map((a) => {
              const v = radar[a.key];
              const c = tierColor(v);
              return (
                <li key={a.key}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="text-muted">{a.label}</span>
                    <span className="mono tabular-nums" style={{ color: c }}>
                      {v} · {quality(v)}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${v}%`, background: c }} />
                  </div>
                </li>
              );
            })}
          </ul>
        </div>

        <div>
          <h3 className="label mb-3 text-faint">
            Your playbook for next time <span className="text-muted">· {steps.length} moves</span>
          </h3>
          {steps.length === 0 && (
            <p className="rounded-lg border border-edge bg-panel-2/30 p-4 text-sm text-faint">No coaching moves yet — they surface as your run is analyzed against the intended path.</p>
          )}
          <ol className="space-y-3">
            {steps.map((step, i) => {
              const color = CAT_COLOR[step.category];
              const linked = step.evidence_seq != null;
              return (
                <li
                  key={i}
                  className={`rounded-lg border border-edge bg-panel-2/30 p-4 transition-colors hover:border-edge-bright ${linked ? "cursor-pointer" : ""}`}
                  onMouseEnter={() => linked && s.hover(step.evidence_seq!)}
                  onMouseLeave={() => linked && s.hover(null)}
                  onClick={() => linked && s.reveal(step.evidence_seq!)}
                >
                  <div className="mb-2 flex items-center gap-2.5">
                    <span className="readout flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-panel text-sm text-muted ring-1 ring-edge">{i + 1}</span>
                    <Chip color={color}>{step.category}</Chip>
                    {i === 0 && <span className="label text-signal">Start here · highest impact</span>}
                    {linked && <span className="label ml-auto text-faint">step {step.evidence_seq} ↗</span>}
                  </div>
                  <div className={`text-base font-semibold leading-snug text-fg ${MD_CODE}`}>
                    <ReactMarkdown>{step.action}</ReactMarkdown>
                  </div>
                  {step.why && (
                    <div className={`mt-1 text-sm leading-relaxed text-muted [&_strong]:text-fg ${MD_CODE}`}>
                      <ReactMarkdown>{step.why}</ReactMarkdown>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      </div>

      {/* 3 — what actually leaves the machine on sync */}
      <div className="mt-5 rounded-lg border border-edge bg-ink/50 p-3 text-xs">
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
