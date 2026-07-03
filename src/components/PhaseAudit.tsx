import ReactMarkdown from "react-markdown";
import { useReport, activeSeq } from "../store/report";
import { Section, Chip, tierColor } from "./ui";
import { CAT_COLOR, normalizeCoaching, stepText } from "../lib/coaching";
import { buildPhaseAudits, type AuditItem, type PhaseAudit as PhaseAuditT } from "../lib/audits";
import { cweLabel } from "../lib/pipeline/frameworks";
import { TechniqueChip } from "./TechniqueChip";
import { fmtDuration, fmtMinutes } from "../lib/format";

const MD = "[&_code]:mono [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-fg [&_p]:m-0 [&_strong]:text-fg";

/** Small inline glyphs for the phase context line — a bolt (efficiency), a terminal (commands), and
 *  a crosshair (ATT&CK techniques). Stroke icons in currentColor; no emoji. */
function Icon({ name }: { name: "efficiency" | "commands" | "techniques" }) {
  const attrs = {
    width: 13,
    height: 13,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: "shrink-0 opacity-70",
  };
  if (name === "efficiency") return <svg {...attrs}><path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" /></svg>;
  if (name === "commands")
    return (
      <svg {...attrs}>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </svg>
    );
  return (
    <svg {...attrs}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="2" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22" />
      <line x1="2" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22" y2="12" />
    </svg>
  );
}

/** A small Lighthouse-style score ring (efficiency 0–100), colored by tier. */
function ScoreRing({ value }: { value: number }) {
  const r = 13;
  const c = 2 * Math.PI * r;
  const col = tierColor(value);
  return (
    <div className="relative h-14 w-14 shrink-0">
      <svg viewBox="0 0 32 32" className="h-full w-full -rotate-90">
        <circle cx="16" cy="16" r={r} fill="none" stroke="var(--color-edge)" strokeWidth="3" />
        <circle
          cx="16"
          cy="16"
          r={r}
          fill="none"
          stroke={col}
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - Math.max(0, Math.min(100, value)) / 100)}
          style={{ transition: "stroke-dashoffset 640ms var(--ease-out-expo)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center font-display text-base font-bold tabular-nums" style={{ color: col }}>
        {value}
      </span>
    </div>
  );
}

