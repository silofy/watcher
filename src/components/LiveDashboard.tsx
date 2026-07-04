import type { CSSProperties, ReactNode } from "react";
import { useReport, activeSeq } from "../store/report";
import { isLiveRecording } from "../lib/live";
import { topUnmetCheck } from "../lib/analysis/methodology";
import { fmtDuration } from "../lib/format";
import { tierColor, Chip } from "./ui";
import { episodeNoise, NOISE_BASELINE } from "../lib/metrics";
import { episodeColor, ALIGNMENT_COLORS } from "../lib/scale";
import { SHORT_TACTIC } from "../lib/audits";
import { ukcOf, ukcLabel } from "../lib/pipeline/frameworks";
import { detectFlags } from "../lib/flags";
import { techniqueName } from "../lib/attack";
import { openDetail } from "../lib/nav";
import { ArrowUpRight, Flag, ScanEye } from "./icons";

// plain-language actor labels for the detail card
const ACTOR_TEXT: Record<string, string> = { machine_bound: "machine bound", human_active: "typed by hand", think_pause: "thinking", idle: "idle" };
import { KillChainTrajectory } from "./KillChainTrajectory";
import { AnimatedNumber } from "./AnimatedNumber";
import type { Episode, WatcherReport } from "../types/report";
import type { TimedEpisode, Timeline } from "../lib/scale";

/**
 * The Ops bento — a grid of small, glanceable instruments that lives above the accordion detail in two
 * modes, staying MOUNTED across the transition so the live→results hand-off is fluid, not a swap:
 *
 *   • Recording ("Live ops") — the mid-run companion: where am I, am I loud, what did my last moves do.
 *   • Resolved ("Run summary") — the same tiles as a settled results card (the summarized counterpart to
 *     the accordion Details below); the live command feed becomes a "key moments" recap.
 *
 * Every tile derives from telemetry alone (no write-up), so it renders for a live box and an archived
 * one alike. The container tint eases from live-coral to neutral when the run resolves.
 */

/** A bento tile — a bordered card with a stenciled label header and an optional right-aligned readout.
 *  `i` staggers its entrance so the tiles cascade in when the panel appears. */
