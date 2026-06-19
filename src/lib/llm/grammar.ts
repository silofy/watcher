/**
 * Constrained decoding (brief §4.2). A GBNF grammar (llama.cpp) or a JSON schema (Ollama
 * structured outputs) forces a quantized model to stay in valid JSON — it cannot drift. The same
 * tactic set bounds both. Reproducibility comes from this plus temperature 0.1–0.2.
 */

/** The MITRE tactics the classifier may emit (matches the deterministic table + report schema). */
export const TACTICS = ["TA0007", "TA0001", "TA0002", "TA0004", "TA0008", "TA0011", "TA0010"] as const;

/** GBNF grammar for llama.cpp — the brief's grammar, widened to the full tactic set. */
export const CLASSIFY_GBNF = `
root   ::= "{" ws "\\"tactic\\"" ws ":" ws tactic ws "," ws "\\"confidence\\"" ws ":" ws number ws "}"
tactic ::= ${TACTICS.map((t) => `"\\"${t}\\""`).join(" | ")}
number ::= "0" "." [0-9]+ | "1" ("." "0"+)?
ws     ::= [ \\t\\n]*
`.trim();

/** Ollama structured-output schema for one episode's classification refinement. */
export const CLASSIFY_SCHEMA = {
  type: "object",
  required: ["tactic", "confidence"],
  additionalProperties: false,
  properties: {
    tactic: { type: "string", enum: [...TACTICS] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
} as const;

/** Ollama structured-output schema for the objective-equivalence judgment (§4.3). */
export const EQUIV_SCHEMA = {
  type: "object",
  required: ["equivalent"],
  additionalProperties: false,
  properties: {
    equivalent: { type: "boolean" },
    reason: { type: "string" },
  },
} as const;
