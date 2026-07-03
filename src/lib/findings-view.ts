import type { Finding, FindingKind } from "../types/report";

/** Group findings by kind, preserving each kind's first-appearance order in `findings` (stable — no
 *  alphabetical resort) and each finding's original relative order within its group. */
export function groupFindingsByKind(findings: Finding[]): [FindingKind, Finding[]][] {
  const order: FindingKind[] = [];
  const groups = new Map<FindingKind, Finding[]>();
  for (const f of findings) {
    let list = groups.get(f.kind);
    if (!list) {
      list = [];
      groups.set(f.kind, list);
      order.push(f.kind);
    }
    list.push(f);
  }
  return order.map((kind) => [kind, groups.get(kind)!]);
}
