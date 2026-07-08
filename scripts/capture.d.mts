// Type surface for the pure helpers exported by capture.mjs, imported by
// tests/capture-wrapper.test.ts. The script itself is a runtime Node entrypoint
// (run via `node scripts/capture.mjs`), so it stays plain JS; only its testable
// exports need declaring for `tsc -b`.
export const MODE_FLAGS: string[];
export function withDefaultMode(args: string[]): string[];
export function binaryRelPath(platform: string): string;
