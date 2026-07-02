import { useEffect, useRef } from "react";
import { useReport, episodeAtPlayhead, activeSeq } from "../store/report";
import { Section, LedgerRow, LedgerHead, Num } from "./ui";
import { episodeColor } from "../lib/scale";
import { fmtClock, fmtDuration } from "../lib/format";

const COLS = "0.7rem 2.4rem minmax(0,1fr) 3.4rem 3rem";

export function CommandReplay() {
  const s = useReport();
  const { report, timeline, playheadMs, playing, revealSeq, revealNonce } = s;

  // loadout — the tools you reached for, by count, loudest flagged. A compact "what was in your kit".
  const loudestTool = (() => {
    const seq = report.metrics.loud_moments?.[0]?.seq;
    return seq != null ? report.episodes.find((e) => e.seq === seq)?.binary : undefined;
  })();
  const loadout = (() => {
    const m = new Map<string, number>();
    for (const it of timeline.items) {
      const b = it.ep.binary;
      if (b) m.set(b, (m.get(b) ?? 0) + 1);
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const curSeq = episodeAtPlayhead(s);
  const focus = activeSeq(s);
  const scrollRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const lastTs = useRef<number | null>(null);

  // A deep-link (coaching card / technique) asks to reveal a command: bring this panel into view,
  // then center the exact row inside it. Keyed on the nonce so repeat reveals re-fire.
  useEffect(() => {
    if (revealSeq == null) return;
    const log = document.getElementById("log");
    // the Command Log is a collapsed accordion — open it first, or we'd just scroll to a closed
    // header and the row we want to center stays hidden (the deep-link would look like it did nothing).
    const details = log?.querySelector("details");
    if (details && !details.open) details.open = true;
    log?.scrollIntoView({ behavior: "smooth", block: "start" });
    const t = setTimeout(() => {
      const c = scrollRef.current;
      const row = c?.querySelector(`[data-seq="${revealSeq}"]`) as HTMLElement | null;
      if (c && row) {
        const cr = c.getBoundingClientRect();
        const er = row.getBoundingClientRect();
        c.scrollTop += er.top - cr.top - c.clientHeight / 2 + er.height / 2; // scroll only this panel
      }
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealNonce]);

  // DVR playback: cover the whole session in ~22s of real time.
  useEffect(() => {
    if (!playing) {
      lastTs.current = null;
      return;
    }
    const rate = timeline.totalMs / 22000;
    const tick = (ts: number) => {
      if (lastTs.current != null) {
        // Read the live playhead from the store, not the `s` snapshot captured when the effect ran —
        // that value is frozen for the life of this closure, so accumulating off it stalled the DVR a
        // fraction of a second in and it never reached totalMs to auto-stop.
        const next = useReport.getState().playheadMs + (ts - lastTs.current) * rate;
        if (next >= timeline.totalMs) {
          s.scrub(timeline.totalMs);
          s.setPlaying(false);
          return;
        }
        s.scrub(next);
      }
      lastTs.current = ts;
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  // During DVR playback, keep the current command in view — but scroll only THIS panel, never the
  // page (scrollIntoView would scroll the window). Inert while you're just hovering/reading.
  useEffect(() => {
    if (!playing) return;
    const c = scrollRef.current;
    const el = c?.querySelector('[data-cur="1"]') as HTMLElement | null;
    if (c && el) {
      const cr = c.getBoundingClientRect();
      const er = el.getBoundingClientRect();
      c.scrollTop += er.top - cr.top - c.clientHeight / 2 + er.height / 2;
    }
  }, [curSeq, playing]);

  return (
    <Section
      collapsible
      name="debrief-details"
      title="Command Log"
      subtitle="DVR · synced to the timeline"
      right={
        <span className="mono tabular-nums">
          {fmtClock(playheadMs)} / {fmtClock(timeline.totalMs)}
        </span>
      }
    >
      {/* loadout — the tools used, by count; the loudest on the wire flagged */}
      {loadout.length > 0 && (
        <div className="mb-2.5 flex flex-wrap items-center gap-1.5">
          <span className="label mr-1 text-faint">Loadout</span>
          {loadout.map(([name, count]) => {
            const loud = name === loudestTool;
            return (
              <span
                key={name}
                className={`mono rounded px-1.5 py-0.5 text-xs ${loud ? "" : "bg-panel-2 text-muted"}`}
                style={loud ? { color: "var(--color-loud)", background: "color-mix(in oklch, var(--color-loud) 14%, transparent)" } : undefined}
                title={loud ? `${name} — loudest tool on the wire` : `${name} — ${count}×`}
              >
                {name} ×{count}
              </span>
            );
          })}
        </div>
      )}

      {/* DVR toolbar */}
      <div className="mb-2 flex items-center gap-3">
        <button
          type="button"
          onClick={() => s.setPlaying(!playing)}
          className="flex h-7 w-7 items-center justify-center rounded border border-edge bg-panel-2 text-xs text-fg transition-colors hover:bg-edge"
          aria-label={playing ? "Pause" : "Play"}
        >
          {playing ? "❚❚" : "▶"}
        </button>
        <input
          type="range"
          min={0}
          max={timeline.totalMs}
          value={Math.round(playheadMs)}
          onChange={(e) => {
            s.setPlaying(false);
            s.scrub(Number(e.target.value));
          }}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-edge accent-[var(--color-tool)]"
          aria-label="Scrub timeline"
        />
        <span className="mono text-xs text-faint">{timeline.items.filter((it) => it.gapStart <= playheadMs).length}/{timeline.items.length}</span>
      </div>

      <LedgerHead cols={COLS}>
        <span />
        <span>#</span>
        <span>command</span>
        <span className="text-right">at</span>
        <span className="text-right">dur</span>
      </LedgerHead>
      <div ref={scrollRef} className="max-h-52 divide-y divide-edge/50 overflow-y-auto">
        {timeline.items.map((it) => {
          const ep = it.ep;
          const isCur = ep.seq === curSeq;
          const future = it.gapStart > playheadMs;
          const think = ep.actor === "think_pause";
          return (
            <div
              key={ep.seq}
              data-cur={isCur ? "1" : "0"}
              data-seq={ep.seq}
              className={`${future ? "opacity-40" : ""} ${focus === ep.seq ? "rounded-sm ring-1 ring-signal/60" : ""}`}
            >
              <LedgerRow cols={COLS} active={isCur || focus === ep.seq} onMouseEnter={() => s.hover(ep.seq)} onMouseLeave={() => s.hover(null)} onClick={() => s.select(s.selectedSeq === ep.seq ? null : ep.seq)}>
                <span className="h-1.5 w-1.5 rounded-full justify-self-center" style={{ background: think ? "var(--color-faint)" : episodeColor(ep) }} />
                <Num className="text-xs text-faint">{ep.seq}</Num>
                <span className="mono truncate text-xs">
                  {think ? <span className="text-faint"># {ep.output_digest}</span> : <span className={isCur ? "text-fg" : "text-muted"}>{ep.cmd}</span>}
                  {isCur && !think && <span className="caret text-tool">▋</span>}
                </span>
                <Num className="justify-self-end text-xs text-faint">{fmtClock(it.t0)}</Num>
                <Num className="justify-self-end text-xs" color={ep.exit_code != null && ep.exit_code !== 0 ? "var(--color-detour)" : undefined}>
                  {think ? "—" : fmtDuration(ep.duration_ms)}
                </Num>
              </LedgerRow>
            </div>
          );
        })}
        {timeline.items.length === 0 && <p className="px-1.5 py-3 text-xs text-faint">No commands captured yet.</p>}
      </div>
    </Section>
  );
}
