import { useEffect, useMemo, useRef, useState } from "react";
import { useReport } from "../store/report";
import { seqBounds } from "../lib/trim";
import { buildTimeline, episodeColor, AXIS_W } from "../lib/scale";
import { fmtDuration, fmtClock } from "../lib/format";

/**
 * Retroactive session trim — a session is a selection over the always-rolling stream. Drag the two
 * handles across a mini timeline of the WHOLE session (episodes colored by deviation) to scope the
 * report; everything re-derives for that window. Visual + draggable so you can see what you're cutting.
 */
export function TrimControl() {
  const { fullReport, trimSeq, setTrim, clearTrim, timeline } = useReport();
  const full = useMemo(() => buildTimeline(fullReport.episodes), [fullReport]);
  const [minSeq, maxSeq] = seqBounds(fullReport);
  const [a, b] = trimSeq ?? [minSeq, maxSeq];
  const trimmed = trimSeq != null;
  const trackRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<null | "a" | "b">(null);

  const total = full.totalMs || 1;
  const startFrac = (full.bySeq.get(a)?.gapStart ?? 0) / total;
  const endFrac = (full.bySeq.get(b)?.t1 ?? total) / total;

  const seqAtClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || full.items.length === 0) return minSeq;
    const tMs = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)) * total;
    let best = full.items[0];
    let bestD = Infinity;
    for (const it of full.items) {
      const d = Math.abs((it.t0 + it.t1) / 2 - tMs);
      if (d < bestD) {
        bestD = d;
        best = it;
      }
    }
    return best.ep.seq;
  };

  useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => {
      const seq = seqAtClientX(e.clientX);
      if (drag === "a") setTrim([Math.min(seq, b), b]);
      else setTrim([a, Math.max(seq, a)]);
    };
    const onUp = () => setDrag(null);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag, a, b]);

  // click on the track moves whichever handle is nearer
  const onTrackDown = (e: React.PointerEvent) => {
    const seq = seqAtClientX(e.clientX);
    const f = (e.clientX - (trackRef.current?.getBoundingClientRect().left ?? 0)) / (trackRef.current?.clientWidth ?? 1);
    if (Math.abs(f - startFrac) <= Math.abs(f - endFrac)) {
      setTrim([Math.min(seq, b), b]);
      setDrag("a");
    } else {
      setTrim([a, Math.max(seq, a)]);
      setDrag("b");
    }
  };

  const windowStartMs = full.bySeq.get(a)?.gapStart ?? 0;
  const windowEndMs = full.bySeq.get(b)?.t1 ?? total;

  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-faint">drag the handles to scope the report</span>
        <button
          type="button"
          onClick={clearTrim}
          disabled={!trimmed}
          className="label rounded border border-edge px-2 py-1 text-xs text-faint transition-colors enabled:hover:bg-panel-2 enabled:hover:text-fg disabled:opacity-40"
        >
          {trimmed ? "Reset to full" : "Full session"}
        </button>
      </div>

      {/* the mini session timeline + dual handles */}
      <div ref={trackRef} className="relative mt-2.5 h-9 cursor-pointer select-none" onPointerDown={onTrackDown}>
        <svg viewBox={`0 0 ${AXIS_W} 36`} preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <line x1={0} y1={32} x2={AXIS_W} y2={32} stroke="var(--color-edge)" />
          {full.items.map((it) => {
            const x = (it.t0 / total) * AXIS_W;
            const w = Math.max(1.5, ((it.t1 - it.t0) / total) * AXIS_W);
            const inWin = it.ep.seq >= a && it.ep.seq <= b;
            return <rect key={it.ep.seq} x={x} y={10} width={w} height={20} rx={1} fill={episodeColor(it.ep)} opacity={inWin ? 0.95 : 0.22} />;
          })}
        </svg>

        {/* dimmed out-of-window regions */}
        <div className="pointer-events-none absolute inset-y-0 left-0 rounded-l bg-ink/65" style={{ width: `${startFrac * 100}%` }} />
        <div className="pointer-events-none absolute inset-y-0 right-0 rounded-r bg-ink/65" style={{ width: `${(1 - endFrac) * 100}%` }} />
        {/* selected band outline */}
        <div className="pointer-events-none absolute inset-y-0 border-x border-signal/70" style={{ left: `${startFrac * 100}%`, right: `${(1 - endFrac) * 100}%` }} />

        {/* handles */}
        {(
          [
            { key: "a" as const, frac: startFrac, label: `#${a}` },
            { key: "b" as const, frac: endFrac, label: `#${b}` },
          ]
        ).map((hndl) => (
          <div
            key={hndl.key}
            role="slider"
            aria-label={hndl.key === "a" ? "Window start" : "Window end"}
            aria-valuenow={hndl.key === "a" ? a : b}
            className="group absolute top-0 z-10 h-full -translate-x-1/2 cursor-ew-resize"
            style={{ left: `${hndl.frac * 100}%` }}
            onPointerDown={(e) => {
              e.stopPropagation();
              setDrag(hndl.key);
            }}
          >
            <div className={`h-full w-[3px] rounded-full ${drag === hndl.key ? "bg-signal" : "bg-signal/80 group-hover:bg-signal"}`} />
            <span className="mono absolute -top-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-xs text-signal">{hndl.label}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 flex items-center justify-between text-xs">
        <span className="mono text-muted">
          #{a}–#{b} · {timeline.items.length} of {full.items.length} steps
        </span>
        <span className="mono text-faint">
          {fmtClock(windowStartMs)}–{fmtClock(windowEndMs)} · {fmtDuration(timeline.totalMs)}
        </span>
      </div>
    </div>
  );
}