function Tile({ label, right, className = "", i = 0, children }: { label: string; right?: ReactNode; className?: string; i?: number; children: ReactNode }) {
  return (
    <div className={`rise flex flex-col rounded-lg border border-edge bg-ink/30 p-3 ${className}`} style={{ "--i": i } as CSSProperties}>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <span className="label text-faint">{label}</span>
        {right}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

/**
 * A vertical stealth-burn column — noise stacks up from the bottom, one segment per noisy command
 * (silent commands add nothing), so you watch the run "burn" toward the lab-baseline ceiling. Vertical
 * so it fills the tile's height as the kill-chain chart beside it grows. Loud moments glow brighter.
 */
function VerticalBurn({ items, baseline, loudSeq, focus, onSelect }: { items: TimedEpisode[]; baseline: number; loudSeq: Set<number>; focus: number | null; onSelect: (seq: number) => void }) {
  const noises = items.map((it) => ({ seq: it.ep.seq, noise: episodeNoise(it.ep), binary: it.ep.binary }));
  const totalCum = noises.reduce((a, b) => a + b.noise, 0);
  // keep headroom above the baseline so the ceiling line is always visible (not pinned to the clipped
  // top edge) when the run is still quiet; once noise passes the baseline the column scales to it and the
  // fill climbs into the "over-baseline" zone above the line.
  const scaleMax = Math.max(baseline * 1.18, totalCum, 1);
  const ceilingPct = Math.min(100, (baseline / scaleMax) * 100); // where the lab-baseline sits on the column

  return (
    <div className="relative flex w-12 shrink-0 flex-col-reverse overflow-hidden rounded-md border border-edge bg-ink/40">
      {noises.map((n, i) => {
        if (n.noise <= 0) return null;
        const loud = loudSeq.has(n.seq);
        const isFocus = focus === n.seq;
        return (
          <button
            key={n.seq}
            type="button"
            title={`${n.binary} — click for detail`}
            onClick={() => onSelect(n.seq)}
            className="fade-in w-full shrink-0 cursor-pointer"
            style={{
              height: `${(n.noise / scaleMax) * 100}%`,
              background: loud ? "var(--color-loud)" : "color-mix(in oklch, var(--color-loud) 42%, transparent)",
              borderTop: i > 0 ? "1px solid color-mix(in oklch, var(--color-ink) 45%, transparent)" : undefined,
              outline: isFocus ? "2px solid var(--color-signal)" : undefined,
              outlineOffset: "-2px",
            }}
          />
        );
      })}
      {/* the lab-baseline ceiling — cross it and stealth hits zero */}
      <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-edge-bright/70" style={{ bottom: `${ceilingPct}%` }} />
    </div>
  );
}

/** The clicked fragment's detail — shown under the run ribbon (fills the tile), and driven by any
 *  dot/bar/block selection. Mirrors the kill-chain detail card: identity, alignment, actor, technique,
 *  the command itself, and its result. */
function RunDetail({ timeline, focus, onOpen }: { timeline: Timeline; focus: number; onOpen: () => void }) {
  const it = timeline.bySeq.get(focus);
  if (!it) return null;
  const ep = it.ep;
  return (
    <div className="fade-in flex h-full flex-col rounded-lg border border-edge bg-ink/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
        <span className="mono text-faint">#{ep.seq}</span>
        <span className="mono text-sm font-semibold text-fg">{ep.binary || "pause"}</span>
        {ep.alignment && <Chip color={ALIGNMENT_COLORS[ep.alignment]}>{ep.alignment.replace(/_/g, " ")}</Chip>}
        <span className="text-faint">{ACTOR_TEXT[ep.actor] ?? ep.actor.replace(/_/g, " ")}</span>
        <span className="text-faint">{fmtDuration(ep.duration_ms + ep.gap_before_ms)}</span>
        {ep.technique && (
          <span className="text-faint">
            <span className="mono text-muted">{ep.technique}</span> {techniqueName(ep.technique)}
          </span>
        )}
        <button type="button" onClick={onOpen} title="Open How the run unfolded" className="label ml-auto flex shrink-0 items-center gap-0.5 rounded border border-edge px-1.5 py-0.5 text-faint transition-colors hover:text-fg">
          view <ArrowUpRight size={11} />
        </button>
      </div>
      <div className="mono mt-1.5 flex items-start gap-2 overflow-x-auto rounded bg-ink/60 px-2 py-1.5 text-xs">
        <span className="select-none text-match">$</span>
        <span className="whitespace-pre text-fg">{ep.cmd || "— (thinking)"}</span>
      </div>
      {ep.output_digest && (
        <div className="mt-1.5 truncate text-xs text-faint">
          <span className="text-muted">→</span> {ep.output_digest}
        </div>
      )}
    </div>
  );
}

/** The run unfolding as a time ribbon — one block per command, positioned/sized by when and how long. */
function RunRibbon({ items, totalMs, focus, onPick }: { items: TimedEpisode[]; totalMs: number; focus: number | null; onPick: (seq: number) => void }) {
  if (items.length === 0) return <p className="text-sm text-faint">No commands captured yet.</p>;
  const W = 1000;
  const H = 34;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-11 w-full">
      <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="var(--color-edge)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {items.map((it) => {
        const x = (it.t0 / Math.max(1, totalMs)) * W;
        const w = Math.max(2.5, ((it.t1 - it.t0) / Math.max(1, totalMs)) * W);
        return (
          <rect
            key={it.ep.seq}
            x={x}
            y={5}
            width={w}
            height={H - 12}
            rx={1.5}
            fill={episodeColor(it.ep)}
            opacity={focus == null || focus === it.ep.seq ? 0.9 : 0.5}
            className="fade-in cursor-pointer"
            onClick={() => onPick(it.ep.seq)}
          >
            <title>{it.ep.binary || "pause"}</title>
          </rect>
        );
      })}
    </svg>
  );
}

