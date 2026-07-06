import { describe, it, expect } from "vitest";
import { segmentEpisodes } from "./segment";
import type { RawCommand } from "./types";

const base = 1_000_000;

const stream: RawCommand[] = [
  // 60s nmap scan, lots of nothing else
  { cmd: "nmap -sV 10.10.10.5", started_at_ms: base, ended_at_ms: base + 60_000, exit_code: 0, output_line_count: 40, output_digest: "22,80 open" },
  // quick manual curl, 30s think before it
  { cmd: "curl -s http://10.10.10.5/", started_at_ms: base + 90_000, ended_at_ms: base + 91_000, exit_code: 0, output_line_count: 12, output_digest: "landing page" },
  // 6-minute pause, then sudo -l
  { cmd: "sudo -l", started_at_ms: base + 451_000, ended_at_ms: base + 451_500, exit_code: 0, output_line_count: 3, output_digest: "(ALL) NOPASSWD: /usr/bin/find" },
];

describe("segmentEpisodes (§4.1)", () => {
  const eps = segmentEpisodes(stream);

  it("splits the long pause into its own think_pause episode", () => {
    // nmap, curl, [think_pause], sudo
    expect(eps).toHaveLength(4);
    const pause = eps[2];
    expect(pause.actor).toBe("think_pause");
    expect(pause.gap_before_ms).toBe(360_000);
    expect(pause.duration_ms).toBe(0);
    expect(pause.cmd).toBe("");
  });

  it("moves the gap onto the think_pause, leaving the command's gap at 0", () => {
    const sudo = eps[3];
    expect(sudo.cmd).toBe("sudo -l");
    expect(sudo.gap_before_ms).toBe(0);
  });

  it("stamps the think_pause with the start of the command it precedes", () => {
    // so on the real-time axis the pause fills [prevEnd, nextStart] instead of collapsing at prevEnd
    expect(eps[2].actor).toBe("think_pause");
    expect(eps[2].started_at_ms).toBe(base + 451_000); // == sudo's start
  });

  it("tags a long scanning command machine_bound and a quick command human_active", () => {
    expect(eps[0]).toMatchObject({ binary: "nmap", actor: "machine_bound", tactic: "TA0007" });
    expect(eps[1]).toMatchObject({ binary: "curl", actor: "human_active" });
  });

  it("carries the MITRE prior through to the episode", () => {
    expect(eps[3]).toMatchObject({ binary: "sudo", tactic: "TA0004", technique: "T1548" });
  });

  it("re-sequences episodes from 1", () => {
    expect(eps.map((e) => e.seq)).toEqual([1, 2, 3, 4]);
  });

  it("treats a very long gap as idle, not think_pause", () => {
    const idleStream: RawCommand[] = [
      { cmd: "id", started_at_ms: base, ended_at_ms: base + 500, exit_code: 0, output_line_count: 1 },
      { cmd: "ls", started_at_ms: base + 2_400_000, ended_at_ms: base + 2_400_500, exit_code: 0, output_line_count: 5 },
    ];
    const r = segmentEpisodes(idleStream);
    expect(r[1].actor).toBe("idle");
  });
});

describe("segmentEpisodes — web exchanges (Task 6)", () => {
  it("classifies a web exchange episode with CWE", () => {
    const eps = segmentEpisodes([{
      cmd: "GET /item?id=1'", started_at_ms: 0, ended_at_ms: 50, exit_code: null,
      output_line_count: 0, context_path: "web:burp",
      web: { method: "GET", url: "http://t/item?id=1'", status: 500, resp_body: "SQL syntax error" },
    }]);
    expect(eps[0].technique).toBe("T1190");
    expect(eps[0].frameworks?.cwe).toContain("CWE-89");
  });

  it("classifies a reflected-XSS web exchange episode with CWE-79", () => {
    const eps = segmentEpisodes([{
      cmd: "GET /search?q=<script>alert(1)</script>", started_at_ms: 0, ended_at_ms: 50, exit_code: null,
      output_line_count: 0, context_path: "web:burp",
      web: {
        method: "GET",
        url: "http://t/s?q=<script>alert(1)</script>",
        resp_body: "<script>alert(1)</script>",
      },
    }]);
    expect(eps[0].frameworks?.cwe).toContain("CWE-79");
  });
});

describe("segmentEpisodes — lanes (host vs on-target)", () => {
  // Enumerate on the host, then 6.5 min later drop into an ssh shell and run `id`. The gap is
  // host-side think-time, not a pause before the *first* on-target command — lanes are independent.
  const mixed: RawCommand[] = [
    { cmd: "gobuster dir -u http://10.10.10.5", started_at_ms: base, ended_at_ms: base + 30_000, exit_code: 0, output_line_count: 4000, context_path: "host" },
    { cmd: "id", started_at_ms: base + 420_000, ended_at_ms: base + 420_500, exit_code: 0, output_line_count: 1, context_path: "ssh:10.10.10.5" },
  ];
  const eps = segmentEpisodes(mixed);

  it("does not fabricate a think_pause from a cross-lane jump", () => {
    expect(eps.map((e) => e.cmd)).toEqual(["gobuster dir -u http://10.10.10.5", "id"]);
  });

  it("carries absolute started_at_ms onto episodes so lanes can be merge-positioned", () => {
    expect(eps[0].started_at_ms).toBe(base);
    expect(eps[1].started_at_ms).toBe(base + 420_000);
  });
});
