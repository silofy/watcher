/**
 * Ingest adapter: a Claude Code session transcript (JSONL) → RawCommand[].
 *
 * Each `Bash` tool_use is joined to its tool_result by `tool_use_id`: the command
 * becomes the RawCommand, the result its output. Timing is wall-clock from the
 * message timestamps, which includes the agent's think-time between tool calls —
 * the analogue of a human operator's hesitation the pipeline already grades.
 *
 * Ingested output is scrubbed for credentials (redactText) and then normalized to
 * plain ASCII (stripAiTells) before it lands in `output_digest`. The command
 * string itself is left verbatim. Non-Bash tools (Read/Edit/MCP/…) are ignored in
 * v1; a command with no matching result is dropped as incomplete.
 */
import type { RawCommand } from "../pipeline/types";
import { redactText } from "../redact";
import { stripAiTells } from "./text-filter";

/** Default cap on stored digest length; output_line_count is always the full count. */
const MAX_DIGEST_CHARS = 4000;

export interface ClaudeCodeParseOptions {
  /** Cap on stored `output_digest` length (line count is computed from full text). */
  maxDigestChars?: number;
}

interface PendingCall {
  cmd: string;
  startedMs: number;
}

function toMs(ts: unknown): number | null {
  if (typeof ts !== "string") return null;
  const ms = Date.parse(ts);
  return Number.isNaN(ms) ? null : ms;
}

/** A tool_result's content is either a string or an array of `{ type, text }` parts. */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === "object" && "text" in p ? String((p as { text?: unknown }).text ?? "") : "",
      )
      .join("");
  }
  return "";
}

export function claudeCodeToRawCommands(
  jsonl: string,
  opts: ClaudeCodeParseOptions = {},
): RawCommand[] {
  const maxDigest = opts.maxDigestChars ?? MAX_DIGEST_CHARS;
  const pending = new Map<string, PendingCall>();
  const raw: RawCommand[] = [];

  for (const line of jsonl.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: unknown;
    try {
      rec = JSON.parse(trimmed);
    } catch {
      continue; // tolerate partial/corrupt lines
    }
    const o = rec as { timestamp?: unknown; message?: { content?: unknown } };
    const content = o.message?.content;
    if (!Array.isArray(content)) continue;
    const ts = toMs(o.timestamp);

    for (const part of content) {
      const c = part as {
        type?: string;
        name?: string;
        id?: string;
        input?: { command?: unknown };
        tool_use_id?: string;
        is_error?: boolean;
        content?: unknown;
      };
      if (!c || typeof c !== "object") continue;

      if (c.type === "tool_use" && c.name === "Bash" && typeof c.id === "string") {
        const cmd = String(c.input?.command ?? "").trim();
        if (cmd && ts != null) pending.set(c.id, { cmd, startedMs: ts });
      } else if (
        c.type === "tool_result" &&
        typeof c.tool_use_id === "string" &&
        pending.has(c.tool_use_id)
      ) {
        const { cmd, startedMs } = pending.get(c.tool_use_id)!;
        pending.delete(c.tool_use_id);
        const text = resultText(c.content);
        const digest = stripAiTells(redactText(text));
        raw.push({
          cmd,
          started_at_ms: startedMs,
          ended_at_ms: ts ?? startedMs,
          // Claude Code does not surface a numeric exit code; is_error is the best available signal.
          exit_code: c.is_error ? 1 : 0,
          output_line_count: text ? text.split("\n").length : 0,
          output_digest: digest.length > maxDigest ? digest.slice(0, maxDigest) : digest,
          context_path: "host",
        } satisfies RawCommand);
      }
    }
  }

  raw.sort((a, b) => a.started_at_ms - b.started_at_ms);
  return raw;
}