/** A compact "where you deviated" glance — the self-relative waste signals, live. */
function DeviationGlance({ episodes, lostPct }: { episodes: Episode[]; lostPct: number }) {
  const detours = episodes.filter((e) => e.alignment === "detour").length;
  const loops = episodes.filter((e) => e.loop_of_seq != null).length;
  const stalls = episodes.filter((e) => e.actor === "think_pause").length;
  const lostColor = lostPct >= 30 ? "var(--color-detour)" : lostPct >= 15 ? "var(--color-tool)" : "var(--color-match)";
  const Item = ({ n, label, color }: { n: number; label: string; color: string }) => (
    <div className="flex flex-col">
      <span className="mono text-lg tabular-nums leading-none" style={{ color: n > 0 ? color : "var(--color-faint)" }}>
        {n}
      </span>
      <span className="label mt-0.5 text-faint">{label}</span>
    </div>
  );
  return (
    <div className="flex h-full flex-col justify-between gap-2">
      <div>
        <span className="mono text-2xl font-semibold tabular-nums leading-none" style={{ color: lostColor }}>
          <AnimatedNumber value={lostPct} />%
        </span>
        <span className="label ml-1.5 text-faint">time lost</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Item n={detours} label="dead-ends" color="var(--color-detour)" />
        <Item n={loops} label="loops" color="var(--color-tool)" />
        <Item n={stalls} label="stalls" color="var(--color-stuck)" />
      </div>
    </div>
  );
}

/** The resolved-mode recap for the tall tile — the run's headline moments, each linking to its detail. */
function KeyMoments({ report, timeline, loudestBinary, loudestSeq, onReveal }: { report: WatcherReport; timeline: Timeline; loudestBinary: string | null; loudestSeq: number | null; onReveal: (seq: number) => void }) {
  const flags = detectFlags(report.episodes);
  const userSeq = flags.user ?? flags.system; // rooting implies user-level access
  const at = (seq: number | null) => {
    if (seq == null) return null;
    const m = Math.round((timeline.bySeq.get(seq)?.t0 ?? 0) / 60_000);
    return m < 1 ? "early" : `${m}m in`;
  };
  const longestStall = report.episodes.filter((e) => e.actor === "think_pause").reduce((m, e) => Math.max(m, e.duration_ms + e.gap_before_ms), 0);
  const golden = report.golden_dag;
  const done = golden.filter((o) => o.user_satisfied_by_seq != null).length;

  // each moment deep-links to where you'd inspect it: flags → the deviation timeline (its capture
  // pennants); loudest → the exact command in the log; stall → the deviation timeline; objectives →
  // the intended-path comparison.
  const Row = ({ icon, label, value, color, onClick, hint }: { icon: ReactNode; label: string; value: string; color: string; onClick?: () => void; hint?: string }) => (
    <li>
      <button
        type="button"
        onClick={onClick}
        disabled={!onClick}
        title={onClick ? hint : undefined}
        className={`group flex w-full items-center gap-2 rounded px-1 py-1 text-left ${onClick ? "cursor-pointer hover:bg-panel-2/50" : "cursor-default"}`}
      >
        <span className="flex w-4 shrink-0 items-center justify-center" style={{ color }}>
          {icon}
        </span>
        <span className="text-muted">{label}</span>
        <span className="mono ml-auto tabular-nums" style={{ color }}>
          {value}
        </span>
        {onClick && <ArrowUpRight size={12} className="shrink-0 text-faint opacity-0 transition-opacity group-hover:opacity-100" />}
      </button>
    </li>
  );

  return (
    <ul className="fade-in space-y-0.5 text-sm">
      <Row icon={<Flag size={13} />} label="User flag" value={userSeq != null ? at(userSeq)! : "not captured"} color={userSeq != null ? "var(--color-flag)" : "var(--color-faint)"} onClick={userSeq != null ? () => openDetail("deviated") : undefined} hint="Open Where you lost time" />
      <Row icon={<Flag size={13} />} label="Root flag" value={flags.system != null ? at(flags.system)! : "not captured"} color={flags.system != null ? "var(--color-flag)" : "var(--color-faint)"} onClick={flags.system != null ? () => openDetail("deviated") : undefined} hint="Open Where you lost time" />
      {loudestBinary && <Row icon="🔊" label="Loudest" value={loudestBinary} color="var(--color-loud)" onClick={loudestSeq != null ? () => onReveal(loudestSeq) : undefined} hint="Show the command in the log" />}
      {longestStall > 60_000 && <Row icon="⏱" label="Longest stall" value={fmtDuration(longestStall)} color="var(--color-stuck)" onClick={() => openDetail("deviated")} hint="Open Where you lost time" />}
      {golden.length > 0 && <Row icon={<ScanEye size={13} />} label="Objectives" value={`${done}/${golden.length}`} color={tierColor((done / golden.length) * 100)} onClick={() => openDetail("path")} hint="Open What you'd do differently" />}
    </ul>
  );
}

