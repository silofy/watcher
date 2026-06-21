/**
 * Liveness guard. `recording: true` lives in the session JSON, but a capture agent that was
 * hard-killed (Ctrl-C, closed terminal, crash) never gets to flip it to false — so the flag alone
 * would show a dead capture as a permanent, false "● Recording".
 *
 * The capture agent stamps `session.ended_at` as a heartbeat (~every 10s) while attached, so a recent
 * `ended_at` means the capture is genuinely alive. If the heartbeat is stale, we treat the session as
 * archived regardless of the flag.
 */
/** No heartbeat for this long ⇒ the capture is considered dead, not live. */
export const RECORDING_STALE_MS = 2 * 60 * 1000;

/** Minimal shape needed to judge liveness — any WatcherReport satisfies it structurally. */
interface Liveish {
  recording?: boolean;
  session: { started_at: string; ended_at: string };
}

export function isLiveRecording(r: Liveish, nowMs: number = Date.now()): boolean {
  if (!r.recording) return false;
  const beat = Date.parse(r.session.ended_at) || Date.parse(r.session.started_at) || 0;
  if (!beat) return true; // no timestamp to judge by — trust the flag
  return nowMs - beat < RECORDING_STALE_MS;
}
