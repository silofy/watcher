import { fmtClock } from "../lib/format";

/** The drag-to-zoom status row + zoom-out / reset buttons, shared by the time-axis charts. */
export function ZoomControls({
  zoomed,
  w0,
  w1,
  zoomOut,
  reset,
  hint = "Drag across the timeline to zoom into a window",
}: {
  zoomed: boolean;
  w0: number;
  w1: number;
  zoomOut: () => void;
  reset: () => void;
  hint?: string;
}) {
  return (
    <div className="mb-1.5 flex items-center justify-between text-xs">
      <span className="text-faint">
        {zoomed ? (
          <>
            Window{" "}
            <span className="mono text-muted">
              {fmtClock(w0)}–{fmtClock(w1)}
            </span>{" "}
            · drag to refine · zoom is shared with the deviation chart
          </>
        ) : (
          hint
        )}
      </span>
      {zoomed && (
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={zoomOut} className="rounded border border-edge px-1.5 py-0.5 text-muted transition-colors hover:bg-panel-2/60">
            − Zoom out
          </button>
          <button type="button" onClick={reset} className="rounded border border-edge px-1.5 py-0.5 text-muted transition-colors hover:bg-panel-2/60">
            Reset
          </button>
        </span>
      )}
    </div>
  );
}
