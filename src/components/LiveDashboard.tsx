import type { CSSProperties, ReactNode } from "react";
import { useReport, activeSeq } from "../store/report";
import { isLiveRecording } from "../lib/live";
import { fmtDuration } from "../lib/format";
import { tierColor } from "./ui";
import { episodeNoise, NOISE_BASELINE } from "../lib/metrics";
import { episodeColor } from "../lib/scale";
import { SHORT_TACTIC } from "../lib/audits";
import { ukcOf, ukcLabel } from "../lib/pipeline/frameworks";
import { detectFlags } from "../lib/flags";
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
function VerticalBurn({ items, baseline, loudSeq }: { items: TimedEpisode[]; baseline: number; loudSeq: Set<number> }) {
  const noises = items.map((it) => ({ seq: it.ep.seq, noise: episodeNoise(it.ep) }));
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
        return (
          <div
            key={n.seq}
            className="fade-in w-full shrink-0"
            style={{
              height: `${(n.noise / scaleMax) * 100}%`,
              background: loud ? "var(--color-loud)" : "color-mix(in oklch, var(--color-loud) 42%, transparent)",
              borderTop: i > 0 ? "1px solid color-mix(in oklch, var(--color-ink) 45%, transparent)" : undefined,
            }}
          />
        );
      })}
      {/* the lab-baseline ceiling — cross it and stealth hits zero */}
      <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-edge-bright/70" style={{ bottom: `${ceilingPct}%` }} />
    </div>
  );
}

/** The run unfolding as a time ribbon — one block per command, positioned/sized by when and how long. */
function RunRibbon({ items, totalMs, focus, onPick }: { items: TimedEpisode[]; totalMs: number; focus: number | null; onPick: (seq: number) => void }) {
  if (items.length === 0) return <p className="text-sm text-faint">No commands captured yet.</p>;
  const W = 1000;
  const H = 34;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-9 w-full">
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
      <p className="mt-1 text-xs text-faint">each block = a command · width = time on it · click to inspect</p>
    </div>
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

/** The resolved-mode recap for the tall tile — the run's headline moments, once it's over. */
function KeyMoments({ report, timeline, loudestBinary }: { report: WatcherReport; timeline: Timeline; loudestBinary: string | null }) {
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

  const Row = ({ icon, label, value, color }: { icon: string; label: string; value: string; color: string }) => (
    <li className="flex items-center gap-2">
      <span className="w-4 shrink-0 text-center" style={{ color }}>
        {icon}
      </span>
      <span className="text-muted">{label}</span>
      <span className="mono ml-auto tabular-nums" style={{ color }}>
        {value}
      </span>
    </li>
  );

  return (
    <ul className="fade-in space-y-1.5 text-sm">
      <Row icon="⚑" label="User flag" value={userSeq != null ? at(userSeq)! : "not captured"} color={userSeq != null ? "var(--color-flag)" : "var(--color-faint)"} />
      <Row icon="⚑" label="Root flag" value={flags.system != null ? at(flags.system)! : "not captured"} color={flags.system != null ? "var(--color-flag)" : "var(--color-faint)"} />
      {loudestBinary && <Row icon="🔊" label="Loudest" value={loudestBinary} color="var(--color-loud)" />}
      {longestStall > 60_000 && <Row icon="⏱" label="Longest stall" value={fmtDuration(longestStall)} color="var(--color-stuck)" />}
      {golden.length > 0 && <Row icon="◎" label="Objectives" value={`${done}/${golden.length}`} color={tierColor((done / golden.length) * 100)} />}
    </ul>
  );
}

export function LiveDashboard() {
  const s = useReport();
  const { report, timeline, metrics } = s;
  const recording = isLiveRecording(report);

  const focus = activeSeq(s);
  const cmds = report.episodes.filter((e) => e.binary);
  const feed = [...cmds].reverse().slice(0, 8); // newest first — the quick glance
  const loudSeq = new Set(metrics.loud_moments?.map((l) => l.seq) ?? []);
  const stealth = Math.round(metrics.stealth_score);
  const tw = metrics.time_waster;
  const lostPct = Math.round(((tw.detour_ms + tw.stuck_ms + tw.loop_ms) / Math.max(1, tw.t_active_ms)) * 100);
  const loudestBinary = loudSeq.size ? report.episodes.find((e) => e.seq === metrics.loud_moments![0].seq)?.binary ?? null : null;

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
            <VerticalBurn items={timeline.items} baseline={report.noise_baseline?.total ?? NOISE_BASELINE} loudSeq={loudSeq} />
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
            <KeyMoments report={report} timeline={timeline} loudestBinary={loudestBinary} />
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

        {/* the run unfolding on a time axis */}
        <Tile label="Run unfolding" i={3} className="sm:col-span-2 lg:col-span-2">
          <RunRibbon items={timeline.items} totalMs={timeline.totalMs} focus={focus} onPick={(seq) => s.reveal(seq)} />
        </Tile>

        {/* where you deviated */}
        <Tile label="Where you deviated" i={4}>
          <DeviationGlance episodes={report.episodes} lostPct={lostPct} />
        </Tile>
      </div>
    </div>
  );
}
