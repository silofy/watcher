import { describe, it, expect } from "vitest";
import type { Finding, Target } from "./report";

describe("v1.2 types", () => {
  it("Target and Finding are constructible", () => {
    const t: Target = { platform: "thm", kind: "room", name: "Blue" };
    const f: Finding = { id: "port:445-tcp", kind: "port", value: "445/tcp", source_seq: 0 };
    expect(t.platform).toBe("thm");
    expect(f.kind).toBe("port");
  });
});
