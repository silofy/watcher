/**
 * Format detection + one-call ingest for the in-app "Import session" flow.
 *
 * Given the raw text of a dropped file, work out which capture format it is
 * (HTTP proxy HAR, Sysmon/EDR export, or a Claude Code transcript), run the
 * matching adapter to RawCommand[], and assemble a full WatcherReport the app can
 * open. Detection is by trying each adapter in a non-overlapping order and taking
 * the first that yields commands — a HAR is strict JSON with log.entries, a Sysmon
 * export has Event ID 1 records, a transcript is JSONL of tool-call messages, so
 * none matches another's input. Everything here is browser-safe (no Node deps).
 */
import type { RawCommand } from "../pipeline/types";
import type { Session, WatcherReport } from "../../types/report";
import { assembleReport } from "../pipeline/ingest";
import { harToRawCommands } from "./http-proxy";
import { sysmonToRawCommands } from "./sysmon";
import { claudeCodeToRawCommands } from "./claude-code";

export type CaptureKind = "http-proxy" | "sysmon" | "claude-code";

export interface DetectedCapture {
  kind: CaptureKind;
  shell: string;
  scope: string;
  contextPath: string;
  raw: RawCommand[];
}

function newUuid(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return "00000000-0000-4000-8000-" + Date.now().toString(16).padStart(12, "0");
  }
}

/** Try each adapter in a non-overlapping order; first with commands wins. */
export function detectCapture(text: string, filename = ""): DetectedCapture | null {
  const har = harToRawCommands(text);
  if (har.length) {
    let host = "";
    try {
      host = new URL(har[0].web?.url ?? "").host;
    } catch {
      /* leave host empty */
    }
    return { kind: "http-proxy", shell: "http-proxy", contextPath: "web", scope: host ? `HTTP proxy :: ${host}` : "HTTP proxy capture", raw: har };
  }

  const sys = sysmonToRawCommands(text);
  if (sys.length) {
    return { kind: "sysmon", shell: "sysmon", contextPath: "host", scope: "Sysmon capture", raw: sys };
  }

  const cc = claudeCodeToRawCommands(text);
  if (cc.length) {
    const base = filename.replace(/\.[^.]+$/, "");
    return { kind: "claude-code", shell: "claude-code", contextPath: "host", scope: base ? `Claude Code :: ${base}` : "Claude Code session", raw: cc };
  }

  return null;
}

/** Detect the format, run the adapter, and assemble a full report — or null if unrecognized. */
export function reportFromCapture(text: string, filename = ""): WatcherReport | null {
  const d = detectCapture(text, filename);
  if (!d) return null;
  const session: Session = {
    uuid: newUuid(),
    started_at: new Date(d.raw[0].started_at_ms).toISOString(),
    ended_at: new Date(d.raw[d.raw.length - 1].ended_at_ms).toISOString(),
    target_scope: d.scope,
    context_path: d.contextPath,
    shell: d.shell,
    source: "plugin",
  };
  return assembleReport(d.raw, { golden: [], session, redaction_profile: "full" });
}
