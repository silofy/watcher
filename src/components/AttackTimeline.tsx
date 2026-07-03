import { useReport, activeSeq } from "../store/report";
import { AXIS_W, episodeColor, episodeLane, ACTOR_COLORS, ALIGNMENT_COLORS } from "../lib/scale";
import { Section, ActorLegend, Chip } from "./ui";
import { useAxisZoom } from "./useAxisZoom";
import { ZoomControls } from "./ZoomControls";
import { techniqueName } from "../lib/attack";
import { fmtDuration, fmtClock } from "../lib/format";
import { ghostMarkers, verdictMeta, connectorLabel } from "../lib/ghost/ghost-view";

const GHOST_H = 14; // ghost-overlay lane height in viewBox units — thin, secondary to the ribbon

const RIB_H = 44; // ribbon height in viewBox units

function effColor(e: number): string {
  return e >= 75 ? "var(--color-match)" : e >= 50 ? "var(--color-stuck)" : "var(--color-skipped)";
}

// Recognizable short forms for tight phase blocks (MITRE tactic → label), so we never slice mid-word.
const SHORT_TACTIC: Record<string, string> = {
  TA0043: "Recon",
  TA0042: "Resource",
  TA0007: "Discovery",
  TA0001: "Access",
  TA0002: "Exec",
  TA0003: "Persist",
  TA0004: "PrivEsc",
  TA0005: "Defense",
  TA0006: "Creds",
  TA0008: "Lateral",
  TA0009: "Collect",
  TA0011: "C2",
  TA0010: "Exfil",
  TA0040: "Impact",
};
function shortLabel(tactic: string, label: string): string {
  return SHORT_TACTIC[tactic] ?? label.split(" ")[0];
}

