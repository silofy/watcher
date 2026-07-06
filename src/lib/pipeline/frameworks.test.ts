import { describe, it, expect } from "vitest";
import {
  UKC_ORDER,
  ukcRank,
  ukcOf,
  cweOf,
  cweLabel,
  ukcLabel,
  deriveFrameworks,
  enrichFrameworks,
  ukcCoverage,
  ukcProgression,
  weaknessBreadth,
  runWeaknesses,
  reachedUkcPhases,
} from "./frameworks";
import type { Episode } from "../../types/report";

// minimal episode factory — only the fields the framework derivation reads
const ep = (tactic: string, binary = "", seq = 0): Episode => ({
  seq,
  cmd: binary,
  binary,
  duration_ms: 0,
  gap_before_ms: 0,
  actor: "human_active",
  tactic,
});

describe("UKC mapping", () => {
  it("keeps reconnaissance first and objectives last", () => {
    expect(ukcRank("reconnaissance")).toBe(0);
    expect(ukcRank("objectives")).toBe(UKC_ORDER.length - 1);
  });

  it("maps the opening scan tactic (TA0007) to reconnaissance, not late discovery", () => {
    expect(ukcOf(ep("TA0007"))).toBe("reconnaissance");
    expect(ukcRank(ukcOf(ep("TA0007"))!)).toBeLessThan(ukcRank(ukcOf(ep("TA0001"))!));
  });

  it("returns undefined for an unmapped tactic", () => {
    expect(ukcOf(ep("TA9999"))).toBeUndefined();
  });
});

describe("CWE mapping", () => {
  it("maps sqlmap to SQL injection and brute-forcers to CWE-307", () => {
    expect(cweOf(ep("TA0001", "sqlmap"))).toEqual(["CWE-89"]);
    expect(cweOf(ep("TA0001", "hydra"))).toEqual(["CWE-307"]);
  });

  it("covers the expanded injection/deserialization/cred tooling", () => {
    expect(cweOf(ep("TA0001", "commix"))).toEqual(["CWE-78"]);
    expect(cweOf(ep("TA0001", "tplmap"))).toEqual(["CWE-1336"]);
    expect(cweOf(ep("TA0001", "ysoserial"))).toEqual(["CWE-502"]);
    expect(cweOf(ep("TA0001", "ssrfmap"))).toEqual(["CWE-918"]);
    expect(cweOf(ep("TA0006", "hashcat"))).toEqual(["CWE-521"]);
  });

  it("maps enumeration tooling to no weakness (honest empty, not a guess)", () => {
    expect(cweOf(ep("TA0007", "gobuster"))).toEqual([]);
    expect(cweOf(ep("TA0007", "nmap"))).toEqual([]);
  });

  it("labels CWE ids and UKC phases for display, with a graceful fallback", () => {
    expect(cweLabel("CWE-89")).toBe("CWE-89 · SQL injection");
    expect(cweLabel("CWE-99999")).toBe("CWE-99999");
    expect(ukcLabel("command-and-control")).toBe("Command and control");
  });
});

describe("deriveFrameworks / enrichFrameworks", () => {
  it("omits empty blocks and stamps populated ones", () => {
    expect(deriveFrameworks(ep("TA9999", "unknown"))).toBeUndefined();
    expect(deriveFrameworks(ep("TA0001", "sqlmap"))).toEqual({ ukc: "exploitation", cwe: ["CWE-89"] });
  });

  it("enriches without mutating the input episodes", () => {
    const eps = [ep("TA0001", "sqlmap")];
    const out = enrichFrameworks(eps);
    expect(out[0].frameworks).toEqual({ ukc: "exploitation", cwe: ["CWE-89"] });
    expect(eps[0].frameworks).toBeUndefined();
  });

  it("preserves a pre-set cwe (e.g. from web-exchange segmentation) instead of overwriting it with the binary-derived one", () => {
    // binary "curl" implies no CWE of its own, so a naive re-derive would wipe the
    // web prior's CWE-89 the moment it merges in the tactic's UKC phase.
    const webEp: Episode = { ...ep("TA0001", "curl"), frameworks: { cwe: ["CWE-89"] } };
    const out = enrichFrameworks([webEp]);
    expect(out[0].frameworks).toEqual({ ukc: "exploitation", cwe: ["CWE-89"] });
  });
});

describe("ukcCoverage", () => {
  it("is the share of required UKC phases the run reached", () => {
    const eps = [ep("TA0007"), ep("TA0001")]; // recon + exploitation reached
    const golden = ["TA0007", "TA0001", "TA0004"]; // recon + exploitation + privesc required
    expect(ukcCoverage(eps, golden)).toBeCloseTo((2 / 3) * 100);
  });

  it("is 0 when there is no reference path (active box)", () => {
    expect(ukcCoverage([ep("TA0001")], [])).toBe(0);
  });
});

describe("ukcProgression", () => {
  it("is 100 for a clean in-order run", () => {
    expect(ukcProgression([ep("TA0007"), ep("TA0001"), ep("TA0004")])).toBe(100);
  });

  it("drops when the operator backtracks to an earlier phase", () => {
    // recon → privesc → recon: one of two transitions moves backward
    expect(ukcProgression([ep("TA0007"), ep("TA0004"), ep("TA0007")])).toBeCloseTo(50);
  });

  it("is 100 when there is nothing to compare", () => {
    expect(ukcProgression([ep("TA0001")])).toBe(100);
  });
});

describe("weaknessBreadth / runWeaknesses", () => {
  it("counts distinct CWE classes, not repeated ones", () => {
    const eps = [ep("TA0001", "sqlmap"), ep("TA0001", "sqlmap"), ep("TA0001", "hydra")];
    expect(weaknessBreadth(eps)).toBe(2); // CWE-89 + CWE-307
  });

  it("lists distinct CWE ids in first-seen order", () => {
    const eps = [ep("TA0001", "hydra"), ep("TA0001", "sqlmap"), ep("TA0001", "hydra")];
    expect(runWeaknesses(eps)).toEqual(["CWE-307", "CWE-89"]);
  });
});

describe("reachedUkcPhases", () => {
  it("collects the distinct UKC phases a run touched", () => {
    const phases = reachedUkcPhases([ep("TA0007"), ep("TA0001"), ep("TA0004"), ep("TA9999")]);
    expect([...phases].sort()).toEqual(["exploitation", "privilege-escalation", "reconnaissance"]);
  });
});
