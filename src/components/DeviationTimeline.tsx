import { useEffect, useState } from "react";
import { useReport, activeSeq } from "../store/report";
import { AXIS_W } from "../lib/scale";
import { Section, LedgerRow, Num, Chip } from "./ui";
import { useAxisZoom } from "./useAxisZoom";
import { ZoomControls } from "./ZoomControls";
import { detectFlags } from "../lib/flags";
import { resolveProvider } from "../lib/llm";
import { refineCoaching, type CoachStep } from "../lib/llm/coach";
import { fmtDuration, fmtClock } from "../lib/format";
import type { Episode, GoldenObjective } from "../types/report";

/**
 * "Where you deviated" — the honest, self-relative timeline (Layer 1). No write-up needed: it reads
 * loops (failed retries), dead-ends (errors / low-yield), and stalls (long think-gaps) straight from
 * your telemetry. The flow reads flat teal; wasted time spikes coral. Layer 2 (straying from the
 * intended path, sourced from write-ups) overlays here later.
 */

const STUCK_MS = 90_000; // a gap longer than this reads as a stall
const H = 86; // viewBox sits just below the baseline — no dead band before the axis row
const TOP = 10;
const BASE_Y = 78; // baseline the bars sit on
const MAX_BAR = 56;
const ONTRACK_H = 5;

type Kind = "ontrack" | "detour" | "loop";
function kindOf(ep: Episode): Kind {
  if (ep.loop_of_seq != null) return "loop";
  if (ep.alignment === "detour") return "detour";
  if (ep.exit_code != null && ep.exit_code !== 0) return "detour";
  return "ontrack";
}
const BAR_COLOR: Record<Kind, string> = {
  ontrack: "var(--color-manual)",
  detour: "var(--color-detour)",
  loop: "var(--color-stuck)",
};

function Readout({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="label">{label}</span>
      <span className="font-display text-lg font-semibold leading-none tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
      {sub && <span className="text-xs text-faint">{sub}</span>}
    </div>
  );
}

type DevKind = "dead-end" | "loop" | "stall";
const DEV_COLOR: Record<DevKind, string> = { "dead-end": "var(--color-detour)", loop: "var(--color-stuck)", stall: "var(--color-detour)" };
const costLabel = (ms: number) => (ms >= 60_000 ? `${Math.round(ms / 60_000)}m` : `${Math.max(1, Math.round(ms / 1000))}s`);

/** Per-step coaching: what you did → what a coach would suggest, grounded in the golden DAG. */
function coachFor(ep: Episode, golden: GoldenObjective[]): { suggested: string; good: boolean } {
  const k = kindOf(ep);
  const satisfied = golden.find((o) => o.user_satisfied_by_seq === ep.seq);
  if (k === "ontrack" && satisfied) return { good: true, suggested: `Right move — this satisfied “${satisfied.objective.replace(/_/g, " ")}”.` };
  if (k === "loop") return { good: false, suggested: `Retrying ${ep.binary} after it failed rarely flips the result — change the input or pivot to another vector.` };
  // detour / stall / unmatched → point at the intended next step
  if (golden.length) {
    const nextAfter = golden
      .filter((o) => o.user_satisfied_by_seq != null && (o.user_satisfied_by_seq as number) > ep.seq)
      .sort((a, b) => (a.user_satisfied_by_seq as number) - (b.user_satisfied_by_seq as number))[0];
    const target = nextAfter ?? golden.find((o) => o.user_satisfied_by_seq == null);
    if (target) return { good: false, suggested: `Intended here: “${target.objective.replace(/_/g, " ")}” via ${target.satisfied_by[0]}.` };
  }
  if (ep.gap_before_ms >= STUCK_MS) return { good: false, suggested: `A ${fmtDuration(ep.gap_before_ms)} pause — when stuck this long, re-read your last output or enumerate more methodically.` };
  if (k === "detour") return { good: false, suggested: `Low-yield — this didn’t move an objective. Step back to enumeration before forcing a path.` };
  return { good: true, suggested: "On track." };
}