export function AttackTimeline() {
  const s = useReport();
  const { report, timeline, phaseWindows, playheadMs, metrics } = s;
  const focus = activeSeq(s);
  const hovered = focus != null ? timeline.bySeq.get(focus) : null;

  // the distinct techniques behind the "N techniques" count — grouped, in first-seen order
  const techMap = new Map<string, { id: string; seqs: number[] }>();
  for (const e of report.episodes) {
    if (!e.technique) continue;
    const t = techMap.get(e.technique) ?? { id: e.technique, seqs: [] };
    t.seqs.push(e.seq);
    techMap.set(e.technique, t);
  }
  const techniques = [...techMap.values()].sort((a, b) => a.seqs[0] - b.seqs[0]);
  // Split the ribbon into host / on-target lanes only when a shell was tapped (an ssh:<target>
  // context appears); otherwise it stays one band, exactly as before.
  const twoLane = report.episodes.some((e) => episodeLane(e) === "target");
  // shared drag-to-zoom — window lives in the store, synced with the deviation chart
  const { w0, w1, span, zx, leftPct, zoomed, zoomOut, reset, sel, handlers } = useAxisZoom(timeline.totalMs);

  // ghost overlay (schema v1.4, additive) — each objective's unlock vs. actual instant projected onto
  // the same shared axis; absent when the report carries no golden tree.
  const ghostItems = report.ghost?.items ?? [];
  const markers = ghostItems.length ? ghostMarkers(ghostItems, timeline) : [];

  return (
    <Section
      title="How the run unfolded"
      subtitle={`MITRE phases, tinted by efficiency · ${metrics.technique_breadth} distinct ATT&CK techniques`}
      right={<ActorLegend />}
      srTitle
    >
      <ZoomControls zoomed={zoomed} w0={w0} w1={w1} zoomOut={zoomOut} reset={reset} />

      {/* phase header + ribbon share one drag-to-zoom surface — drag anywhere across them */}
      <div className="cursor-crosshair select-none" {...handlers}>
        {/* phase header — proportional blocks, color-coded by efficiency; no overlapping labels */}
        <div className="relative mb-1.5 h-12 overflow-hidden">
        {phaseWindows.map(({ phase, t0, t1 }) => {
          const left = leftPct(t0);
          const width = leftPct(t1) - left;
          const c = effColor(phase.efficiency_pct);
          const eff = Math.round(phase.efficiency_pct);
          // tiers: full label + "X% efficient" → short label + "X%" → just "X%" → tint only (tooltip)
          const tier = width >= 15 ? "full" : width >= 7 ? "mid" : width >= 3.5 ? "tiny" : "sliver";
          return (
            <div
              key={phase.mitre_tactic}
              className={`absolute top-0 flex h-full flex-col overflow-hidden rounded-md border px-2 ${tier === "tiny" ? "items-center justify-center" : "justify-center"}`}
              style={{
                left: `${left}%`,
                width: `calc(${width}% - 3px)`,
                borderColor: `color-mix(in oklch, ${c} 45%, var(--color-edge))`,
                background: `color-mix(in oklch, ${c} 13%, var(--color-panel))`,
              }}
              title={`${phase.label} · ${eff}% efficient`}
            >
              {tier === "full" && (
                <>
                  <span className="truncate text-xs font-medium text-fg">{phase.label}</span>
                  <span className="mono text-xs tabular-nums" style={{ color: c }}>{eff}% efficient</span>
                </>
              )}
              {tier === "mid" && (
                <>
                  <span className="truncate text-xs font-medium text-fg">{shortLabel(phase.mitre_tactic, phase.label)}</span>
                  <span className="mono text-xs tabular-nums" style={{ color: c }}>{eff}%</span>
                </>
              )}
              {tier === "tiny" && (
                <span className="mono text-xs tabular-nums" style={{ color: c }}>{eff}%</span>
              )}
              {/* sliver: no text — the tint carries it, full detail on hover */}
            </div>
          );
        })}
      </div>

      {/* episode ribbon — one shared axis; split into host / on-target lanes once a shell is tapped */}
      <div className="relative h-11 overflow-hidden rounded-md border border-edge bg-ink/40">
        <svg viewBox={`0 0 ${AXIS_W} ${RIB_H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {timeline.items.map(({ ep, gapStart, t1 }) => {
            const x = zx(gapStart);
            const w = Math.max(1.5, zx(t1) - x);
            const dim = focus != null && focus !== ep.seq;
            const onTarget = twoLane && episodeLane(ep) === "target";
            const y = onTarget ? RIB_H / 2 : 0;
            const h = twoLane ? RIB_H / 2 : RIB_H;
            return (
              <rect
                key={ep.seq}
                x={x}
                y={y}
                width={w}
                height={h}
                fill={episodeColor(ep)}
                opacity={dim ? 0.22 : 0.9}
                stroke={focus === ep.seq ? "var(--color-fg)" : "none"}
                strokeWidth={focus === ep.seq ? 2 : 0}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => s.hover(ep.seq)}
                onMouseLeave={() => s.hover(null)}
                onClick={() => s.select(s.selectedSeq === ep.seq ? null : ep.seq)}
              >
                <title>{`#${ep.seq} ${ep.binary} · ${onTarget ? "on-target" : "host"} — ${fmtDuration(ep.duration_ms + ep.gap_before_ms)}`}</title>
              </rect>
            );
          })}

          {/* lane divider between host (top) and on-target (bottom) */}
          {twoLane && (
            <line x1={0} y1={RIB_H / 2} x2={AXIS_W} y2={RIB_H / 2} stroke="var(--color-edge)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          )}

          {/* phase boundary separators — align the ribbon to the phase blocks above */}
          {phaseWindows.slice(1).map(({ phase, t0 }) => (
            <line key={`sep-${phase.mitre_tactic}`} x1={zx(t0)} y1={0} x2={zx(t0)} y2={RIB_H} stroke="var(--color-ink)" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}

          {/* live zoom-brush selection */}
          {sel && (
            <rect
              x={Math.min(sel[0], sel[1]) * AXIS_W}
              y={0}
              width={Math.abs(sel[1] - sel[0]) * AXIS_W}
              height={RIB_H}
              fill="color-mix(in oklch, var(--color-signal) 18%, transparent)"
              stroke="var(--color-signal)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* shared playhead */}
          <line x1={zx(playheadMs)} y1={0} x2={zx(playheadMs)} y2={RIB_H} stroke="var(--color-fg)" strokeWidth={1} opacity={0.75} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>
        {/* lane labels — HTML overlay so they aren't stretched by the ribbon's preserveAspectRatio="none" */}
        {twoLane && (
          <>
            <span className="label pointer-events-none absolute left-1.5 top-0.5 text-[10px] leading-none text-faint">host</span>
            <span className="label pointer-events-none absolute bottom-0.5 left-1.5 text-[10px] leading-none text-faint">on-target</span>
          </>
        )}
        </div>
      </div>

      {/* ghost overlay (schema v1.4, additive) — muted unlock/actual markers per objective; a
          connector shows the gap when a late pivot left them apart. Absent when there's no golden tree. */}
      {markers.length > 0 && (
        <div className="mt-1 overflow-x-auto">
          <svg viewBox={`0 0 ${AXIS_W} ${GHOST_H}`} preserveAspectRatio="none" className="h-3.5 w-full">
            {markers.map((m) => {
              const meta = verdictMeta(m.verdict);
              const ux = m.unlockMs != null ? zx(m.unlockMs) : null;
              const ax = m.actualMs != null ? zx(m.actualMs) : null;
              const mid = GHOST_H / 2;
              const label = connectorLabel(m.verdict);
              return (
                <g key={m.objective} opacity={0.85}>
                  {ux != null && ax != null && ux !== ax && label != null && (
                    <line
                      x1={ux}
                      y1={mid}
                      x2={ax}
                      y2={mid}
                      stroke={meta.tone}
                      strokeWidth={1.25}
                      strokeDasharray="2,2"
                      vectorEffect="non-scaling-stroke"
                    >
                      <title>{`${m.objective.replace(/_/g, " ")} — ${label}`}</title>
                    </line>
                  )}
                  {ux != null && (
                    <circle cx={ux} cy={mid} r={1.75} fill="var(--color-faint)">
                      <title>{`${m.objective.replace(/_/g, " ")} — unlocked here`}</title>
                    </circle>
                  )}
                  {ax != null && (
                    <circle cx={ax} cy={mid} r={2.25} fill={meta.tone}>
                      <title>{`${m.objective.replace(/_/g, " ")} — ${meta.label}`}</title>
                    </circle>
                  )}
                </g>
              );
            })}
          </svg>
          <div className="mt-0.5 text-[10px] text-faint">ghost: dim = unlocked · bright = your step, colored by verdict</div>
        </div>
      )}

      {/* axis — HTML row, crisp 12px; ticks track the zoom window */}
      <div className="mono mt-1 flex justify-between text-xs text-faint">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(w0 + f * span)}</span>
        ))}
      </div>

      {/* hover detail — what you ran, when, and how it aligned */}
      <div className="mt-3 min-h-[2.75rem] rounded-lg border border-edge bg-panel-2/40 px-3 py-2">
        {hovered ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span className="text-faint">#{hovered.ep.seq}</span>
            <span className="mono text-fg">{hovered.ep.binary}</span>
            {hovered.ep.alignment && <Chip color={ALIGNMENT_COLORS[hovered.ep.alignment]}>{hovered.ep.alignment.replace(/_/g, "-")}</Chip>}
            <span className="text-xs" style={{ color: ACTOR_COLORS[hovered.ep.actor] }}>
              {hovered.ep.actor.replace("_", " ")}
            </span>
            <span className="text-xs text-faint">{fmtDuration(hovered.ep.duration_ms + hovered.ep.gap_before_ms)}</span>
            {hovered.ep.technique && (
              <span className="text-xs text-faint">
                <span className="mono text-muted">{hovered.ep.technique}</span> {techniqueName(hovered.ep.technique)}
              </span>
            )}
            {hovered.ep.frameworks?.ukc && (
              <span className="text-xs text-faint">
                UKC <span className="text-muted">{hovered.ep.frameworks.ukc.replace(/-/g, " ")}</span>
              </span>
            )}
            {!!hovered.ep.frameworks?.cwe?.length && (
              <span className="mono text-xs text-muted">{hovered.ep.frameworks.cwe.join(" ")}</span>
            )}
            <span className="mono w-full truncate text-xs text-muted">$ {hovered.ep.cmd || "— (thinking)"}</span>
          </div>
        ) : (
          <p className="flex h-full items-center text-xs text-faint">Hover or click a block to inspect — the command log and replay follow.</p>
        )}
      </div>

      {/* the techniques behind the count — substantiate "N distinct", each deep-links to its first step */}
      {techniques.length > 0 && (
        <details className="group mt-2 rounded-lg border border-edge bg-panel-2/30">
          <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2">
            <span className="text-faint transition-transform group-open:rotate-90">▸</span>
            <span className="label text-faint">ATT&CK techniques</span>
            <span className="text-xs text-muted">· {techniques.length} distinct</span>
          </summary>
          <div className="grid gap-x-6 gap-y-0.5 border-t border-edge px-3 py-2 sm:grid-cols-2">
            {techniques.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => s.reveal(t.seqs[0])}
                onMouseEnter={() => s.hover(t.seqs[0])}
                onMouseLeave={() => s.hover(null)}
                className="grid grid-cols-[5rem_1fr_auto] items-baseline gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors hover:bg-panel-2/60"
                title={`First used at step ${t.seqs[0]} — click to inspect`}
              >
                <span className="mono text-xs text-fg">{t.id}</span>
                <span className="truncate text-muted">{techniqueName(t.id)}</span>
                <span className="mono text-xs text-faint">{t.seqs.length}×</span>
              </button>
            ))}
          </div>
        </details>
      )}
    </Section>
  );
}
