/**
 * Ingest adapter: an HTTP Archive (HAR 1.2) export → RawCommand[].
 *
 * HAR is the universal proxy format — Burp, ZAP, mitmproxy and browser DevTools
 * all export it — so this ingests offline web-traffic captures the same way the
 * live Burp bridge feeds the pipeline. Each HAR entry becomes a web RawCommand:
 * `cmd` is "<METHOD> <path>", timing is the entry's start plus its `time`, and
 * the request/response land in the `web` exchange. URLs and bodies are scrubbed
 * for credentials (redactText); response bodies are truncated to a digest.
 *
 * HTTP bodies are data, not prose, so stripAiTells is intentionally not applied.
 */
import type { RawCommand } from "../pipeline/types";
import { redactText } from "../redact";

/** Default cap on a stored response body; large payloads are truncated to a digest. */
const MAX_BODY_CHARS = 2000;

export interface HarParseOptions {
  /** Cap on stored `resp_body` length. */
  maxBodyChars?: number;
  /** context_path stamped on each exchange (default "web:har"). */
  contextPath?: string;
}

interface HarEntry {
  startedDateTime?: string;
  time?: number;
  request?: {
    method?: string;
    url?: string;
    postData?: { text?: string };
  };
  response?: {
    status?: number;
    content?: { text?: string; mimeType?: string; encoding?: string };
  };
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** HAR content.text may be base64 (encoding: "base64"); decode when we can, else mark it. */
function bodyText(content?: { text?: string; mimeType?: string; encoding?: string }): string | undefined {
  if (!content || content.text == null) return undefined;
  if (content.encoding === "base64") {
    try {
      return Buffer.from(content.text, "base64").toString("utf8");
    } catch {
      return "[binary body]";
    }
  }
  return content.text;
}

export function harToRawCommands(harJson: string, opts: HarParseOptions = {}): RawCommand[] {
  const maxBody = opts.maxBodyChars ?? MAX_BODY_CHARS;
  const contextPath = opts.contextPath ?? "web:har";

  let parsed: unknown;
  try {
    parsed = JSON.parse(harJson);
  } catch {
    return [];
  }
  const entries = (parsed as { log?: { entries?: unknown } })?.log?.entries;
  if (!Array.isArray(entries)) return [];

  const raw: RawCommand[] = [];
  for (const e of entries as HarEntry[]) {
    const req = e.request;
    if (!req || typeof req.url !== "string") continue;
    const startMs = e.startedDateTime ? Date.parse(e.startedDateTime) : NaN;
    if (Number.isNaN(startMs)) continue;
    const durMs = typeof e.time === "number" && e.time > 0 ? Math.round(e.time) : 0;
    const method = req.method ?? "GET";
    const url = redactText(req.url);
    const rawResp = bodyText(e.response?.content);
    const resp = rawResp != null ? redactText(rawResp) : undefined;

    raw.push({
      cmd: `${method} ${pathOf(url)}`,
      started_at_ms: startMs,
      ended_at_ms: startMs + durMs,
      exit_code: null,
      output_line_count: 0,
      context_path: contextPath,
      web: {
        method,
        url,
        req_body: req.postData?.text != null ? redactText(req.postData.text) : undefined,
        status: e.response?.status,
        resp_body: resp != null && resp.length > maxBody ? resp.slice(0, maxBody) : resp,
        mime: e.response?.content?.mimeType,
      },
    } satisfies RawCommand);
  }

  raw.sort((a, b) => a.started_at_ms - b.started_at_ms);
  return raw;
}
