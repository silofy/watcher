/**
 * Deterministic typography normalizer for text ingested from AI-agent harnesses.
 *
 * Model-authored output carries "AI tell" punctuation — em dashes, curly quotes,
 * ellipsis glyphs, non-breaking and zero-width spaces. When we ingest an agent's
 * session (see ./claude-code.ts) we strip those to plain ASCII so a captured
 * digest reads like a terminal, not a chatbot. This is purely typographic and
 * reversible in spirit; credential redaction is a separate concern — run
 * redactText() (../redact) first, then this.
 */

/** Ordered replacements: each AI-tell glyph class → its plain-ASCII equivalent. */
const REPLACEMENTS: ReadonlyArray<readonly [RegExp, string]> = [
  [/[‒–—―]/g, "-"], // figure/en/em dash, horizontal bar → hyphen
  [/[‘’‚‛]/g, "'"], // curly / low single quotes → apostrophe
  [/[“”„‟]/g, '"'], // curly / low double quotes → straight quote
  [/…/g, "..."], // horizontal ellipsis → three dots
  [/[    ]/g, " "], // nbsp / figure / thin / narrow-nbsp → space
  [/[​‌‍﻿]/g, ""], // zero-width space/joiner/BOM → removed
];

/** Replace AI-tell punctuation with plain ASCII. Leaves ordinary ASCII untouched. */
export function stripAiTells(text: string): string {
  let out = text;
  for (const [re, rep] of REPLACEMENTS) out = out.replace(re, rep);
  return out;
}
