/**
 * Deterministic, key-sorted JSON serialization — the seed `attest.ts` hashes to produce an
 * attestation's `hash`. Split into its own module (no `node:crypto`, no Node-only APIs) so the same
 * canonicalization can be reused anywhere a matching hash is needed without pulling in `attest.ts`'s
 * Node-only surface. Today its only importer is `attest.ts` itself, used by the `npm run attest` /
 * bundle-signing path (`scripts/attest.tsx`, `bundle.ts`) that produces the hash-chained attestation
 * handed to an institution — not anything reachable from the browser app.
 */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const obj = v as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(obj[k])}`)
    .join(",")}}`;
}
