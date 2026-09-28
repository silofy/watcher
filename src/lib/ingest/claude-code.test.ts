import { describe, it, expect } from "vitest";
import { claudeCodeToRawCommands } from "./claude-code";

const line = (obj: unknown) => JSON.stringify(obj);

const TRANSCRIPT = [
  line({
    timestamp: "2026-09-28T10:00:00.000Z",
    message: {
      content: [{ type: "tool_use", name: "Bash", id: "t1", input: { command: "nmap -p- 10.10.10.10" } }],
    },
  }),
  line({
    timestamp: "2026-09-28T10:00:05.000Z",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "t1",
          is_error: false,
          content: "22/tcp open — ssh\npassword=hunter2\nline three",
        },
      ],
    },
  }),
  // a Read tool call — ignored in v1
  line({
    timestamp: "2026-09-28T10:00:20.000Z",
    message: { content: [{ type: "tool_use", name: "Read", id: "r1", input: { file_path: "/etc/passwd" } }] },
  }),
  // a Bash call with no matching result — dropped as incomplete
  line({
    timestamp: "2026-09-28T10:00:30.000Z",
    message: { content: [{ type: "tool_use", name: "Bash", id: "t2", input: { command: "whoami" } }] },
  }),
].join("\n");

describe("claudeCodeToRawCommands", () => {
  it("pairs a Bash call to its result with wall-clock timing, ignoring non-Bash and unpaired calls", () => {
    const raw = claudeCodeToRawCommands(TRANSCRIPT);
    expect(raw).toHaveLength(1);
    const r = raw[0];
    expect(r.cmd).toBe("nmap -p- 10.10.10.10");
    expect(r.ended_at_ms - r.started_at_ms).toBe(5000); // think-time + run duration, wall-clock
    expect(r.exit_code).toBe(0);
    expect(r.output_line_count).toBe(3);
  });

  it("scrubs credentials then strips AI-tell punctuation from the digest", () => {
    const r = claudeCodeToRawCommands(TRANSCRIPT)[0];
    expect(r.output_digest).not.toContain("—"); // em dash removed
    expect(r.output_digest).toContain("open - ssh"); // replaced with a hyphen
    expect(r.output_digest).toContain("password=[redacted]");
    expect(r.output_digest).not.toContain("hunter2");
  });

  it("returns an empty array for a transcript with no Bash activity", () => {
    expect(claudeCodeToRawCommands("")).toEqual([]);
    expect(claudeCodeToRawCommands("not json\n{}\n")).toEqual([]);
  });
});
