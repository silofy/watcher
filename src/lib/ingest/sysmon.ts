/**
 * Ingest adapter: a Sysmon / Windows Event Log export → RawCommand[].
 *
 * This is the defense-side capture path: instead of a shell recording what YOU
 * typed, it reads the host's own telemetry (Sysmon Event ID 1, ProcessCreate) and
 * reconstructs the commands that ran. Each process-create becomes a RawCommand
 * whose `cmd` is the process command line, timed from the event's UtcTime. It
 * lets the grader sit on top of an EDR/Sysmon feed rather than produce one.
 *
 * Two common export shapes are accepted, as a JSON array or NDJSON:
 *   1. Flattened: { EventID: 1, UtcTime, CommandLine, Image, User, ParentImage, ... }
 *      (Get-WinEvent | ConvertTo-Json, EvtxECmd, Chainsaw, winlogbeat-flattened)
 *   2. Raw Windows Event: { Event: { System: { EventID }, EventData: { Data: [
 *        { "@Name": "CommandLine", "#text": "..." }, ... ] } } }
 *
 * Command lines are credential-scrubbed (redactText); the digest carries the user
 * and parent image for context. Non-ProcessCreate events are ignored in v1.
 */
import type { RawCommand } from "../pipeline/types";
import { redactText } from "../redact";

export interface SysmonParseOptions {
  /** context_path stamped on each command (default "edr:sysmon"). */
  contextPath?: string;
}

/** Flatten either export shape into a plain field map (field name → string value). */
function fieldMap(event: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!event || typeof event !== "object") return out;
  const o = event as Record<string, unknown>;

  // Shape 2: raw Windows Event with nested System/EventData.
  const ev = o.Event as { System?: Record<string, unknown>; EventData?: { Data?: unknown } } | undefined;
  if (ev && typeof ev === "object") {
    const sys = ev.System ?? {};
    for (const [k, v] of Object.entries(sys)) if (typeof v === "string" || typeof v === "number") out[k] = String(v);
    const data = ev.EventData?.Data;
    if (Array.isArray(data)) {
      for (const d of data) {
        if (d && typeof d === "object" && "@Name" in d) {
          const name = String((d as Record<string, unknown>)["@Name"]);
          const text = (d as Record<string, unknown>)["#text"];
          out[name] = text == null ? "" : String(text);
        }
      }
    }
    return out;
  }

  // Shape 1: already flattened.
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" || typeof v === "number") out[k] = String(v);
  }
  return out;
}

function eventId(f: Record<string, string>): number | null {
  const raw = f.EventID ?? f["Event ID"] ?? f.Id ?? f.event_id;
  if (raw == null) return null;
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

/** Sysmon UtcTime is "2026-09-28 14:00:00.123" (UTC, no zone). Parse it as UTC. */
function utcTimeMs(f: Record<string, string>): number | null {
  const raw = f.UtcTime ?? f.SystemTime ?? f.TimeCreated ?? "";
  if (!raw) return null;
  const iso = /Z|[+-]\d\d:?\d\d$/.test(raw) ? raw : raw.trim().replace(" ", "T") + "Z";
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** First non-empty of the given field names. */
function pick(f: Record<string, string>, ...names: string[]): string {
  for (const n of names) if (f[n]) return f[n];
  return "";
}

/** Parse a JSON array or NDJSON string into a list of event objects. */
function parseEvents(text: string): unknown[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && typeof parsed === "object") return [parsed];
  } catch {
    // fall through to NDJSON
  }
  const out: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l) continue;
    try {
      out.push(JSON.parse(l));
    } catch {
      /* skip corrupt line */
    }
  }
  return out;
}

export function sysmonToRawCommands(text: string, opts: SysmonParseOptions = {}): RawCommand[] {
  const contextPath = opts.contextPath ?? "edr:sysmon";
  const raw: RawCommand[] = [];

  for (const event of parseEvents(text)) {
    const f = fieldMap(event);
    if (eventId(f) !== 1) continue; // ProcessCreate only in v1
    const cmdline = pick(f, "CommandLine", "Image");
    if (!cmdline) continue;
    const startMs = utcTimeMs(f);
    if (startMs == null) continue;

    const user = pick(f, "User");
    const parent = pick(f, "ParentImage", "ParentCommandLine");
    const contextBits = [user && `user ${user}`, parent && `parent ${parent}`].filter(Boolean).join(" · ");

    raw.push({
      cmd: redactText(cmdline),
      started_at_ms: startMs,
      ended_at_ms: startMs, // ProcessCreate is a point event; Sysmon EID 1 carries no duration
      exit_code: null,
      output_line_count: 0,
      output_digest: contextBits ? redactText(contextBits) : undefined,
      context_path: contextPath,
    } satisfies RawCommand);
  }

  raw.sort((a, b) => a.started_at_ms - b.started_at_ms);
  return raw;
}
