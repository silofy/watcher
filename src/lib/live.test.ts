import { describe, it, expect } from "vitest";
import { isLiveRecording, RECORDING_STALE_MS } from "./live";

const at = (iso: string) => ({ recording: true, session: { started_at: iso, ended_at: iso } });
const NOW = Date.parse("2026-06-20T12:00:00Z");

describe("isLiveRecording", () => {
  it("is false when the flag is off", () => {
    expect(isLiveRecording({ recording: false, session: { started_at: "", ended_at: "" } }, NOW)).toBe(false);
  });

  it("is live when the heartbeat is recent", () => {
    const fresh = new Date(NOW - 30_000).toISOString();
    expect(isLiveRecording(at(fresh), NOW)).toBe(true);
  });

  it("is archived when the heartbeat is stale (dead agent)", () => {
    const stale = new Date(NOW - RECORDING_STALE_MS - 1000).toISOString();
    expect(isLiveRecording(at(stale), NOW)).toBe(false);
  });

  it("trusts the flag when there is no usable timestamp", () => {
    expect(isLiveRecording({ recording: true, session: { started_at: "", ended_at: "" } }, NOW)).toBe(true);
  });
});
