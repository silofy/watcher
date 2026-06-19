/**
 * The two semantic-judgment passes the LLM is allowed to touch (brief §4.2, §4.3) — and only over
 * compact cards, never raw bytes. Both are deterministic-first: the deterministic prior stands
 * unless a confident model override arrives, so rules-only mode (NullProvider) is a true no-op.
 *
 *   refineClassification — confirm/override an episode's MITRE tactic (the table is the prior)
 *   judgeEquivalence     — does this episode satisfy this golden objective (the only LLM role in §4.3)
 */
import type { Episode, GoldenObjective, WatcherReport } from "../../types/report";
import { equivalenceIndex } from "../pipeline/align";
import { CLASSIFY_SCHEMA, EQUIV_SCHEMA, TACTICS } from "./grammar";
import type { LlmProvider } from "./provider";

/** Confidence below which we keep the deterministic prior rather than adopt the model's tactic. */
export const OVERRIDE_THRESHOLD = 0.5;

const TEMPERATURE = 0.15;

/** A compact, LLM-friendly card — never raw output, just the digest. */
function card(ep: Episode): string {
  return [
    `seq=${ep.seq}`,
    `cmd="${ep.cmd}"`,
    `binary=${ep.binary}`,
    ep.exit_code != null ? `exit=${ep.exit_code}` : "",
    ep.output_digest ? `output="${ep.output_digest}"` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

const FEWSHOT = [
  "Override examples (where the leading binary misleads):",
  "- `python3 -m http.server` during privesc → file staging (TA0011), NOT Execution.",
  "- `bash -c \"bash -i >& /dev/tcp/..\"` → Execution (TA0002), regardless of the binary.",
].join("\n");

function classifyPrompt(ep: Episode): string {
  return [
    "You label one pentest command with a MITRE ATT&CK tactic.",
    `Tactics: ${TACTICS.join(", ")}.`,
    FEWSHOT,
    `Deterministic prior: ${ep.tactic} (confidence ${ep.confidence ?? "?"}).`,
    `Episode: ${card(ep)}`,
    "Return the best tactic and your confidence (0–1). Keep the prior unless clearly wrong.",
  ].join("\n");
}

function equivPrompt(ep: Episode, obj: GoldenObjective): string {
  return [
    "Judge objective-equivalence: did the operator's action satisfy the write-up objective?",
    "A different tool that reaches the same objective counts as equivalent.",
    `Objective: "${obj.objective}" (tactic ${obj.tactic}); satisfied_by: ${obj.satisfied_by.join(", ")}.`,
    `Episode: ${card(ep)}`,
    "Return { equivalent: boolean }.",
  ].join("\n");
}

export interface Classification {
  tactic: string;
  technique?: string;
  confidence: number;
}

/** Refine one episode's classification. Falls back to the episode's existing (prior) values. */
export async function refineClassification(provider: LlmProvider, ep: Episode): Promise<Classification> {
  const fallback: Classification = { tactic: ep.tactic, technique: ep.technique, confidence: ep.confidence ?? 0.5 };
  const out = await provider.generateJson(classifyPrompt(ep), { temperature: TEMPERATURE, schema: CLASSIFY_SCHEMA });
  if (!out || typeof out !== "object") return fallback;
  const r = out as { tactic?: string; confidence?: number };
  if (!r.tactic || typeof r.confidence !== "number" || !(TACTICS as readonly string[]).includes(r.tactic)) return fallback;
  // deterministic-first: only adopt the model's tactic when it is confident
  if (r.confidence < OVERRIDE_THRESHOLD) return fallback;
  return { tactic: r.tactic, technique: ep.technique, confidence: r.confidence };
}

/** Judge whether an episode satisfies a golden objective. Falls back to deterministic equivalence. */
export async function judgeEquivalence(provider: LlmProvider, ep: Episode, obj: GoldenObjective): Promise<boolean> {
  const fallback = equivalenceIndex(ep, obj) >= 0;
  const out = await provider.generateJson(equivPrompt(ep, obj), { temperature: TEMPERATURE, schema: EQUIV_SCHEMA });
  if (!out || typeof out !== "object" || typeof (out as { equivalent?: unknown }).equivalent !== "boolean") return fallback;
  return (out as { equivalent: boolean }).equivalent;
}

/** Refine every runnable episode's classification. Rules-only (NullProvider) returns the report unchanged. */
export async function refineReport(report: WatcherReport, provider: LlmProvider): Promise<WatcherReport> {
  const episodes: Episode[] = [];
  for (const ep of report.episodes) {
    if (ep.actor === "think_pause" || ep.actor === "idle" || !ep.cmd) {
      episodes.push(ep);
      continue;
    }
    const r = await refineClassification(provider, ep);
    episodes.push({ ...ep, tactic: r.tactic, technique: r.technique ?? ep.technique, confidence: r.confidence });
  }
  return { ...report, episodes };
}
