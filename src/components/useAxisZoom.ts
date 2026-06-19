import { useRef, useState, type MouseEvent } from "react";
import { useReport } from "../store/report";
import { AXIS_W } from "../lib/scale";

const MIN_WIN = 8000; // floor on the zoom window (ms) so you can't zoom into nothing

/**
 * Shared drag-to-zoom for the time-axis charts. The window lives in the store, so the deviation
 * timeline and the MITRE swimlane zoom together to the same span. Returns the ms↔view remap helpers
 * (zx / leftPct / zinvert), the live brush selection, and mouse handlers to spread on the chart body.
 * `onHover` is an optional callback for a chart that also tracks a crosshair under the cursor.
 */
export function useAxisZoom(totalMs: number, onHover?: (ms: number | null) => void) {
  const zoomWin = useReport((s) => s.zoomWin);
  const setZoom = useReport((s) => s.setZoom);
  const [sel, setSel] = useState<[number, number] | null>(null); // live brush, as 0..1 fractions
  const brush = useRef<{ start: number; end: number } | null>(null);

  const w0 = zoomWin ? zoomWin[0] : 0;
  const w1 = zoomWin ? zoomWin[1] : totalMs || 1;
  const span = Math.max(1, w1 - w0);
  const zx = (ms: number) => ((ms - w0) / span) * AXIS_W;
  const leftPct = (ms: number) => ((ms - w0) / span) * 100;
  const zinvert = (frac: number) => w0 + Math.max(0, Math.min(1, frac)) * span;
  const zoomed = zoomWin != null;

  const zoomOut = () => {
    if (!zoomWin) return;
    const c = (w0 + w1) / 2;
    const half = w1 - w0; // double the window
    const na = Math.max(0, c - half);
    const nb = Math.min(totalMs, c + half);
    setZoom(nb - na >= totalMs - 1 ? null : [na, nb]);
  };
  const reset = () => setZoom(null);

  const fracOf = (e: MouseEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return (e.clientX - r.left) / r.width;
  };

  const handlers = {
    onMouseDown: (e: MouseEvent) => {
      const f = fracOf(e);
      brush.current = { start: f, end: f };
      setSel([f, f]);
    },
    onMouseMove: (e: MouseEvent) => {
      const f = fracOf(e);
      if (brush.current) {
        brush.current.end = f;
        setSel([brush.current.start, f]);
        onHover?.(null);
      } else {
        onHover?.(zinvert(f));
      }
    },
    onMouseUp: () => {
      const b = brush.current;
      if (b) {
        const lo = Math.min(b.start, b.end);
        const hi = Math.max(b.start, b.end);
        // a real drag (not a click) and a window wider than the floor → zoom in
        if (hi - lo > 0.015 && zinvert(hi) - zinvert(lo) >= MIN_WIN) setZoom([zinvert(lo), zinvert(hi)]);
      }
      brush.current = null;
      setSel(null);
    },
    onMouseLeave: () => {
      brush.current = null;
      setSel(null);
      onHover?.(null);
    },
  };

  return { w0, w1, span, zx, leftPct, zinvert, zoomed, zoomOut, reset, sel, handlers };
}
