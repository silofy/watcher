/**
 * AI-tell gate: model-generated prose must never reach the user with the
 * punctuation the humanize guidance forbids. Even when a provider returns em
 * dashes, the deterministic stripAiTells() backstop in the narrate steps must
 * scrub them. If this fails, generated prose regressed to reading like AI.
 */
import { describe, it, expect } from "vitest";
import type { LlmProvider } from "./provider";
import { HUMANIZE_STYLE } from "./style";
import { narrateReport } from "../report/narrate";
import { narrateGhost } from "../ghost/narrate";
import type { GhostResult } from "../ghost/ghost";
import type { WatcherReport } from "../../types/report";

const EM = "—";
const hasTell = (s: string) => /[‒–—―]/.test(s);

/** A provider that deliberately returns em-dash-laden prose for both surfaces. */
const sloppyProvider: LlmProvider = {
  name: "sloppy-stub",
  async available() {
    return true;
  },
  async generateJson(prompt: string) {
    if (prompt.includes("Objectives:")) {
      // ghost/narrate shape
      return { notes: [{ objective: "escalate_to_root", note: `You pivoted late ${EM} act sooner next run.` }] };
    }
    // report/narrate shape
    return {
      summary: `The run rooted the box ${EM} a clean compromise.`,
      descriptions: { "cve-2026-4480": `Command injection ${EM} full RCE as the service account.` },
    };
  },
};

describe("AI-tell gate", () => {
  it("the shared humanize style forbids em dashes", () => {
    expect(HUMANIZE_STYLE.toLowerCase()).toContain("no em dashes");
  });

  it("narrateReport strips em dashes the model emitted", async () => {
    const report = {
      session: { target: { name: "Box" } },
      findings: [],
      episodes: [],
      golden_dag: [],
    } as unknown as WatcherReport;
    const { findings, summary } = await narrateReport(report, sloppyProvider);
    if (summary) expect(hasTell(summary)).toBe(false);
    for (const f of findings) expect(hasTell(f.description)).toBe(false);
  });

  it("narrateGhost strips em dashes the model emitted", async () => {
    const result: GhostResult = {
      items: [{ objective: "escalate_to_root", verdict: "late_pivot", unlock_seq: 11, actual_seq: 16, lag_ms: 480000, note: "late" }],
    } as unknown as GhostResult;
    const out = await narrateGhost(result, sloppyProvider);
    for (const it of out.items) expect(hasTell(it.note)).toBe(false);
  });
});
