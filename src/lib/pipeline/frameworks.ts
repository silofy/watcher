/**
 * Multi-framework enrichment — a second and third axis on top of MITRE ATT&CK.
 *
 * ATT&CK is a flat, unordered matrix: it tells you the *tactic* but imposes no
 * sequence and under-distinguishes the *weakness* exploited. Two of its blind spots
 * are exactly where the grade loses resolution, so we overlay:
 *
 *   - Unified Kill Chain (UKC) — an ORDERED phase sequence. The rank is what makes
 *     "progression" measurable (did the operator advance cleanly, or thrash?).
 *   - CWE — the weakness class actually exploited, so breadth counts distinct
 *     weaknesses (SQLi + XXE) rather than collapsing them to one ATT&CK technique.
 *
 * Every map here is a static, published cross-mapping — never an invented one. An
 * absent entry is deliberate: an empty CWE is honest, a guessed one is noise.
 * Pure and deterministic, like the rest of the metrics path — the LLM never touches it.
 */
import type { Episode } from "../../types/report";

/**
 * Unified Kill Chain, condensed for single-box HTB play and kept in attack ORDER.
 * The array index is the rank used by `ukcProgression`. Tactics that don't occur in
 * this tool's tagging (e.g. internal Discovery, which it folds into reconnaissance)
 * are intentionally omitted rather than left unreachable.
 */
export const UKC_ORDER = [
  "reconnaissance",
  "exploitation",
  "execution",
  "persistence",
  "defense-evasion",
  "credential-access",
  "privilege-escalation",
  "lateral-movement",
  "command-and-control",
  "collection",
  "exfiltration",
  "objectives",
] as const;

export type UkcPhase = (typeof UKC_ORDER)[number];

/** Rank of a UKC phase in attack order, or -1 if unknown. */
export const ukcRank = (phase: UkcPhase): number => UKC_ORDER.indexOf(phase);

/**
 * ATT&CK tactic → UKC phase. TA0007 (Discovery) maps to `reconnaissance` because this
 * tool uses it for the opening scan/enumeration phase, not post-compromise internal
 * discovery — so it must rank first, where the work actually happens.
 */
export const ATTACK_TACTIC_TO_UKC: Record<string, UkcPhase> = {
  TA0007: "reconnaissance",
  TA0001: "exploitation",
  TA0002: "execution",
  TA0003: "persistence",
  TA0005: "defense-evasion",
  TA0006: "credential-access",
  TA0004: "privilege-escalation",
  TA0008: "lateral-movement",
  TA0011: "command-and-control",
  TA0009: "collection",
  TA0010: "exfiltration",
  TA0040: "objectives",
};

/**
 * Binary → CWE weakness class, seeded only where the tool unambiguously implies the
 * weakness being exploited (not merely the action taken). Enumeration tools map to
 * nothing on purpose: scanning a directory exploits no weakness. The map grows as
 * unambiguous cases are added; sparse-but-correct beats dense-but-wrong.
 */
export const BINARY_TO_CWE: Record<string, string[]> = {
  // injection — the tool exists to exploit one specific weakness class
  sqlmap: ["CWE-89"], // SQL injection
  nosqlmap: ["CWE-943"], // NoSQL injection
  commix: ["CWE-78"], // OS command injection
  tplmap: ["CWE-1336"], // server-side template injection
  xxeinjector: ["CWE-611"], // XML external entity
  ssrfmap: ["CWE-918"], // server-side request forgery
  ysoserial: ["CWE-502"], // insecure deserialization
  "ysoserial.net": ["CWE-502"],
  // credentials — exploiting weak/guessable secrets
  hydra: ["CWE-307"], // improper restriction of excessive auth attempts
  medusa: ["CWE-307"],
  patator: ["CWE-307"],
  crackmapexec: ["CWE-307"],
  john: ["CWE-521"], // weak password requirements (offline cracking evidences it)
  hashcat: ["CWE-521"],
};

/** CWE id → short human name, for display. Covers exactly the ids the binary map can produce. */
export const CWE_NAMES: Record<string, string> = {
  "CWE-89": "SQL injection",
  "CWE-943": "NoSQL injection",
  "CWE-78": "OS command injection",
  "CWE-1336": "Template injection (SSTI)",
  "CWE-611": "XML external entity (XXE)",
  "CWE-918": "Server-side request forgery",
  "CWE-502": "Insecure deserialization",
  "CWE-307": "Unthrottled auth attempts",
  "CWE-521": "Weak credentials",
};

