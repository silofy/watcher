/**
 * LLM-refined per-step coaching. Deterministic-first: the rules in DeviationTimeline already produce
 * a grounded suggestion from the golden DAG; this sharpens each one into specific, box-aware advice
 * using the LOCAL model only (Ollama). NullProvider → empty map → the rules-based text stands.
 *
 * Privacy: only commands/output you already captured are read, by a model on your machine.
 */
import type { LlmProvider } from "./provider";
import type { WatcherReport } from "../../types/report";

export interface CoachStep {
  seq: number;
  cmd: string;
  output: string;
  kind: string; // dead-end | loop | stall
  intended: string; // the deterministic, golden-DAG-grounded baseline
}

export const COACH_SCHEMA = {
  type: "object",
  properties: {
    coaching: {
      type: "array",
      items: {
        type: "object",
        properties: { seq: { type: "number" }, suggestion: { type: "string" } },
        required: ["seq", "suggestion"],
      },
    },
  },
  required: ["coaching"],
} as const;

export function buildCoachPrompt(machine: string, steps: CoachStep[]): string {
  const lines = steps.map(
    (s) => `[#${s.seq}] cmd: ${JSON.stringify(s.cmd).slice(0, 200)} | result: ${JSON.stringify(s.output).slice(0, 180)} | issue: ${s.kind} | intended: ${s.intended}`,
  );
  return [
    `You are a blunt, expert offensive-security coach reviewing a Hack The Box "${machine}" session.`,
    `For EACH step below, write ONE specific, actionable suggestion (max 24 words) for what the operator should have done instead or next.`,
    `Reference the actual command and result; name the better tool/flag/approach. No flattery, no filler, no markdown.`,
    `Return ONLY JSON matching the schema — exactly one entry per step seq.`,
    ``,
    `Steps:`,
    ...lines,
  ].join("\n");
}

/** Returns seq → refined suggestion. Empty when no model / nothing usable came back. */
export async function refineCoaching(report: WatcherReport, steps: CoachStep[], provider: LlmProvider): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  if (steps.length === 0) return out;
  const machine = report.session.machine?.name ?? report.session.target_scope ?? "the box";
  const raw = await provider.generateJson(buildCoachPrompt(machine, steps.slice(0, 15)), { schema: COACH_SCHEMA, temperature: 0.2 });
  const arr = (raw as { coaching?: { seq?: unknown; suggestion?: unknown }[] } | null)?.coaching;
  if (!Array.isArray(arr)) return out;
  for (const c of arr) {
    if (typeof c?.seq === "number" && typeof c?.suggestion === "string" && c.suggestion.trim()) out.set(c.seq, c.suggestion.trim());
  }
  return out;
}
