import { describe, it, expect } from "vitest";
import { refineCoaching, buildCoachPrompt, type CoachStep } from "../src/lib/llm/coach";
import type { LlmProvider } from "../src/lib/llm/provider";
import type { WatcherReport } from "../src/types/report";

const provider = (json: unknown): LlmProvider => ({ name: "fake", available: async () => true, generateJson: async () => json });
const report = { session: { machine: { name: "Uploadr" }, target_scope: "Uploadr" } } as unknown as WatcherReport;
const steps: CoachStep[] = [{ seq: 12, cmd: "curl -F file=@shell.php", output: "rejected: .php blocked", kind: "dead-end", intended: "bypass upload filter" }];

describe("refineCoaching", () => {
  it("maps the model's suggestions by step seq", async () => {
    const m = await refineCoaching(report, steps, provider({ coaching: [{ seq: 12, suggestion: "Try a .phtml extension to slip past the filter." }] }));
    expect(m.get(12)).toMatch(/phtml/);
  });

  it("returns empty with no model output, so the rules-based coaching stands", async () => {
    expect((await refineCoaching(report, steps, provider(null))).size).toBe(0);
  });

  it("ignores malformed / empty entries", async () => {
    const m = await refineCoaching(report, steps, provider({ coaching: [{ seq: "x", suggestion: "y" }, { seq: 12, suggestion: "  " }] }));
    expect(m.size).toBe(0);
  });

  it("returns empty for no steps", async () => {
    expect((await refineCoaching(report, [], provider({ coaching: [{ seq: 1, suggestion: "z" }] }))).size).toBe(0);
  });

  it("buildCoachPrompt names the machine and the step", () => {
    const p = buildCoachPrompt("Uploadr", steps);
    expect(p).toContain("Uploadr");
    expect(p).toContain("#12");
  });
});