export function LiveDashboard() {
  const s = useReport();
  const { report, timeline, metrics } = s;
  const recording = isLiveRecording(report);
  const nudge = recording ? topUnmetCheck(report) : null;
  const findingsCount = report.findings?.length ?? 0;

  const focus = activeSeq(s);
  const cmds = report.episodes.filter((e) => e.binary);
  const feed = [...cmds].reverse().slice(0, 8); // newest first — the quick glance
  const loudSeq = new Set(metrics.loud_moments?.map((l) => l.seq) ?? []);
  const stealth = Math.round(metrics.stealth_score);
  const tw = metrics.time_waster;
  const lostPct = Math.round(((tw.detour_ms + tw.stuck_ms + tw.loop_ms) / Math.max(1, tw.t_active_ms)) * 100);
  const loudestSeq = metrics.loud_moments?.[0]?.seq ?? null;
  const loudestBinary = loudestSeq != null ? report.episodes.find((e) => e.seq === loudestSeq)?.binary ?? null : null;

  return (
    <div
      className="rounded-xl border p-4 transition-colors duration-700"
      style={{
        borderColor: recording ? "color-mix(in oklch, var(--color-loud) 28%, var(--color-edge))" : "var(--color-edge)",
        backgroundColor: recording ? "color-mix(in oklch, var(--color-loud) 5%, transparent)" : "color-mix(in oklch, var(--color-panel) 40%, transparent)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        {recording ? (
          <span className="label flex items-center gap-2" style={{ color: "var(--color-loud)" }}>
            <span className="animate-pulse">●</span> Live ops
            <span className="text-faint">· reference while you play</span>
          </span>
        ) : (
          <span className="label flex items-center gap-2 text-muted">
            Run summary
            <span className="text-faint">· the run at a glance · details below</span>
          </span>
        )}
        <span className="mono text-xs tabular-nums text-faint">
          {cmds.length} cmd{cmds.length === 1 ? "" : "s"} · {fmtDuration(timeline.totalMs)} · {metrics.technique_breadth} technique{metrics.technique_breadth === 1 ? "" : "s"}
        </span>
      </div>

      {/* live "next move" nudge — the single highest-value un-done applicable check, methodology-derived
          (label/hint only, never raw cmd/output); disappears once every applicable check is resolved.
          the findings count is independent of the nudge and stays visible for the whole recording. */}
      {recording && (
        <div className="fade-in mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-signal/30 bg-signal/10 px-3 py-1.5 text-xs">
          {nudge && (
            nudge.evidence_seq != null ? (
              <button
                type="button"
                onClick={() => s.reveal(nudge.evidence_seq!)}
                title="Jump to the evidence in the log"
                className="label flex items-center gap-1.5 text-signal transition-colors hover:underline"
              >
                <span aria-hidden>→</span> Next move: {nudge.label} — {nudge.hint}
              </button>
            ) : (
              <span className="label flex items-center gap-1.5 text-signal">
                <span aria-hidden>→</span> Next move: {nudge.label} — {nudge.hint}
              </span>
            )
          )}
          <span className="ml-auto text-faint">
            {findingsCount} finding{findingsCount === 1 ? "" : "s"}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {/* where am I in the attack */}
        <Tile
          label="Kill chain"
          i={0}
          className="sm:col-span-2 lg:col-span-2"
          right={
            <span className="text-xs text-faint">
              progression <span className="mono tabular-nums" style={{ color: tierColor(metrics.ukc_progression ?? 100) }}>{Math.round(metrics.ukc_progression ?? 100)}%</span>
            </span>
          }
        >
          <KillChainTrajectory progression={metrics.ukc_progression ?? 100} compact />
        </Tile>

        {/* am I getting loud */}
        <Tile
          label="Stealth burn"
          i={1}
          right={
            <span className="mono text-sm tabular-nums" style={{ color: tierColor(stealth) }}>
              <AnimatedNumber value={stealth} />
              <span className="text-xs text-faint">/100</span>
            </span>
          }
        >
          <div className="flex h-full min-h-[128px] gap-3">
            <VerticalBurn
              items={timeline.items}
              baseline={report.noise_baseline?.total ?? NOISE_BASELINE}
              loudSeq={loudSeq}
              focus={focus}
              onSelect={(seq) => s.select(s.selectedSeq === seq ? null : seq)}
            />
            <div className="flex flex-1 flex-col justify-between text-xs text-faint">
              <span className="label text-faint">louder ▲</span>
              <div>
                <p className="truncate">
                  {loudestBinary ? (
                    <>
                      Loudest: <span className="mono text-muted">{loudestBinary}</span>
                    </>
                  ) : (
                    "Quiet so far."
                  )}
                </p>
                <p className="mt-1 leading-snug">Each bar is a tool's noise, stacking toward the <span className="text-muted">lab baseline</span> (dashed).</p>
              </div>
            </div>
          </div>
        </Tile>

        {/* what my last moves mapped to (live) → the run's headline moments (resolved) */}
        <Tile
          label={recording ? "Latest commands" : "Key moments"}
          i={2}
          className="lg:row-span-2"
          right={<span className="text-xs text-faint">{recording ? "newest first" : "recap"}</span>}
        >
          {!recording ? (
            <KeyMoments report={report} timeline={timeline} loudestBinary={loudestBinary} loudestSeq={loudestSeq} onReveal={(seq) => s.reveal(seq)} />
          ) : feed.length === 0 ? (
            <p className="text-sm text-faint">No commands captured yet.</p>
          ) : (
            <ul className="space-y-0.5">
              {feed.map((e) => {
                const t = Math.round((timeline.bySeq.get(e.seq)?.t0 ?? 0) / 1000);
                const phase = ukcOf(e);
                return (
                  <li key={e.seq}>
                    <button
                      type="button"
                      onClick={() => s.reveal(e.seq)}
                      className={`feed-in flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors ${focus === e.seq ? "bg-panel-2" : "hover:bg-panel-2/50"}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: episodeColor(e) }} />
                      <span className="mono truncate text-fg">{e.binary}</span>
                      {phase && <span className="shrink-0 rounded bg-edge/60 px-1 py-0.5 text-[10px] text-muted">{SHORT_TACTIC[e.tactic] ?? ukcLabel(phase)}</span>}
                      {loudSeq.has(e.seq) && (
                        <span className="shrink-0 text-[10px]" style={{ color: "var(--color-loud)" }} title="one of your loudest moments">
                          🔊
                        </span>
                      )}
                      <span className="mono ml-auto shrink-0 text-xs tabular-nums text-faint">{fmtDuration(t * 1000)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Tile>

        {/* the run unfolding on a time axis — click a block to inspect it below (fills the tile);
            a kill-chain dot or stealth bar lands its detail here too */}
        <Tile label="Run unfolding" i={3} className="sm:col-span-2 lg:col-span-2">
          <div className="flex h-full flex-col">
            <RunRibbon items={timeline.items} totalMs={timeline.totalMs} focus={focus} onPick={(seq) => s.select(s.selectedSeq === seq ? null : seq)} />
            <div className="mt-2 flex-1">
              {/* default to the first command so the card is exposed on open; hover/click swaps it */}
              {(focus ?? cmds[0]?.seq) != null ? (
                <RunDetail timeline={timeline} focus={(focus ?? cmds[0]!.seq) as number} onOpen={() => openDetail("unfolded")} />
              ) : (
                <p className="text-xs text-faint">No commands captured yet.</p>
              )}
            </div>
          </div>
        </Tile>

        {/* where you deviated — opens the full deviation timeline */}
        <Tile label="Where you deviated" i={4}>
          <button type="button" onClick={() => openDetail("deviated")} title="Open Where you lost time" className="h-full w-full cursor-pointer text-left">
            <DeviationGlance episodes={report.episodes} lostPct={lostPct} />
          </button>
        </Tile>
      </div>
    </div>
  );
}
