import { describe, it, expect } from "vitest";
import { coerce, buildPrompt, extractGoldenDag, goldenFromText } from "../src/lib/writeup";
import type { LlmProvider } from "../src/lib/llm/provider";
import { useReport } from "../src/store/report";

const provider = (json: unknown): LlmProvider => ({
  name: "fake",
  available: async () => true,
  generateJson: async () => json,
});

describe("writeup → golden DAG extraction", () => {
  it("coerces model output into clean, ordered objectives", () => {
    const g = coerce({
      objectives: [
        { objective: "Enumerate Web", tactic: "ta0007", satisfied_by: ["gobuster", "ffuf"] },
        { objective: "exploit upload", tactic: "TA0001", satisfied_by: ["burp"], depends_on: ["enumerate_web"] },
        { objective: "no methods", tactic: "TA0004", satisfied_by: [] }, // dropped
      ],
    });
    expect(g.map((o) => o.objective)).toEqual(["enumerate_web", "exploit_upload"]);
    expect(g[0].tactic).toBe("TA0007"); // normalized + validated
    expect(g[1].depends_on).toEqual(["enumerate_web"]); // references an earlier objective → kept
  });

  it("normalizes unknown tactics to execution and drops dangling depends_on", () => {
    const g = coerce([{ objective: "x", tactic: "nonsense", satisfied_by: ["a"], depends_on: ["ghost"] }]);
    expect(g[0].tactic).toBe("TA0002");
    expect(g[0].depends_on).toEqual([]);
  });

  it("returns [] when there is no model output (rules-only)", async () => {
    expect(await extractGoldenDag("a write-up", { name: "Box" }, provider(null))).toEqual([]);
  });

  it("goldenFromText yields source + confidence when objectives extract", async () => {
    const res = await goldenFromText("text", { name: "Box" }, provider({
      objectives: [
        { objective: "recon", tactic: "TA0007", satisfied_by: ["nmap"] },
        { objective: "root", tactic: "TA0004", satisfied_by: ["sudo"] },
      ],
    }));
    expect(res.golden).toHaveLength(2);
    expect(res.source).toBe("pasted");
    expect(res.confidence).toBeGreaterThan(0);
  });

  it("goldenFromText explains the no-model case instead of failing", async () => {
    const res = await goldenFromText("text", { name: "Box" }, provider(null));
    expect(res.golden).toEqual([]);
    expect(res.confidence).toBe(0);
    expect(res.note).toMatch(/model|Ollama/i);
  });

  it("buildPrompt names the box and clips long write-ups", () => {
    const p = buildPrompt("x".repeat(20000), { name: "Checkpoint", os: "Windows" });
    expect(p).toContain("Checkpoint");
    expect(p.length).toBeLessThan(16000);
  });
});

describe("applyGoldenDag re-aligns the active report (Layer 2)", () => {
  it("overlays a golden DAG, matches an episode, and lifts coverage", () => {
    const ep = useReport.getState().fullReport.episodes.find((e) => e.binary)!;
    useReport.getState().applyGoldenDag([{ objective: "obj", tactic: ep.tactic, satisfied_by: [ep.binary], depends_on: [] }], { source: "pasted", confidence: 0.7 });
    const st = useReport.getState();
    expect(st.writeup?.source).toBe("pasted");
    expect(st.fullReport.golden_dag).toHaveLength(1);
    expect(st.fullReport.golden_dag[0].user_satisfied_by_seq).not.toBeNull();
    expect(st.metrics.objective_coverage_pct).toBe(100);
  });
});
