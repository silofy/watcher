import { useReport, activeSeq } from "../store/report";
import { AXIS_W, ALIGNMENT_COLORS, ACTOR_COLORS } from "../lib/scale";
import { tierColor, Chip } from "./ui";
import { fmtClock, fmtDuration } from "../lib/format";
import { techniqueName } from "../lib/attack";
import { UKC_ORDER, type UkcPhase, ukcOf, ukcRank, ukcLabel, cweLabel } from "../lib/pipeline/frameworks";
import { isOnTarget } from "../lib/pipeline/mitre";
import { isLiveRecording } from "../lib/live";

const UKC_SHORT: Record<UkcPhase, string> = {
  reconnaissance: "Recon",
  exploitation: "Exploit",
  execution: "Exec",
  persistence: "Persist",
  "defense-evasion": "Evade",
  "credential-access": "Creds",
  "privilege-escalation": "PrivEsc",
  "lateral-movement": "Lateral",
  "command-and-control": "C2",
  collection: "Collect",
  exfiltration: "Exfil",
  objectives: "Objectives",
};

// Plain-language versions of the internal taxonomies — the card is read by an operator, not the pipeline.
const ALIGNMENT_LABEL: Record<string, string> = {
  match: "on the intended path",
  alternative: "alternative route",
  detour: "detour — off the path",
  skipped: "skipped step",
  out_of_order: "right move, wrong time",
};
const ACTOR_TEXT: Record<string, string> = {
  machine_bound: "tool working",
  human_active: "typed by hand",
  think_pause: "thinking / stuck",
  idle: "idle",
};

// viewBox height in shared-axis units; preserveAspectRatio="none" stretches it to the container.
const H = 100;
const TOP = 16;
const BOT = 20;

/**
 * Kill-chain trajectory — a first-class member of the shared time axis (brief §6.2), so it stacks
 * with the ATT&CK ribbon and stealth curve: same `AXIS_W` scale, same zoom window, same playhead,
 * same hover/selection. Each command sits at its real time (x) and its UKC phase (y); the line
 * climbs when the run advances in order and dips (red) on a backtrack. Progression, coverage, and
 * order are one picture, and it reflects live state instead of an arbitrary command index.
 *
 * `compact` trims it for the live bento: no detail card (the command feed handles inspection), a
 * shorter body, and the progression readout dropped (the tile header already carries it).
 */
