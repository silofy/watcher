/**
 * Coaching-step helpers. Steps are structured ({action, why, category, evidence_seq}) at the source,
 * but older/raw producers (the Rust daemon, legacy fixtures, the local model) may still emit plain
 * markdown strings — so everything funnels through `toCoachingStep`, which parses a "**do this.** why"
 * string into the structured shape and infers a category. Keep this the single place that does it.
 */
import type { CoachCategory, CoachingStep } from "../types/report";

export const CAT_COLOR: Record<CoachCategory, string> = {
  Recon: "var(--color-signal)",
  Web: "var(--color-match)",
  Access: "var(--color-alt)",
  PrivEsc: "var(--color-detour)",
  OpSec: "var(--color-tool)",
  Tactics: "var(--color-muted)",
  Recap: "var(--color-muted)",
};

const CAT_RULES: { test: RegExp; label: CoachCategory }[] = [
  { test: /sudo|privesc|kernel|suid|cron|capabilit|gtfo|escalat|\broot\b/i, label: "PrivEsc" },
  { test: /noise|loud|stealth|opsec|rate.?limit|detour|quiet/i, label: "OpSec" },
  { test: /credential|hydra|brute|password|login|default cred|\bssh\b|reuse|lateral/i, label: "Access" },
  { test: /nmap|gobuster|ffuf|enumerat|recon|\bscan\b/i, label: "Recon" },
  { test: /upload|web ?shell|http|payload|\.ph/i, label: "Web" },
];

export function classifyCoaching(text: string): CoachCategory {
  return CAT_RULES.find((c) => c.test.test(text))?.label ?? "Tactics";
}

/** Split "**Do this.** here's why…" into a lead action and the supporting rationale. */
export function splitLead(md: string): { action: string; why: string } {
  const bold = md.match(/^\s*\*\*(.+?)\*\*\s*/s);
  if (bold) return { action: bold[1].trim(), why: md.slice(bold[0].length).trim() };
  // no bold lead — take the first short sentence as the action
  const dot = md.indexOf(". ");
  if (dot > 0 && dot < 90) return { action: md.slice(0, dot + 1).trim(), why: md.slice(dot + 2).trim() };
  return { action: md.trim(), why: "" };
}

export function toCoachingStep(raw: string | CoachingStep): CoachingStep {
  if (typeof raw !== "string") return raw;
  const { action, why } = splitLead(raw);
  return { action, why, category: classifyCoaching(raw), evidence_seq: null };
}

export function normalizeCoaching(steps: ReadonlyArray<string | CoachingStep> | undefined): CoachingStep[] {
  return (steps ?? []).map(toCoachingStep);
}

/** Plain-text flattening (for the IdentityBar takeaway): drop markdown emphasis/code markers. */
export function stepText(step: CoachingStep): string {
  return `${step.action} ${step.why}`.replace(/\*\*/g, "").replace(/`/g, "").trim();
}
