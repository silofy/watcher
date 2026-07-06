import { describe, it, expect } from "vitest";
import fixture from "../../fixtures/session-htb-easy.json";
import type { Episode, WatcherReport } from "../types/report";
import {
  buildTimeline,
  makeTimeScale,
  phaseWindows,
  episodeColor,
  episodeLane,
  isWebEpisode,
  httpParts,
  ACTOR_COLORS,
  DETOUR_COLOR,
} from "./scale";

const report = fixture as unknown as WatcherReport;

const mk = (over: Partial<Episode>): Episode => ({
  seq: 0,
  cmd: "x",
  binary: "x",
  duration_ms: 0,
  gap_before_ms: 0,
  actor: "human_active",
  tactic: "TA0007",
  ...over,
});

describe("buildTimeline (the shared axis)", () => {
  it("places each episode after its gap, then its duration", () => {
    const tl = buildTimeline([
      mk({ seq: 1, gap_before_ms: 1000, duration_ms: 5000 }),
      mk({ seq: 2, gap_before_ms: 2000, duration_ms: 3000 }),
    ]);
    expect(tl.items[0]).toMatchObject({ gapStart: 0, t0: 1000, t1: 6000 });
    expect(tl.items[1]).toMatchObject({ gapStart: 6000, t0: 8000, t1: 11000 });
    expect(tl.totalMs).toBe(11000);
  });

  it("totalMs equals the sum of every gap and duration", () => {
    const tl = buildTimeline(report.episodes);
    const sum = report.episodes.reduce((a, e) => a + e.gap_before_ms + e.duration_ms, 0);
    expect(tl.totalMs).toBe(sum);
  });

  it("is monotonic and sorts by seq", () => {
    const tl = buildTimeline([...report.episodes].reverse());
    for (let i = 1; i < tl.items.length; i++) {
      expect(tl.items[i].t0).toBeGreaterThanOrEqual(tl.items[i - 1].t0);
      expect(tl.items[i].ep.seq).toBeGreaterThan(tl.items[i - 1].ep.seq);
    }
  });

  it("indexes by seq for cross-highlighting", () => {
    const tl = buildTimeline(report.episodes);
    expect(tl.bySeq.get(28)?.ep.binary).toBe("sudo");
  });
});

describe("buildTimeline — real wall-clock axis (fused lanes)", () => {
  it("positions episodes by started_at_ms so concurrent lanes overlap", () => {
    const base = 1_000_000;
    const tl = buildTimeline([
      mk({ seq: 1, started_at_ms: base, duration_ms: 60_000 }), // host: [0, 60s]
      mk({ seq: 2, started_at_ms: base + 10_000, duration_ms: 5_000 }), // target: starts 10s in
    ]);
    expect(tl.bySeq.get(1)).toMatchObject({ t0: 0, t1: 60_000 });
    expect(tl.bySeq.get(2)!.t0).toBe(10_000);
    expect(tl.bySeq.get(2)!.t0).toBeLessThan(tl.bySeq.get(1)!.t1); // overlap, not serialized
    expect(tl.totalMs).toBe(60_000);
  });

  it("spans a think_pause across the gap it represents", () => {
    const tl = buildTimeline([
      mk({ seq: 1, started_at_ms: 0, duration_ms: 10_000 }), // [0, 10s]
      mk({ seq: 2, started_at_ms: 400_000, duration_ms: 0, gap_before_ms: 390_000, actor: "think_pause", cmd: "" }),
      mk({ seq: 3, started_at_ms: 400_000, duration_ms: 500 }),
    ]);
    const pause = tl.bySeq.get(2)!;
    expect(pause.gapStart).toBe(10_000); // gap opens where #1 ended
    expect(pause.t1).toBe(400_000); // and closes where #3 starts
  });
});

describe("episodeLane", () => {
  it("routes ssh-tapped episodes to the target lane, everything else to host", () => {
    expect(episodeLane(mk({ context_path: "ssh:10.10.10.5" }))).toBe("target");
    expect(episodeLane(mk({ context_path: "host" }))).toBe("host");
    expect(episodeLane(mk({}))).toBe("host");
  });
});