/** "a", "a and b", "a, b and c" — for listing the kinds of wasted time in plain prose. */
function joinList(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

/**
 * A plain-English headline for a collapsed phase — the meaningful state, no jargon: did you reach the
 * objectives, and how much time was wasted (and on what). Returns "" when there's nothing to say.
 */
function summaryLine(p: PhaseAuditT): string {
  const parts: string[] = [];

  if (p.coverage.total > 0) {
    parts.push(`${p.coverage.satisfied} of ${p.coverage.total} objective${p.coverage.total === 1 ? "" : "s"} reached`);
  } else if (p.commands > 0) {
    parts.push("objectives not verified (no reference path)");
  }

  if (p.wasted_ms >= 30_000) {
    const reasons: string[] = [];
    if (p.waste.detour_ms > 0) reasons.push("dead-ends");
    if (p.waste.loop_ms > 0) reasons.push("repeated attempts");
    if (p.waste.stuck_ms >= 30_000) reasons.push("long stalls");
    parts.push(`${fmtDuration(p.wasted_ms)} lost${reasons.length ? ` to ${joinList(reasons)}` : ""}`);
  } else if (parts.length) {
    parts.push("no time wasted");
  }

  return parts.join(" · ");
}

function InsightRow({ item }: { item: AuditItem }) {
  const s = useReport();
  const linked = item.evidence_seq != null;
  return (
    <li
      className={`rounded-lg border border-edge bg-panel-2/30 p-3 transition-colors hover:border-edge-bright ${linked ? "cursor-pointer" : ""}`}
      onMouseEnter={() => linked && s.hover(item.evidence_seq!)}
      onMouseLeave={() => linked && s.hover(null)}
      onClick={() => linked && s.reveal(item.evidence_seq!)}
    >
      <div className="mb-1 flex flex-wrap items-center gap-2">
        {item.category && <Chip color={CAT_COLOR[item.category]}>{item.category}</Chip>}
        {item.savings_ms != null && item.savings_ms > 0 && (
          <span className="mono rounded px-1.5 py-0.5 text-xs" style={{ color: "var(--color-detour)", backgroundColor: "color-mix(in oklch, var(--color-detour) 14%, transparent)" }}>
            ~{fmtMinutes(item.savings_ms)} saved
          </span>
        )}
        {linked && <span className="label ml-auto text-faint">step {item.evidence_seq} ↗</span>}
      </div>
      <div className={`text-sm font-semibold leading-snug text-fg ${MD}`}>
        <ReactMarkdown>{item.title}</ReactMarkdown>
      </div>
      {item.detail && (
        <div className={`mt-0.5 text-xs leading-relaxed text-muted ${MD}`}>
          <ReactMarkdown>{item.detail}</ReactMarkdown>
        </div>
      )}
    </li>
  );
}

/** A collapsible Lighthouse-style sub-group (manual checks / passed). */
function Group({ title, items, dot, defaultOpen = false }: { title: string; items: AuditItem[]; dot: string; defaultOpen?: boolean }) {
  const s = useReport();
  if (items.length === 0) return null;
  return (
    <details className="group mt-2 rounded-lg border border-edge bg-panel-2/20" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
        <span className="text-faint transition-transform group-open:rotate-90">▸</span>
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: dot }} />
        <span className="label text-muted">{title}</span>
        <span className="text-xs text-faint">· {items.length}</span>
      </summary>
      <ul className="divide-y divide-edge/50 border-t border-edge">
        {items.map((it) => {
          const linked = it.evidence_seq != null;
          return (
            <li
              key={it.id}
              className={`px-3 py-2 transition-colors ${linked ? "cursor-pointer hover:bg-panel-2/50" : ""}`}
              onMouseEnter={() => linked && s.hover(it.evidence_seq!)}
              onMouseLeave={() => linked && s.hover(null)}
              onClick={() => linked && s.reveal(it.evidence_seq!)}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-fg">{it.title}</span>
                {linked && <span className="label shrink-0 text-faint">step {it.evidence_seq} ↗</span>}
              </div>
              {it.detail && <div className="mt-0.5 text-xs leading-relaxed text-faint">{it.detail}</div>}
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** The phase's goals on the intended path — an explicit checklist so "X of Y reached" is legible. */
function Objectives({ items }: { items: PhaseAuditT["objectives"] }) {
  const s = useReport();
  if (items.length === 0) return null;
  const reached = items.filter((o) => o.reached).length;
  return (
    <div>
      <h3 className="label mb-1.5 text-faint">
        Objectives <span className="text-muted">· {reached}/{items.length} reached</span>
      </h3>
      <ul className="space-y-0.5">
        {items.map((o) => (
          <li
            key={o.slug}
            className={`flex items-baseline gap-2 rounded px-1.5 py-1 text-sm ${o.reached ? "cursor-pointer hover:bg-panel-2/50" : ""}`}
            onMouseEnter={() => o.reached && o.seq != null && s.hover(o.seq)}
            onMouseLeave={() => o.reached && s.hover(null)}
            onClick={() => o.reached && o.seq != null && s.reveal(o.seq)}
          >
            <span className="shrink-0" style={{ color: o.proven ? "var(--color-flag)" : o.reached ? "var(--color-match)" : "var(--color-skipped)" }}>
              {o.reached ? "✓" : "○"}
            </span>
            <span className={o.reached ? "text-fg" : "text-muted"}>{o.label}</span>
            {o.proven && (
              <span className="label shrink-0 text-flag" title="Proven — backed by observable proof">
                proven
              </span>
            )}
            {o.reached ? (
              <span className="label ml-auto shrink-0 text-faint">step {o.seq} ↗</span>
            ) : (
              <span className="ml-auto shrink-0 text-xs text-faint">not reached — try {o.satisfied_by[0]}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhaseCard({ p }: { p: PhaseAuditT }) {
  // Collapsed by default — each phase is a retracted card the operator expands on demand.
  const line = summaryLine(p);
  const missed = p.objectives.filter((o) => !o.reached).length;
  const clean = p.insights.length === 0 && p.manual.length === 0 && missed === 0;
  return (
    <details className="rise rounded-lg border border-edge bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3">
        <ScoreRing value={p.efficiency} />
        <div className="min-w-0 flex-1">
          <span className="font-display text-sm font-semibold tracking-tight text-fg">{p.label}</span>
          {line && <div className="mt-0.5 text-xs text-muted">{line}</div>}
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          {clean ? (
            <span className="text-xs text-match">✓ clean</span>
          ) : p.insights.length > 0 ? (
            <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: "var(--color-signal)", backgroundColor: "color-mix(in oklch, var(--color-signal) 14%, transparent)" }}>
              {p.insights.length} to improve
            </span>
          ) : missed > 0 ? (
            <span className="text-xs" style={{ color: "var(--color-skipped)" }}>
              {missed} objective{missed === 1 ? "" : "s"} missed
            </span>
          ) : (
            <span className="text-xs text-faint">{p.manual.length} to check</span>
          )}
          <span className="text-faint transition-transform [details[open]_&]:rotate-90">▸</span>
        </div>
      </summary>

      <div className="border-t border-edge">
        {/* summary band — the phase's quick facts, set apart from the deeper breakdown below.
            The phase name is the card title already, so it isn't repeated here. */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 bg-panel-2/30 px-4 py-3 text-sm text-muted">
          <span className="flex items-center gap-1.5">
            <Icon name="efficiency" />
            <span className="font-semibold tabular-nums" style={{ color: tierColor(p.efficiency) }}>
              {p.efficiency}%
            </span>
            time spent productively
          </span>
          <span className="flex items-center gap-1.5">
            <Icon name="commands" />
            {p.commands} command{p.commands === 1 ? "" : "s"} over {fmtDuration(p.active_ms)}
          </span>
          {p.techniqueIds.length > 0 && (
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <Icon name="techniques" />
              <span className="text-faint">ATT&amp;CK</span>
              {p.techniqueIds.map((t, i) => (
                <span key={t} className="flex items-center gap-1.5">
                  {i > 0 && <span className="text-faint">·</span>}
                  <TechniqueChip id={t} />
                </span>
              ))}
            </span>
          )}
          {/* the phase-local weakness, right-aligned on the same summary row */}
          {p.cwe.length > 0 && (
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <span className="label shrink-0 text-faint">Exploited</span>
              {p.cwe.map((id) => (
                <span key={id} className="mono rounded border border-tool/40 bg-tool/10 px-1.5 py-0.5 text-xs text-fg">
                  {cweLabel(id)}
                </span>
              ))}
            </span>
          )}
        </div>

        {/* deeper breakdown — each a clearly-headed section, separated so they don't run together */}
        <div className="divide-y divide-edge/60 px-4">
          {p.objectives.length > 0 && (
            <section className="py-3.5">
              <Objectives items={p.objectives} />
            </section>
          )}

          {p.insights.length > 0 && (
            <section className="py-3.5">
              <h3 className="label mb-2 text-faint">
                Insights <span className="text-muted">· {p.insights.length} to improve</span>
              </h3>
              <ul className="space-y-2">
                {p.insights.map((it) => (
                  <InsightRow key={it.id} item={it} />
                ))}
              </ul>
            </section>
          )}

          {p.manual.length > 0 && (
            <section className="py-3.5">
              <Group title="Additional items to manually check" items={p.manual} dot="var(--color-tool)" />
            </section>
          )}

          {clean && p.objectives.length === 0 && <p className="py-3.5 text-sm text-match">Clean phase — no detours, loops, or stalls.</p>}
        </div>
      </div>
    </details>
  );
}

/** Cross-cutting coaching with no single home phase — the Lighthouse "General" group. */
function GeneralCard({ items }: { items: AuditItem[] }) {
  return (
    <details className="rise rounded-lg border border-edge bg-panel">
      <summary className="flex cursor-pointer list-none items-center gap-3.5 px-4 py-3">
        <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-panel-2 text-xl text-faint">∗</span>
        <div className="min-w-0 flex-1">
          <span className="font-display text-sm font-semibold tracking-tight text-fg">General</span>
          <div className="mt-0.5 text-xs text-muted">cross-cutting — not tied to a single phase</div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: "var(--color-signal)", backgroundColor: "color-mix(in oklch, var(--color-signal) 14%, transparent)" }}>
            {items.length} to improve
          </span>
          <span className="text-faint transition-transform [details[open]_&]:rotate-90">▸</span>
        </div>
      </summary>
      <div className="border-t border-edge px-4 py-3">
        <div className="label mb-2 text-faint">Insights</div>
        <ul className="space-y-2">
          {items.map((it) => (
            <InsightRow key={it.id} item={it} />
          ))}
        </ul>
      </div>
    </details>
  );
}

/**
 * Phase audit — the debrief recast as a Lighthouse-style checklist, one card per MITRE phase. Sits
 * directly under the KPI stats: scannable, text-first, actionable. Complements (does not replace) the
 * timeline/graph sections below.
 */
export function PhaseAudit() {
  const s = useReport();
  const { phases, general } = buildPhaseAudits(s.report);
  if (phases.length === 0 && general.length === 0) return null;

  const totalInsights = phases.reduce((a, p) => a + p.insights.length, 0) + general.length;
  const totalManual = phases.reduce((a, p) => a + p.manual.length, 0);
  // keep the focus reactive so deep-links from here highlight elsewhere (and vice-versa)
  void activeSeq(s);

  // the single most important lesson — the top-ranked coaching step, led here as the audit's headline
  const lead = normalizeCoaching(s.report.coaching?.next_steps)[0];
  const takeaway = lead ? stepText(lead) : undefined;

  return (
    <Section title="Phase audit" subtitle={`per MITRE phase · ${totalInsights} insight${totalInsights === 1 ? "" : "s"}, ${totalManual} to check`}>
      {takeaway && (
        <div className="mb-3 rounded-lg bg-signal/10 px-3.5 py-3">
          <span className="label text-signal">Key takeaway</span>
          <p className="mt-1 text-base leading-relaxed text-fg">{takeaway}</p>
        </div>
      )}
      <div className="space-y-2.5">
        {phases.map((p) => (
          <PhaseCard key={p.tactic} p={p} />
        ))}
        {general.length > 0 && <GeneralCard items={general} />}
      </div>
    </Section>
  );
}
