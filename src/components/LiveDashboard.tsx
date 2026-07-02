import type { CSSProperties, ReactNode } from "react";
import { useReport, activeSeq } from "../store/report";
import { isLiveRecording } from "../lib/live";
import { fmtDuration } from "../lib/format";
import { tierColor } from "./ui";
import { episodeNoise } from "../lib/metrics";
import { episodeColor } from "../lib/scale";
import { SHORT_TACTIC } from "../lib/audits";
import { ukcOf, ukcLabel } from "../lib/pipeline/frameworks";
import { KillChainTrajectory } from "./KillChainTrajectory";
import { AnimatedNumber } from "./AnimatedNumber";
import type { Episode } from "../types/report";
import type { TimedEpisode } from "../lib/scale";

/**
 * Live Ops — the mid-run companion, laid out as a bento of small, glanceable instruments. While a
 * session is recording the verdict views (grade, writeup comparison, phase audit) are premature; this
 * shows what a player references WHILE playing, all from telemetry alone (no write-up needed):
 *
 *   Kill chain      — how far up the chain am I, is my progression clean?
 *   Stealth burn    — am I getting loud right now?
 *   Run unfolding   — the session as a live time ribbon, each block a command
 *   Where you deviated — dead-ends, loops, stalls, time lost, live
 *   Latest commands — what my last few moves mapped to (the tall tile)
 *
 * Every tile streams — it grows as commands land, so the report is a live instrument, not a
 * post-mortem. Renders nothing once the run ends; the resolved debrief takes over.
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

/** A cumulative-noise sparkline — the run's stealth burn, monotonic and streaming-friendly. */
function NoiseSparkline({ items, totalMs }: { items: TimedEpisode[]; totalMs: number }) {
  let cum = 0;
  const pts = items.map((it) => {
    cum += episodeNoise(it.ep);
    return { x: it.t0 / Math.max(1, totalMs), y: cum };
  });
  const maxY = Math.max(1, cum);
  if (pts.length < 2) return <div className="h-10" />;
  const W = 100;
  const H = 40;
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x * W).toFixed(1)} ${(H - (p.y / maxY) * H).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-10 w-full">
      <path d={`${line} L ${W} ${H} L 0 ${H} Z`} fill="var(--color-loud)" fillOpacity={0.12} />
      <path d={line} fill="none" stroke="var(--color-loud)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
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

export function LiveDashboard() {
  const s = useReport();
  const { report, timeline, metrics } = s;
  if (!isLiveRecording(report)) return null;

  const focus = activeSeq(s);
  const cmds = report.episodes.filter((e) => e.binary);
  const feed = [...cmds].reverse().slice(0, 8); // newest first — the quick glance
  const loudSeq = new Set(metrics.loud_moments?.map((l) => l.seq) ?? []);
  const stealth = Math.round(metrics.stealth_score);
  const tw = metrics.time_waster;
  const lostPct = Math.round(((tw.detour_ms + tw.stuck_ms + tw.loop_ms) / Math.max(1, tw.t_active_ms)) * 100);
  const loudestBinary = loudSeq.size ? report.episodes.find((e) => e.seq === metrics.loud_moments![0].seq)?.binary : null;

  return (
    <div
      className="rounded-xl border p-4"
      style={{
        borderColor: "color-mix(in oklch, var(--color-loud) 28%, var(--color-edge))",
        backgroundColor: "color-mix(in oklch, var(--color-loud) 5%, transparent)",
      }}
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="label flex items-center gap-2" style={{ color: "var(--color-loud)" }}>
          <span className="animate-pulse">●</span> Live ops
          <span className="text-faint">· reference while you play</span>
        </span>
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
          <NoiseSparkline items={timeline.items} totalMs={timeline.totalMs} />
          <p className="mt-1 truncate text-xs text-faint">
            {loudestBinary ? (
              <>
                Loudest: <span className="mono text-muted">{loudestBinary}</span>
              </>
            ) : (
              "Quiet so far."
            )}
          </p>
        </Tile>

        {/* what my last moves mapped to — the tall tile on the right */}
        <Tile label="Latest commands" i={2} className="lg:row-span-2" right={<span className="text-xs text-faint">newest first</span>}>
          {feed.length === 0 ? (
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
