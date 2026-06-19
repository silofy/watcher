/**
 * The LLM provider seam. The pipeline is deterministic-first; a provider only ever refines compact
 * cards (classification, equivalence) and is fully optional. NullProvider is the rules-only mode.
 */

export interface GenOptions {
  temperature?: number;
  /** Ollama structured-output JSON schema. */
  schema?: object;
  /** llama.cpp GBNF grammar. */
  grammar?: string;
}

export interface LlmProvider {
  readonly name: string;
  available(): Promise<boolean>;
  /** Constrained JSON generation; returns null on any failure so the caller falls back. */
  generateJson(prompt: string, opts?: GenOptions): Promise<unknown | null>;
}

/** Rules-only: no model. Everything falls back to the deterministic pipeline. */
export class NullProvider implements LlmProvider {
  readonly name = "rules-only";
  async available(): Promise<boolean> {
    return false;
  }
  async generateJson(): Promise<unknown | null> {
    return null;
  }
}
