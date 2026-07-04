/**
 * Deterministic, key-sorted JSON serialization — the seed `attest.ts` hashes to produce an
 * attestation's `hash`. Split into its own module (no `node:crypto`, no Node-only APIs) so it can be
 * imported from browser code too: the debrief's "Sync to institution" download (`Assessment.tsx`)
 * reuses it with Web Crypto (`crypto.subtle`) to compute the exact same content hash `npm run attest`
 * would sign, without pulling `node:crypto` into the client bundle (Vite/Rollup externalizes it and
 * the production build fails hard the moment anything importing it is reachable from browser code).
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