export function DeviationTimeline() {
  const s = useReport();
  const { timeline, playheadMs } = s;
  const focus = activeSeq(s);
  const items = timeline.items;
  const [crossMs, setCrossMs] = useState<number | null>(null);
  const [coached, setCoached] = useState<Map<number, string>>(new Map());

  // shared x-axis zoom (drag to zoom) — the window lives in the store, synced with the swimlane.
  const { w0, w1, span, zx, zoomed, zoomOut, reset, sel, handlers } = useAxisZoom(timeline.totalMs, setCrossMs);

  // LLM-refine the coaching for each deviation step (local model only; degrades to rules-based).
  useEffect(() => {
    let alive = true;
    const golden = s.report.golden_dag;
    const steps: CoachStep[] = [];
    for (const it of timeline.items) {
      const ep = it.ep;
      const k = kindOf(ep);
      const isDev = k !== "ontrack" || ep.gap_before_ms >= STUCK_MS;
      if (!isDev) continue;
      steps.push({ seq: ep.seq, cmd: ep.cmd, output: ep.output_digest ?? "", kind: k !== "ontrack" ? k : "stall", intended: coachFor(ep, golden).suggested });
    }
    setCoached(new Map());
    if (steps.length === 0) return;
    (async () => {
      const provider = await resolveProvider();
      const m = await refineCoaching(s.report, steps, provider);
      if (alive && m.size) setCoached(m);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.report.session.uuid, s.report.golden_dag.length, timeline.items.length]);

  const deviations: typeof items = [];
  for (const it of items) {
    if (kindOf(it.ep) !== "ontrack") deviations.push(it);
  }
  const stalls = items.filter((it) => it.ep.gap_before_ms >= STUCK_MS);
  const biggestStall = stalls.slice().sort((a, b) => b.ep.gap_before_ms - a.ep.gap_before_ms)[0];

  // Time lost — the canonical wasted / active-time figure the grade's efficiency and the bento "time
  // lost" tile both report, so this detail headline can't contradict the glance. (It was self-computed
  // over wall-clock totalMs before, which disagreed with the tile's t_active_ms basis.)
  const tw = s.report.metrics.time_waster;
  const lostMs = tw.detour_ms + tw.stuck_ms + tw.loop_ms;
  const lostPct = Math.round((lostMs / Math.max(1, tw.t_active_ms)) * 100);

  // scale deviation-bar height by time cost relative to the worst one
  const maxCost = Math.max(1, ...deviations.map((it) => it.ep.duration_ms));
  const empty = items.length === 0;

  const deadEnds = deviations.filter((it) => kindOf(it.ep) === "detour").length;
  const loops = deviations.filter((it) => kindOf(it.ep) === "loop").length;

  // the "biggest time sinks" — one human line each, cost-first; the command + coaching live on hover
  const devRows: { seq: number; kind: DevKind; costMs: number; desc: string }[] = [];
  for (const it of items) {
    const ep = it.ep;
    const k = kindOf(ep);
    const b = ep.binary || "a command";
    if (k === "detour") devRows.push({ seq: ep.seq, kind: "dead-end", costMs: ep.duration_ms, desc: `${b} — ${ep.output_digest || (ep.exit_code ? `exited ${ep.exit_code}` : "no useful result")}` });
    else if (k === "loop") devRows.push({ seq: ep.seq, kind: "loop", costMs: ep.duration_ms, desc: `${b} — retried after it failed` });
    if (ep.gap_before_ms >= STUCK_MS) devRows.push({ seq: ep.seq, kind: "stall", costMs: ep.gap_before_ms, desc: `paused before ${b}` });
  }
  devRows.sort((a, b) => b.costMs - a.costMs);
  const activeIt = focus != null ? timeline.bySeq.get(focus) : null;

  // flag-capture milestones — gold pennants, the box's checkpoints (distinct from the teal flow / coral waste)
  const flagEvents = detectFlags(items.map((it) => it.ep)).events.map((fe) => {
    const it = items.find((i) => i.ep.seq === fe.seq);
    const both = fe.kinds.includes("user") && fe.kinds.includes("system");
    return { seq: fe.seq, atMs: it ? it.t1 : 0, label: both ? "Both flags" : fe.kinds.includes("system") ? "System flag" : "User flag" };
  });

  const legend = (
    <div className="flex items-center gap-3 text-xs">
      {(["ontrack", "detour", "loop"] as Kind[]).map((k) => (
        <span key={k} className="flex items-center gap-1.5 text-faint">
          <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: BAR_COLOR[k] }} />
          {k === "ontrack" ? "on-track" : k === "detour" ? "dead-end" : "loop"}
        </span>
      ))}
      <span className="flex items-center gap-1.5 text-faint">
        <span className="inline-block h-2 w-2 rounded-[1px]" style={{ background: "color-mix(in oklch, var(--color-detour) 30%, transparent)" }} />
        stall
      </span>
      <span className="flex items-center gap-1.5 text-faint">
        <span className="inline-block h-2.5 w-1 rounded-[1px]" style={{ background: "var(--color-flag)" }} />
        ⚑ flag
      </span>
    </div>
  );

  return (
    <Section title="Where you deviated" subtitle="measured against your own run — not an optimal path" right={legend}>
      {/* glance readouts — align tops so the numbers sit on one row and any sub-caption hangs below */}
      <div className="mb-3 flex flex-wrap items-start gap-x-8 gap-y-3">
        <Readout
          label="Time lost"
          value={fmtDuration(lostMs)}
          sub={`${lostPct}% of active time`}
          color={lostPct >= 30 ? "var(--color-detour)" : lostPct >= 15 ? "var(--color-stuck)" : "var(--color-match)"}
        />
        <Readout label="Dead-ends" value={String(deadEnds)} color={deadEnds ? "var(--color-detour)" : undefined} />
        <Readout label="Loops" value={String(loops)} color={loops ? "var(--color-stuck)" : undefined} />
        <Readout label="Stalls" value={String(stalls.length)} sub={biggestStall ? `worst ${fmtDuration(biggestStall.ep.gap_before_ms)}` : undefined} color={stalls.length ? "var(--color-detour)" : undefined} />
      </div>

      {/* zoom controls — drag the chart to zoom into a window; buttons widen / reset */}
      <ZoomControls zoomed={zoomed} w0={w0} w1={w1} zoomOut={zoomOut} reset={reset} />

      {/* height encodes WASTED time; bars sit on a true zero baseline. Text is HTML (crisp ≥12px). */}
      <div className="relative cursor-crosshair select-none" style={{ height: 144 }} {...handlers}>
        <svg viewBox={`0 0 ${AXIS_W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* stall bands behind everything */}
          {stalls.map((it) => {
            const x = zx(it.gapStart);
            const w = Math.max(2, zx(it.t0) - x);
            return (
              <g key={`stall-${it.ep.seq}`}>
                <rect x={x} y={TOP} width={w} height={BASE_Y - TOP} fill="color-mix(in oklch, var(--color-detour) 12%, transparent)" />
                <line x1={x} y1={TOP} x2={x} y2={BASE_Y} stroke="var(--color-detour)" strokeWidth="1" strokeDasharray="2 3" opacity="0.5" />
              </g>
            );
          })}

          {/* true zero baseline */}
          <line x1={0} y1={BASE_Y} x2={AXIS_W} y2={BASE_Y} stroke="var(--color-edge)" strokeWidth="1" />

          {/* episode bars: flat teal on-track, coral spikes proportional to wasted time */}
          {items.map((it) => {
            const k = kindOf(it.ep);
            const x = zx(it.t0);
            const w = Math.max(1.5, zx(it.t1) - x);
            const dim = focus != null && focus !== it.ep.seq;
            const isWaste = k !== "ontrack";
            const h = isWaste ? Math.max(16, (it.ep.duration_ms / maxCost) * MAX_BAR) : ONTRACK_H;
            return (
              <rect
                key={it.ep.seq}
                x={x}
                y={BASE_Y - h}
                width={w}
                height={h}
                rx={1.5}
                fill={BAR_COLOR[k]}
                opacity={dim ? 0.25 : isWaste ? 0.95 : 0.6}
                stroke={focus === it.ep.seq ? "var(--color-fg)" : "none"}
                strokeWidth={focus === it.ep.seq ? 1.5 : 0}
                className="cursor-pointer transition-opacity"
                onMouseEnter={() => s.hover(it.ep.seq)}
                onMouseLeave={() => s.hover(null)}
                onClick={() => s.select(s.selectedSeq === it.ep.seq ? null : it.ep.seq)}
              >
                <title>{`#${it.ep.seq} ${it.ep.binary} — ${k === "ontrack" ? "on-track" : k} · ${fmtDuration(it.ep.duration_ms)}${it.ep.gap_before_ms >= STUCK_MS ? ` (stalled ${fmtDuration(it.ep.gap_before_ms)} before)` : ""}`}</title>
              </rect>
            );
          })}

          {/* flag-capture milestone lines — solid gold, so they read as checkpoints not flow (label is HTML, below) */}
          {flagEvents.map((fe) => (
            <line key={`flag-${fe.seq}`} x1={zx(fe.atMs)} y1={4} x2={zx(fe.atMs)} y2={BASE_Y} stroke="var(--color-flag)" strokeWidth={2} opacity={0.95} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}

          {/* live zoom-brush selection */}
          {sel && (
            <rect
              x={Math.min(sel[0], sel[1]) * AXIS_W}
              y={TOP}
              width={Math.abs(sel[1] - sel[0]) * AXIS_W}
              height={BASE_Y - TOP}
              fill="color-mix(in oklch, var(--color-signal) 18%, transparent)"
              stroke="var(--color-signal)"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          )}

          {/* shared playhead */}
          <line x1={zx(playheadMs)} y1={TOP} x2={zx(playheadMs)} y2={BASE_Y + 4} stroke="var(--color-fg)" strokeWidth={1} opacity={0.7} vectorEffect="non-scaling-stroke" pointerEvents="none" />

          {/* crosshair line (its label is HTML, below) */}
          {crossMs != null && <line x1={zx(crossMs)} y1={TOP} x2={zx(crossMs)} y2={BASE_Y} stroke="var(--color-faint)" strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" pointerEvents="none" />}
        </svg>

        {/* HTML label layer — crisp, never sub-12px */}
        <div className="pointer-events-none absolute inset-0">
          {flagEvents.map((fe) => {
            const pct = (zx(fe.atMs) / AXIS_W) * 100;
            if (pct < -2 || pct > 102) return null; // scrolled out of the zoom window
            const right = pct > 80;
            return (
              <span
                key={`fl-${fe.seq}`}
                className="absolute inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold shadow-sm"
                style={{ left: `${pct}%`, top: 18, transform: right ? "translateX(-100%)" : undefined, color: "var(--color-ink)", background: "var(--color-flag)" }}
              >
                ⚑ {fe.label} · {fmtClock(fe.atMs)}
              </span>
            );
          })}
          {crossMs != null && (
            <span
              className="mono absolute top-0 text-xs text-muted"
              style={{ left: `${(zx(crossMs) / AXIS_W) * 100}%`, transform: zx(crossMs) > AXIS_W - 90 ? "translateX(-100%)" : "translateX(2px)" }}
            >
              {fmtClock(crossMs)}
            </span>
          )}
        </div>
      </div>

      {/* axis — HTML row, crisp 12px; ticks track the zoom window */}
      <div className="mono mt-1 flex justify-between text-xs text-faint">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(w0 + f * span)}</span>
        ))}
      </div>

      {/* hover detail — a coaching card: what you ran, what happened, and the coach's call */}
      {!empty && (
        <div className="mt-3 min-h-[6.75rem] rounded-lg border border-edge bg-panel-2/40 p-3">
          {activeIt ? (
            (() => {
              const ep = activeIt.ep;
              const k = kindOf(ep);
              const stalled = ep.gap_before_ms >= STUCK_MS;
              const displayKind = k !== "ontrack" ? k : stalled ? "stall" : "on-track";
              const isWaste = k !== "ontrack" || stalled;
              const kindColor = !isWaste ? "var(--color-match)" : k === "loop" ? "var(--color-stuck)" : "var(--color-detour)";
              const c = coachFor(ep, s.report.golden_dag);
              const refined = coached.get(ep.seq);
              const suggestion = refined ?? c.suggested;
              const isGood = !refined && c.good;
              return (
                <div>
                  {/* what you did */}
                  <div className="flex flex-wrap items-center gap-2">
                    <Chip color={kindColor}>{displayKind}</Chip>
                    <span className="mono text-xs text-faint">cost {fmtDuration(isWaste && stalled && k === "ontrack" ? ep.gap_before_ms : ep.duration_ms)}</span>
                    {stalled && <span className="mono text-xs text-faint">· stalled {fmtDuration(ep.gap_before_ms)} first</span>}
                  </div>
                  <div className="mono mt-2 text-sm">
                    <span style={{ color: "var(--color-tool)" }}>$</span> <span className="text-fg">{ep.cmd || "— (thinking)"}</span>
                  </div>
                  {ep.output_digest && <div className="mono mt-0.5 truncate pl-3 text-xs text-faint">→ {ep.output_digest}</div>}

                  {/* the coach's call */}
                  <div className="mt-2.5 rounded-md bg-signal/10 px-2.5 py-2">
                    <div className="flex items-center gap-2">
                      <span className="label" style={{ color: isGood ? "var(--color-match)" : "var(--color-signal)" }}>
                        {isGood ? "✓ Good move" : "Coach"}
                      </span>
                      {refined && <span className="label rounded bg-signal/20 px-1.5 text-xs text-signal">ai</span>}
                    </div>
                    <p className="mt-1 text-sm leading-relaxed text-fg">{suggestion}</p>
                  </div>
                </div>
              );
            })()
          ) : (
            <div className="flex h-full min-h-[5rem] items-center justify-center px-4 text-center text-sm text-faint">
              Hover a step above — see exactly what you ran, what it cost, and what the coach would do instead.
            </div>
          )}
        </div>
      )}

      {/* biggest time sinks — cost-first, one human line each; command + coaching are on hover above */}
      {devRows.length > 0 ? (
        <div className="mt-3">
          <h3 className="label mb-1 text-faint">
            Biggest time sinks <span className="text-detour">· {fmtDuration(lostMs)} total</span>
          </h3>
          <div className="divide-y divide-edge/40">
            {devRows.map((r, i) => (
              <LedgerRow
                key={`${r.seq}-${r.kind}-${i}`}
                cols="2.5rem minmax(0,1fr) 5.5rem"
                active={focus === r.seq}
                onMouseEnter={() => s.hover(r.seq)}
                onMouseLeave={() => s.hover(null)}
                onClick={() => s.select(s.selectedSeq === r.seq ? null : r.seq)}
              >
                <Num className="text-right font-semibold tabular-nums" color={DEV_COLOR[r.kind]}>
                  {costLabel(r.costMs)}
                </Num>
                <span className="truncate text-fg">{r.desc}</span>
                <span className="justify-self-end">
                  <Chip color={DEV_COLOR[r.kind]}>{r.kind}</Chip>
                </span>
              </LedgerRow>
            ))}
          </div>
        </div>
      ) : (
        !empty && <p className="mt-3 text-xs text-faint">Clean run — no dead-ends, loops, or stalls detected.</p>
      )}

      {empty && <p className="mt-2 text-xs text-faint">No commands captured yet — deviations appear as you work.</p>}
    </Section>
  );
}
