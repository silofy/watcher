import { useReport, activeSeq } from "../store/report";
import { isLiveRecording } from "../lib/live";
import { fmtDuration } from "../lib/format";
import { tierColor } from "./ui";
import { episodeNoise } from "../lib/metrics";
import { episodeColor } from "../lib/scale";
import { SHORT_TACTIC } from "../lib/audits";
import { reachedUkcPhases, UKC_ORDER, ukcRank, ukcOf, ukcLabel, type UkcPhase } from "../lib/pipeline/frameworks";
import type { Episode } from "../types/report";

/**
 * Live Ops — the mid-run companion. While a session is recording, the debrief's verdict views (grade,
 * writeup comparison, phase audit) are premature; this panel instead surfaces the three things a player
 * actually references while playing, all derivable from telemetry alone (no write-up needed):
 *
 *   1. Kill-chain progress — how far up the chain am I, and is my progression clean?
 *   2. Stealth burn       — am I getting loud right now?
 *   3. Command feed        — what did my last few moves actually map to?
 *
 * Everything here streams: it grows organically as commands land, so the report is a live instrument,
 * not a post-mortem. It renders nothing once the run ends — the resolved debrief takes over.
 */

/** The kill-chain breadcrumb: the UKC phases reached so far, in attack order, + the next expected one. */
function KillChainRail({ episodes, progression }: { episodes: Episode[]; progression: number }) {
  const reached = reachedUkcPhases(episodes);
  const ordered = [...reached].sort((a, b) => ukcRank(a) - ukcRank(b));
  const furthest = ordered.length ? ukcRank(ordered[ordered.length - 1]) : -1;
  const next = UKC_ORDER.find((p) => ukcRank(p) > furthest);
  const current = ordered[ordered.length - 1];

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <span className="label text-faint">Kill chain</span>
        <span className="text-xs text-faint">
          progression{" "}
          <span className="mono tabular-nums" style={{ color: tierColor(progression) }}>
            {Math.round(progression)}%
          </span>
        </span>
      </div>
      {ordered.length === 0 ? (
        <p className="text-sm text-faint">Waiting for the first classified command…</p>
      ) : (
        <div className="flex flex-wrap items-center gap-x-1 gap-y-1.5">
          {ordered.map((p, i) => {
            const isCurrent = p === current;
            const color = isCurrent ? "var(--color-loud)" : "var(--color-match)";
            return (
              <span key={p} className="flex items-center gap-1">
                {i > 0 && <span className="text-faint">›</span>}
                <span
                  className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium"
                  style={{ color, backgroundColor: `color-mix(in oklch, ${color} 15%, transparent)` }}
                >
                  {isCurrent && <span className="animate-pulse">●</span>}
                  {ukcLabel(p as UkcPhase)}
                </span>
              </span>
            );
          })}
          {next && (
            <span className="flex items-center gap-1">
              <span className="text-faint">›</span>
              <span className="rounded border border-dashed border-edge px-1.5 py-0.5 text-xs text-faint">{ukcLabel(next)}</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** A cumulative-noise sparkline — the run's stealth burn, monotonic and streaming-friendly. */
function NoiseSparkline({ episodes, totalMs }: { episodes: { ep: Episode; t0: number }[]; totalMs: number }) {
  let cum = 0;
  const pts = episodes.map((it) => {
    cum += episodeNoise(it.ep);
    return { x: it.t0 / Math.max(1, totalMs), y: cum };
  });
  const maxY = Math.max(1, cum);
  if (pts.length < 2) return <div className="h-8" />;
  const W = 100;
  const H = 32;
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x * W).toFixed(1)} ${(H - (p.y / maxY) * H).toFixed(1)}`).join(" ");
  const area = `${line} L ${W} ${H} L 0 ${H} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="h-8 w-full">
      <path d={area} fill="var(--color-loud)" fillOpacity={0.12} />
      <path d={line} fill="none" stroke="var(--color-loud)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function LiveDashboard() {
  const s = useReport();
  const { report, timeline, metrics } = s;
  if (!isLiveRecording(report)) return null;

  const focus = activeSeq(s);
  const cmds = report.episodes.filter((e) => e.binary);
  const feed = [...cmds].reverse().slice(0, 7); // newest first — the quick glance
  const loudSeq = new Set(metrics.loud_moments?.map((l) => l.seq) ?? []);
  const stealth = Math.round(metrics.stealth_score);

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

      {/* where am I in the attack */}
      <KillChainRail episodes={report.episodes} progression={metrics.ukc_progression ?? 100} />

      <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
        {/* am I getting loud */}
        <div className="rounded-lg border border-edge bg-ink/30 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label text-faint">Stealth burn</span>
            <span className="mono text-sm tabular-nums" style={{ color: tierColor(stealth) }}>
              {stealth}
              <span className="text-xs text-faint">/100</span>
            </span>
          </div>
          <NoiseSparkline episodes={timeline.items} totalMs={timeline.totalMs} />
          <p className="mt-1.5 text-xs text-faint">
            {loudSeq.size === 0
              ? "Quiet so far — no standout noise."
              : (() => {
                  const top = metrics.loud_moments![0];
                  const b = report.episodes.find((e) => e.seq === top.seq)?.binary ?? "a command";
                  return (
                    <>
                      Loudest: <span className="mono text-muted">{b}</span> — pushing your footprint up.
                    </>
                  );
                })()}
          </p>
        </div>

        {/* what did my last moves map to */}
        <div className="rounded-lg border border-edge bg-ink/30 p-3">
          <div className="mb-2 flex items-baseline justify-between">
            <span className="label text-faint">Latest commands</span>
            <span className="text-xs text-faint">newest first · click to inspect</span>
          </div>
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
                      className={`flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-sm transition-colors ${focus === e.seq ? "bg-panel-2" : "hover:bg-panel-2/50"}`}
                    >
                      <span className="h-2 w-2 shrink-0 rounded-[2px]" style={{ backgroundColor: episodeColor(e) }} />
                      <span className="mono truncate text-fg">{e.binary}</span>
                      {phase && (
                        <span className="shrink-0 rounded bg-edge/60 px-1 py-0.5 text-[10px] text-muted">{SHORT_TACTIC[e.tactic] ?? ukcLabel(phase)}</span>
                      )}
                      {loudSeq.has(e.seq) && (
                        <span className="shrink-0 text-[10px]" style={{ color: "var(--color-loud)" }} title="one of your loudest moments">
                          🔊
                        </span>
                      )}
                      <span className="mono ml-auto shrink-0 text-xs text-faint tabular-nums">{fmtDuration(t * 1000)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
