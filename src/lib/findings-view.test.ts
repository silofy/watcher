import { describe, it, expect } from "vitest";
import { groupFindingsByKind } from "./findings-view";
import type { Finding, FindingKind } from "../types/report";

function f(id: string, kind: FindingKind, source_seq = 1): Finding {
  return { id, kind, value: id, source_seq };
}

describe("groupFindingsByKind", () => {
  it("groups findings by kind, preserving order within a group", () => {
    const findings = [f("a", "port"), f("b", "cred"), f("c", "port")];
    const groups = groupFindingsByKind(findings);
    expect(groups.map(([kind]) => kind)).toEqual(["port", "cred"]);
    expect(groups[0][1].map((x) => x.id)).toEqual(["a", "c"]);
    expect(groups[1][1].map((x) => x.id)).toEqual(["b"]);
  });

  it("orders groups by first appearance, not alphabetically, and stays stable across calls", () => {
    const findings = [f("x", "vuln"), f("y", "flag"), f("z", "vuln"), f("w", "host")];
    const order1 = groupFindingsByKind(findings).map(([kind]) => kind);
    const order2 = groupFindingsByKind(findings).map(([kind]) => kind);
    expect(order1).toEqual(["vuln", "flag", "host"]);
    expect(order2).toEqual(order1);
  });

  it("returns an empty array for no findings", () => {
    expect(groupFindingsByKind([])).toEqual([]);
  });
});
