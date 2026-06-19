import ReactMarkdown from "react-markdown";
import { useReport } from "../store/report";
import { Section, Chip, tierColor } from "./ui";
import { CAT_COLOR, normalizeCoaching } from "../lib/coaching";
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

const MD_CODE = "[&_code]:mono [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg [&_p]:m-0";

export function CoachingPanel() {
  const s = useReport();
  const { report } = s;
  const radar = report.coaching.skill_radar;
  // structured at the source, but normalize defensively for any raw/legacy string steps
  const steps = normalizeCoaching(report.coaching.next_steps).filter((st) => st.category !== "Recap");

  const valuePoly = AXES.map((a, i) => point(i, radar[a.key] / 100).join(",")).join(" ");
  const ranked = [...AXES].sort((a, b) => radar[b.key] - radar[a.key]);
  const top = ranked[0];
  const low = ranked[ranked.length - 1];

  return (
    <Section title="Coaching — how to level up" subtitle="your skills, scored — and the playbook for a cleaner run">
      {/* the one-line verdict that frames the whole panel */}
      <p className="mb-5 max-w-3xl text-base leading-relaxed text-muted">
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

      <div className="grid gap-7 lg:grid-cols-[300px_1fr]">
        {/* left rail — skills, scored */}
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

          {/* ranked bars — the radar made readable */}
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

        {/* main column — the playbook, the real payload */}
        <div>
          <h3 className="label mb-3 text-faint">
            Your playbook for next time <span className="text-muted">· {steps.length} moves</span>
          </h3>
          {steps.length === 0 && (
            <p className="rounded-lg border border-edge bg-panel-2/30 p-4 text-sm text-faint">
              No coaching moves yet — they surface as your run is analyzed against the intended path.
            </p>
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
    </Section>
  );
}
