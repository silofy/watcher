/** Small deterministic formatters shared across the report. */

/** Human-readable duration, e.g. 1380000 → "23m 0s", 312000 → "5m 12s", 600 → "0.6s". */
export function fmtDuration(ms: number): string {
  if (ms < 1000) return `${(ms / 1000).toFixed(1)}s`;
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

/** Compact minutes, e.g. 1380000 → "23 min". */
export function fmtMinutes(ms: number): string {
  return `${Math.round(ms / 60000)} min`;
}

/** Clock position on the shared axis from session start, e.g. "12:34". */
export function fmtClock(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export const pct = (n: number): string => `${Math.round(n)}%`;