export function KillChainTrajectory({ progression, compact = false }: { progression: number; compact?: boolean }) {
  const s = useReport();
  const { timeline, phaseWindows, playheadMs } = s;
  const focus = activeSeq(s);
  const live = isLiveRecording(s.report);
  // full-range shared scale (no zoom on this chart — it always shows the whole run)
  const total = Math.max(1, timeline.totalMs);
  const zx = (ms: number) => (ms / total) * AXIS_W;
  const leftPct = (ms: number) => (ms / total) * 100;

  const pts = timeline.items
    .filter((it) => it.ep.binary)
    .map((it) => {
      const phase = ukcOf(it.ep);
      return phase ? { it, phase, rank: ukcRank(phase) } : null;
    })
    .filter((p): p is NonNullable<typeof p> => p != null);

  if (pts.length < 2) {
    return <p className="text-xs text-faint">Not enough classified commands to chart a trajectory yet.</p>;
  }

  const reachedRanks = [...new Set(pts.map((p) => p.rank))].sort((a, b) => a - b);
  const rowOf = new Map(reachedRanks.map((r, i) => [r, i])); // 0 = lowest rank (bottom)
  const rows = reachedRanks.length;
  const rowStep = rows > 1 ? (H - TOP - BOT) / (rows - 1) : 0;
  const yOf = (rank: number) => TOP + (rows - 1 - rowOf.get(rank)!) * rowStep; // highest rank at top
  const topPct = (rank: number) => (yOf(rank) / H) * 100;

  const maxRank = Math.max(...pts.map((p) => p.rank));
  const furthest = pts.find((p) => p.rank === maxRank)!;
  const containerH = compact ? Math.max(104, rows * 30 + 30) : Math.max(128, rows * 38 + 48);

  return (
    <div>
      {/* legend + summary — above the chart, matching Stealth & Noise */}
      <div className="mb-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-faint">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-match)" }} /> advanced
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-4 rounded" style={{ background: "var(--color-detour)" }} /> backtracked
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: "var(--color-match)" }} /> furthest reached
        </span>
        {!compact && (
          <span className="ml-auto">
            progression <span style={{ color: tierColor(progression) }}>{Math.round(progression)}%</span> · {reachedRanks.length}/{UKC_ORDER.length} phases
          </span>
        )}
      </div>

      <div className="relative overflow-hidden rounded-md border border-edge bg-ink/40" style={{ height: containerH }}>
        <svg viewBox={`0 0 ${AXIS_W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          {/* phase-row guide lines */}
          {reachedRanks.map((r) => (
            <line key={r} x1={0} y1={yOf(r)} x2={AXIS_W} y2={yOf(r)} stroke="var(--color-edge)" strokeWidth={1} strokeDasharray="2 3" opacity={0.45} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}

          {/* phase-boundary separators — align the run to the ribbon above */}
          {phaseWindows.slice(1).map(({ phase, t0 }) => (
            <line key={`sep-${phase.mitre_tactic}`} x1={zx(t0)} y1={TOP} x2={zx(t0)} y2={H - BOT} stroke="var(--color-ink)" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}

          {/* trajectory — one segment per step, colored by direction (climb vs backtrack) */}
          {pts.slice(1).map((p, i) => {
            const prev = pts[i];
            const climb = p.rank >= prev.rank;
            return (
              <line
                key={p.it.ep.seq}
                x1={zx(prev.it.t1)}
                y1={yOf(prev.rank)}
                x2={zx(p.it.t1)}
                y2={yOf(p.rank)}
                stroke={climb ? "var(--color-match)" : "var(--color-detour)"}
                strokeWidth={2}
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                opacity={climb ? 0.85 : 0.95}
              />
            );
          })}

          {/* per-command hit columns — hover/click anywhere in a command's time span */}
          {pts.map((p) => (
            <rect
              key={p.it.ep.seq}
              x={zx(p.it.gapStart)}
              y={TOP}
              width={Math.max(1, zx(p.it.t1) - zx(p.it.gapStart))}
              height={H - TOP - BOT}
              fill={focus === p.it.ep.seq ? "color-mix(in oklch, var(--color-fg) 8%, transparent)" : "transparent"}
              className="cursor-pointer"
              onMouseEnter={() => s.hover(p.it.ep.seq)}
              onMouseLeave={() => s.hover(null)}
              onClick={() => s.select(s.selectedSeq === p.it.ep.seq ? null : p.it.ep.seq)}
            />
          ))}

          {/* shared playhead */}
          <line x1={zx(playheadMs)} y1={TOP} x2={zx(playheadMs)} y2={H - BOT} stroke="var(--color-fg)" strokeWidth={1} opacity={0.6} vectorEffect="non-scaling-stroke" pointerEvents="none" />
        </svg>

        {/* crisp HTML overlays (SVG is aspect-distorted): phase labels, command dots, furthest marker */}
        <div className="pointer-events-none absolute inset-0">
          {/* phase-row labels, floated at the left of each row */}
          {reachedRanks.map((r) => (
            <span
              key={r}
              className="label absolute left-1 rounded bg-ink/70 px-1 text-faint"
              style={{ top: `${topPct(r)}%`, transform: "translateY(-50%)" }}
            >
              {UKC_SHORT[UKC_ORDER[r]]}
            </span>
          ))}

          {/* live "you are here" ring, pulsing out from the furthest-reached point */}
          {live &&
            (() => {
              const left = leftPct(furthest.it.t1);
              if (left < -1 || left > 101) return null;
              return (
                <span
                  className="live-ping absolute rounded-full"
                  style={{ left: `${left}%`, top: `${topPct(furthest.rank)}%`, width: 10, height: 10, background: "var(--color-match)" }}
                />
              );
            })()}

          {/* one dot per command — the marker whose color says advance/hold/backtrack. New dots pop in;
              dots glide when a newly-reached phase re-lays-out the rows. */}
          {pts.map((p, i) => {
            const left = leftPct(p.it.t1);
            if (left < -1 || left > 101) return null;
            const isFocus = focus === p.it.ep.seq;
            const isFurthest = p.it.ep.seq === furthest.it.ep.seq;
            const prevRank = i > 0 ? pts[i - 1].rank : p.rank;
            const color = isFocus ? "var(--color-signal)" : isFurthest ? "var(--color-match)" : p.rank < prevRank ? "var(--color-detour)" : "var(--color-fg)";
            const size = isFocus ? 9 : isFurthest ? 8 : 5;
            return (
              <span
                key={p.it.ep.seq}
                className="dot-pop absolute rounded-full"
                style={{
                  left: `${left}%`,
                  top: `${topPct(p.rank)}%`,
                  width: size,
                  height: size,
                  background: color,
                  opacity: isFocus || isFurthest ? 1 : 0.7,
                  transform: "translate(-50%, -50%)",
                  transition: "top 380ms var(--ease-out-expo), left 380ms var(--ease-out-expo), width 200ms var(--ease-out-quart), height 200ms var(--ease-out-quart)",
                  boxShadow: isFocus ? "0 0 0 3px color-mix(in oklch, var(--color-signal) 30%, transparent)" : undefined,
                }}
              />
            );
          })}
        </div>
      </div>

      {/* axis — the same clock the ribbon and stealth curve use */}
      <div className="mono mt-1 flex justify-between text-xs text-faint">
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <span key={f}>{fmtClock(f * total)}</span>
        ))}
      </div>

      {/* selected/hovered command — a proper detail card, not a bare text row (skipped in compact) */}
      {!compact && (
        <div className="mt-3">
          {focus != null && timeline.bySeq.get(focus) ? (
            (() => {
              const ep = timeline.bySeq.get(focus)!.ep;
              const phase = ukcOf(ep);
              const pinned = s.selectedSeq === ep.seq;
              return (
                <div className="overflow-hidden rounded-lg border border-edge bg-panel-2/50">
                  {/* header — identity, phase, alignment, pin state */}
                  <div className="flex flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
                    <span className="mono rounded bg-ink/70 px-1.5 py-0.5 text-xs text-faint">Step {ep.seq}</span>
                    <span className="mono text-sm font-semibold text-fg">{ep.binary}</span>
                    {phase && <Chip color="var(--color-alt)">{ukcLabel(phase)}</Chip>}
                    {ep.alignment && <Chip color={ALIGNMENT_COLORS[ep.alignment]}>{ALIGNMENT_LABEL[ep.alignment] ?? ep.alignment.replace(/_/g, " ")}</Chip>}
                    {isOnTarget(ep.context_path) && (
                      <Chip color="var(--color-tool)">on target{ep.context_path?.match(/ssh:(\S+)/) ? `: ${ep.context_path.match(/ssh:(\S+)/)![1]}` : ""}</Chip>
                    )}
                    {pinned ? (
                      <button type="button" onClick={() => s.select(null)} className="label ml-auto rounded border border-edge px-1.5 py-0.5 text-xs text-faint transition-colors hover:text-fg">
                        pinned · clear
                      </button>
                    ) : (
                      <span className="ml-auto text-xs text-faint">click a dot to pin</span>
                    )}
                  </div>

                  {/* the command itself, in a terminal-style block */}
                  <div className="px-3 py-2.5">
                    <div className="mono flex items-start gap-2 overflow-x-auto rounded bg-ink/60 px-2.5 py-2 text-xs">
                      <span className="select-none text-match">$</span>
                      <span className="whitespace-pre text-fg">{ep.cmd || "— (thinking)"}</span>
                    </div>

                    {/* meta — each value self-describing, so a pro doesn't have to decode it */}
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
                      <span className="flex items-center gap-1.5" title="who was driving this step">
                        <span className="inline-block h-2 w-2 rounded-sm" style={{ background: ACTOR_COLORS[ep.actor] }} />
                        {ACTOR_TEXT[ep.actor] ?? ep.actor.replace(/_/g, " ")}
                      </span>
                      <span title="time on this step, including the pause before it">{fmtDuration(ep.duration_ms + ep.gap_before_ms)} on this step</span>
                      {ep.technique && (
                        <span title="MITRE ATT&CK technique">
                          <span className="mono text-muted">{ep.technique}</span> {techniqueName(ep.technique)}
                        </span>
                      )}
                      {!!ep.frameworks?.cwe?.length && <span title="weakness class exploited">{ep.frameworks.cwe.map(cweLabel).join(" · ")}</span>}
                    </div>

                    {ep.output_digest && (
                      <div className="mt-2 flex items-start gap-2 border-t border-edge/60 pt-2 text-xs">
                        <span className="label shrink-0 text-faint">result</span>
                        <span className="text-muted">{ep.output_digest}</span>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()
          ) : (
            <p className="rounded-lg border border-dashed border-edge/70 px-3 py-3 text-center text-xs text-faint">
              Hover a command to preview it — <span className="text-muted">click a dot to pin</span> the full details here.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
