/**
 * Shared prompt guidance so model-generated prose reads like a person wrote it,
 * not a chatbot. Distilled from the Quirón humanizer (the measured AI-tell
 * patterns) and the attention-span output styles (lead with the point, cut
 * filler). Injected into every prompt that asks a model for prose
 * (report/narrate, ghost/narrate). A deterministic stripAiTells() pass
 * (../ingest/text-filter) backs it up, so an em dash never survives even when the
 * model ignores the instruction.
 */
export const HUMANIZE_STYLE = [
  "Write like a person, not an AI:",
  "- No em dashes or en dashes. Use a comma, a colon, or a full stop.",
  '- No "not just X but Y" phrasing, and no rule-of-three lists written for rhythm.',
  '- No hedging or filler ("it\'s worth noting", "essentially", "simply") and no connective openers ("Moreover", "Furthermore").',
  "- Lead with the point. Vary sentence length. Prefer plain words to long ones.",
].join("\n");
