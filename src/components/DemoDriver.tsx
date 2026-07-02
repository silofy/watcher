import { useEffect, useRef, useState } from "react";
import { useReport } from "../store/report";
import { assembleReport } from "../lib/pipeline/ingest";
import { DEMO_RAW, DEMO_SESSION, DEMO_GOLDEN } from "../lib/demo/playthrough";

/**
 * A watchable, self-driving demo of the LIVE debrief. On `?demo=live` it streams the scripted Forge
 * playthrough into the real store one command at a time — same path a captured session takes
 * (assembleReport → ingestLiveReport → finalizeLiveReport) — so you watch the report build itself:
 * the phase advances, stealth burns as the scanners run, flags land, then the run resolves into a
 * graded debrief and (a beat later) the "writeup loads" and the intended-path comparison unlocks.
 *
 * No box, no capture agent, no Tauri — it's the live-mode pipeline fed by a script. This doubles as a
 * validation harness for the live branch, which otherwise only runs against a real capture.
 */
const TICK_MS = 1500;
const GOLDEN_DELAY_MS = 2200; // after the run ends, "the writeup loads" and unlocks the comparison
const SESSION_ID = `htb:${DEMO_SESSION.uuid}`;
const TOTAL = DEMO_RAW.length;

type Phase = "idle" | "recording" | "resolved" | "compared";

export function DemoDriver() {
  const startedRef = useRef(false);
  const [n, setN] = useState(0);
  const [phase, setPhase] = useState<Phase>("idle");

  useEffect(() => {
    if (startedRef.current) return;
    if (new URLSearchParams(window.location.search).get("demo") !== "live") return;
    startedRef.current = true;

    const { ingestLiveReport, switchSession, applyGoldenDag } = useReport.getState();
    let step = 0;
    let goldenTimer: ReturnType<typeof setTimeout> | undefined;

    const advance = () => {
      step += 1;
      const live = step < TOTAL;
      // heartbeat: while live, ended_at = now so isLiveRecording() keeps the debrief in live mode
      const session = { ...DEMO_SESSION, ended_at: live ? new Date().toISOString() : DEMO_SESSION.ended_at };
      const base = assembleReport(DEMO_RAW.slice(0, step), { session, golden: [] });
      ingestLiveReport({ ...base, recording: live });
      if (step === 1) switchSession(SESSION_ID); // land on the debrief, viewing the live session

      setN(step);
      setPhase(live ? "recording" : "resolved");

      if (step >= TOTAL) {
        clearInterval(id);
        goldenTimer = setTimeout(() => {
          applyGoldenDag(DEMO_GOLDEN, { source: "0xdf", confidence: 0.92 });
          setPhase("compared");
        }, GOLDEN_DELAY_MS);
      }
    };

    const id = setInterval(advance, TICK_MS);
    advance(); // fire the first command immediately
    return () => {
      clearInterval(id);
      if (goldenTimer) clearTimeout(goldenTimer);
    };
  }, []);

  if (phase === "idle") return null;

  const recording = phase === "recording";
  const color = recording ? "var(--color-loud)" : "var(--color-match)";
  const text =
    phase === "recording"
      ? `Simulated live box · ${n}/${TOTAL}`
      : phase === "resolved"
        ? "Run finished · loading writeup…"
        : "Demo complete — graded debrief";

  return (
    <div
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs backdrop-blur"
      style={{
        color,
        borderColor: `color-mix(in oklch, ${color} 40%, transparent)`,
        backgroundColor: "color-mix(in oklch, var(--color-ink) 80%, transparent)",
      }}
    >
      <span className={recording ? "animate-pulse" : ""}>{recording ? "●" : "✓"}</span>
      <span className="font-medium">{text}</span>
      <span className="text-faint">Forge · demo</span>
    </div>
  );
}