describe("makeTimeScale", () => {
  it("maps the ms domain onto a pixel range", () => {
    const s = makeTimeScale(10000, 0, 100);
    expect(s(0)).toBe(0);
    expect(s(5000)).toBe(50);
    expect(s(10000)).toBe(100);
  });
});

describe("phaseWindows", () => {
  it("covers every phase and stays within the session", () => {
    const tl = buildTimeline(report.episodes);
    const windows = phaseWindows(tl, report.phases);
    expect(windows).toHaveLength(report.phases.length);
    for (const w of windows) {
      expect(w.t1).toBeGreaterThan(w.t0);
      expect(w.t1).toBeLessThanOrEqual(tl.totalMs);
    }
  });
});

describe("isWebEpisode (--web capture, brief §8)", () => {
  it("flags episodes tagged web:burp by the ingest pipeline", () => {
    expect(isWebEpisode(mk({ context_path: "web:burp", cmd: "id" }))).toBe(true);
  });
  it("leaves ordinary shell episodes alone", () => {
    expect(isWebEpisode(mk({ cmd: "nmap -sV 10.10.10.5" }))).toBe(false);
    expect(isWebEpisode(mk({ context_path: "host", cmd: "id" }))).toBe(false);
  });
  it("does not misclassify a 'head' command as a web episode", () => {
    expect(isWebEpisode(mk({ cmd: "head -n 20 /etc/passwd", context_path: "host" }))).toBe(false);
    expect(isWebEpisode(mk({ cmd: "PUT the file back", context_path: undefined }))).toBe(false);
  });
  it("classifies a web:burp episode as web regardless of cmd", () => {
    expect(isWebEpisode(mk({ cmd: "GET /admin", context_path: "web:burp" }))).toBe(true);
  });
});

describe("command tally excludes web episodes (LiveDashboard's `cmds` filter)", () => {
  // web episodes carry `binary` "GET"/"POST" (an HTTP method, not a shell command) — the
  // `e.binary && !isWebEpisode(e)` filter LiveDashboard/IdentityBar use for the "N cmds" tally
  // and the newest-command feed must exclude them so web traffic never inflates the count.
  const episodes: Episode[] = [
    mk({ seq: 1, binary: "nmap", context_path: "host" }),
    mk({ seq: 2, binary: "GET", cmd: "GET /login", context_path: "web:burp" }),
    mk({ seq: 3, binary: "POST", cmd: "POST /submit", context_path: "web:burp" }),
    mk({ seq: 4, binary: "", cmd: "", actor: "think_pause" }), // no binary — a pause, not a command
    mk({ seq: 5, binary: "sudo", context_path: "host" }),
  ];

  it("counts only real shell commands, not web exchanges", () => {
    const cmds = episodes.filter((e) => e.binary && !isWebEpisode(e));
    expect(cmds).toHaveLength(2);
    expect(cmds.map((e) => e.binary)).toEqual(["nmap", "sudo"]);
  });
});

describe("httpParts", () => {
  it("splits a request-line cmd into method and path", () => {
    expect(httpParts("GET /login?x=1")).toEqual({ method: "GET", path: "/login?x=1" });
    expect(httpParts("POST /api/users")).toEqual({ method: "POST", path: "/api/users" });
  });
  it("defaults to GET when no method prefix is present", () => {
    expect(httpParts("/login")).toEqual({ method: "GET", path: "/login" });
  });
});

describe("episodeColor (one color vocabulary)", () => {
  it("colors by actor mode", () => {
    expect(episodeColor(mk({ actor: "machine_bound" }))).toBe(ACTOR_COLORS.machine_bound);
    expect(episodeColor(mk({ actor: "think_pause" }))).toBe(ACTOR_COLORS.think_pause);
  });
  it("lets a detour override the actor color (it is the thing to see)", () => {
    expect(episodeColor(mk({ actor: "machine_bound", alignment: "detour" }))).toBe(DETOUR_COLOR);
  });
});
