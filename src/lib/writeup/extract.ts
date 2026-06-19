/**
 * Layer 2 — turn a box write-up into a golden DAG (the intended objective path), which align.ts
 * then diffs your run against. Extraction is the one job that genuinely needs the LLM: prose →
 * structured, tool-agnostic objectives. Deterministic-first still holds — with no model (NullProvider)
 * this returns [] and the report stays honest Layer-1.
 *
 * Privacy: this operates on text you already have (pasted/fetched). Nothing about your SESSION is
 * sent to the model beyond the box name; the write-up is public content.
 */
import type { GoldenObjective } from "../../types/report";
import type { LlmProvider } from "../llm/provider";

export interface BoxRef {
  name: string;
  slug?: string;
  os?: string | null;
}

export interface WriteupResult {
  golden: GoldenObjective[];
  source: string; // "pasted" | "0xdf" | "htb-official" | ...
  confidence: number; // 0..1
  note?: string;
}

/** Ollama structured-output schema — forces the model to return a valid objective list. */
export const GOLDEN_DAG_SCHEMA = {
  type: "object",
  properties: {
    objectives: {
      type: "array",
      items: {
        type: "object",
        properties: {
          objective: { type: "string" },
          tactic: { type: "string" },
          satisfied_by: { type: "array", items: { type: "string" } },
          depends_on: { type: "array", items: { type: "string" } },
        },
        required: ["objective", "tactic", "satisfied_by"],
      },
    },
  },
  required: ["objectives"],
} as const;

const KNOWN_TACTICS = new Set(["TA0043", "TA0007", "TA0001", "TA0002", "TA0006", "TA0004", "TA0008", "TA0011", "TA0005", "TA0003", "TA0010", "TA0040"]);
const MAX_WRITEUP_CHARS = 14_000;
const MAX_OBJECTIVES = 12;

export function buildPrompt(text: string, box: BoxRef): string {
  const clipped = text.length > MAX_WRITEUP_CHARS ? text.slice(0, MAX_WRITEUP_CHARS) : text;
  return [
    `Extract the INTENDED solution path for the Hack The Box machine "${box.name}"${box.os ? ` (${box.os})` : ""} from this write-up,`,
    `as a tool-agnostic objective graph. Return ONLY JSON matching the schema.`,
    ``,
    `Rules:`,
    `- 4 to ${MAX_OBJECTIVES} objectives, ordered from recon to root.`,
    `- objective: a short snake_case id (e.g. enumerate_web, exploit_file_upload, escalate_to_root).`,
    `- tactic: the MITRE ATT&CK tactic id — TA0007 discovery, TA0001 initial access, TA0002 execution,`,
    `  TA0006 credential access, TA0004 privilege escalation, TA0008 lateral movement.`,
    `- satisfied_by: 1-4 concrete methods/tools that accomplish it, primary first, tool names lowercase.`,
    `- depends_on: ids of objectives that must come first (their prerequisites).`,
    `- Only include steps actually in the write-up. Do not invent.`,
    ``,
    `WRITE-UP:`,
    `"""`,
    clipped,
    `"""`,
  ].join("\n");
}

/** Validate + clean raw model output into a GoldenObjective[]; tolerant of array or {objectives}. */
export function coerce(raw: unknown): GoldenObjective[] {
  const arr = Array.isArray(raw) ? raw : Array.isArray((raw as { objectives?: unknown })?.objectives) ? (raw as { objectives: unknown[] }).objectives : [];
  const ids = new Set<string>();
  const out: GoldenObjective[] = [];
  for (const item of arr as Record<string, unknown>[]) {
    if (!item || typeof item.objective !== "string") continue;
    const objective = item.objective.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
    if (!objective || ids.has(objective)) continue;
    const satisfied_by = Array.isArray(item.satisfied_by) ? (item.satisfied_by as unknown[]).filter((m): m is string => typeof m === "string" && m.trim().length > 0).map((m) => m.trim()) : [];
    if (satisfied_by.length === 0) continue;
    const tRaw = typeof item.tactic === "string" ? item.tactic.toUpperCase().trim() : "";
    const tactic = KNOWN_TACTICS.has(tRaw) ? tRaw : "TA0002";
    const depends_on = Array.isArray(item.depends_on)
      ? (item.depends_on as unknown[]).filter((d): d is string => typeof d === "string").map((d) => d.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""))
      : [];
    ids.add(objective);
    out.push({ objective, tactic, satisfied_by, depends_on });
    if (out.length >= MAX_OBJECTIVES) break;
  }
  // keep depends_on referencing only earlier-defined objectives (drop dangling)
  for (const o of out) o.depends_on = o.depends_on?.filter((d) => ids.has(d));
  return out;
}

export async function extractGoldenDag(text: string, box: BoxRef, provider: LlmProvider): Promise<GoldenObjective[]> {
  if (!text.trim()) return [];
  const raw = await provider.generateJson(buildPrompt(text, box), { schema: GOLDEN_DAG_SCHEMA, temperature: 0 });
  return coerce(raw);
}