/** Human-readable CWE label, e.g. "CWE-89 · SQL injection" (falls back to the bare id). */
export const cweLabel = (id: string): string => (CWE_NAMES[id] ? `${id} · ${CWE_NAMES[id]}` : id);

/** UKC phase as a display label, e.g. "command-and-control" → "Command and control". */
export const ukcLabel = (phase: UkcPhase): string => {
  const words = phase.replace(/-/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};

export interface EpisodeFrameworks {
  /** UKC phase derived from the ATT&CK tactic. */
  ukc?: UkcPhase;
  /** Distinct CWE weakness classes the episode exploited (may be empty/absent). */
  cwe?: string[];
}

/** UKC phase for an episode's ATT&CK tactic, or undefined if the tactic is unmapped. */
export function ukcOf(ep: Pick<Episode, "tactic">): UkcPhase | undefined {
  return ATTACK_TACTIC_TO_UKC[ep.tactic];
}

/** CWE weakness classes implied by an episode's tooling (empty when none is unambiguous). */
export function cweOf(ep: Pick<Episode, "binary">): string[] {
  return BINARY_TO_CWE[ep.binary?.toLowerCase()] ?? [];
}

/** The frameworks block for one episode — omits keys that have no value (keeps reports lean). */
export function deriveFrameworks(ep: Pick<Episode, "tactic" | "binary">): EpisodeFrameworks | undefined {
  const ukc = ukcOf(ep);
  const cwe = cweOf(ep);
  const out: EpisodeFrameworks = {};
  if (ukc) out.ukc = ukc;
  if (cwe.length) out.cwe = cwe;
  return out.ukc || out.cwe ? out : undefined;
}

/** Stamp `frameworks` onto each episode (returns a new array; pure). */
export function enrichFrameworks(episodes: Episode[]): Episode[] {
  return episodes.map((ep) => {
    const frameworks = deriveFrameworks(ep);
    return frameworks ? { ...ep, frameworks } : ep;
  });
}

// ---- Per-axis metrics ----

/**
 * UKC phase coverage: distinct UKC phases the run reached, over the phases the intended
 * path requires (derived from the golden DAG's tactics). 0 when there's no reference —
 * same convention as objective coverage, so an active box (no write-up) reads as 0, not NaN.
 */
export function ukcCoverage(episodes: Pick<Episode, "tactic">[], goldenTactics: string[]): number {
  const required = new Set(goldenTactics.map((t) => ATTACK_TACTIC_TO_UKC[t]).filter(Boolean) as UkcPhase[]);
  if (required.size === 0) return 0;
  const reached = new Set(episodes.map((e) => ATTACK_TACTIC_TO_UKC[e.tactic]).filter(Boolean) as UkcPhase[]);
  let hit = 0;
  for (const phase of required) if (reached.has(phase)) hit++;
  return (hit / required.size) * 100;
}

/**
 * Progression: of the consecutive UKC-ranked transitions, the share that don't move
 * backward. Advancing in order (or holding a phase) scores; backtracking to an earlier
 * phase costs. 100 for a clean monotonic run, 100 when there's nothing to compare.
 * This is the precision ATT&CK structurally cannot provide — it has no order.
 */
export function ukcProgression(episodes: Pick<Episode, "tactic">[]): number {
  const ranks = episodes
    .map((e) => ATTACK_TACTIC_TO_UKC[e.tactic])
    .filter(Boolean)
    .map((p) => ukcRank(p as UkcPhase));
  if (ranks.length < 2) return 100;
  let forward = 0;
  for (let i = 1; i < ranks.length; i++) if (ranks[i] >= ranks[i - 1]) forward++;
  return (forward / (ranks.length - 1)) * 100;
}

/** Distinct CWE weakness classes across the run — a sharper breadth than distinct techniques. */
export function weaknessBreadth(episodes: Pick<Episode, "binary">[]): number {
  return runWeaknesses(episodes).length;
}

/** The distinct CWE ids the run exploited, in first-seen order (for display). */
export function runWeaknesses(episodes: Pick<Episode, "binary">[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const e of episodes) for (const c of cweOf(e)) if (!seen.has(c)) (seen.add(c), out.push(c));
  return out;
}

/** The set of UKC phases the run reached (derived from tactics). */
export function reachedUkcPhases(episodes: Pick<Episode, "tactic">[]): Set<UkcPhase> {
  return new Set(episodes.map((e) => ATTACK_TACTIC_TO_UKC[e.tactic]).filter(Boolean) as UkcPhase[]);
}
