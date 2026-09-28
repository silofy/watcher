import { describe, it, expect } from "vitest";
import { detectCapture, reportFromCapture } from "./detect";

const har = JSON.stringify({
  log: { version: "1.2", entries: [{ startedDateTime: "2026-09-28T10:00:00.000Z", time: 50, request: { method: "GET", url: "https://t.htb/a" }, response: { status: 200 } }] },
});
const sysmon = JSON.stringify([{ EventID: 1, UtcTime: "2026-09-28 10:00:00.000", CommandLine: "whoami", Image: "whoami.exe" }]);
const transcript = [
  JSON.stringify({ timestamp: "2026-09-28T10:00:00.000Z", message: { content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "id" } }] } }),
  JSON.stringify({ timestamp: "2026-09-28T10:00:02.000Z", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "uid=0" }] } }),
].join("\n");

describe("detectCapture", () => {
  it("routes each format to the right adapter without cross-matching", () => {
    expect(detectCapture(har)?.kind).toBe("http-proxy");
    expect(detectCapture(sysmon)?.kind).toBe("sysmon");
    expect(detectCapture(transcript, "abducted.jsonl")?.kind).toBe("claude-code");
  });

  it("returns null for unrecognized input", () => {
    expect(detectCapture("")).toBeNull();
    expect(detectCapture("hello world")).toBeNull();
    expect(detectCapture(JSON.stringify({ nothing: true }))).toBeNull();
  });
});

describe("reportFromCapture", () => {
  it("assembles a valid report and stamps the source so the badge resolves", () => {
    const rep = reportFromCapture(transcript, "run.jsonl");
    expect(rep).not.toBeNull();
    expect(rep!.session.shell).toBe("claude-code");
    expect(rep!.session.source).toBe("plugin");
    expect(rep!.episodes.length).toBeGreaterThan(0);
    expect(rep!.session.target_scope).toContain("Claude Code");
  });

  it("returns null when nothing recognizes the input", () => {
    expect(reportFromCapture("not a capture")).toBeNull();
  });

  it("grades host imports against the methodology ladder, and skips it for web", () => {
    // host run (transcript) gets the 7-objective canonical ladder so coverage is meaningful
    expect(reportFromCapture(transcript, "run.jsonl")!.golden_dag?.length).toBe(7);
    // web run (HAR) has no host golden attached — its rubric is a follow-up
    expect(reportFromCapture(har)!.golden_dag?.length).toBe(4);
  });
});
