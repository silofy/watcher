import { useEffect, useRef } from "react";
import { useReport } from "../store/report";

/**
 * The live-demo surface. The streaming itself lives in the store (startLiveDemo) so it can be launched
 * two ways: automatically on `?demo=live`, or by opening the "Forge" card in History. This component
 * just kicks off the URL case and renders the floating progress pill from store state.
 */
export function DemoDriver() {
  const demo = useReport((s) => s.demo);
  const startLiveDemo = useReport((s) => s.startLiveDemo);
  const auto = useRef(false);

  useEffect(() => {
    if (auto.current) return;
    auto.current = true;
    if (new URLSearchParams(window.location.search).get("demo") === "live") startLiveDemo();
  }, [startLiveDemo]);

  if (!demo) return null;

  const recording = demo.phase === "recording";
  const color = recording ? "var(--color-loud)" : "var(--color-match)";
  const text =
    demo.phase === "recording"
      ? `Simulated live box · ${demo.n}/${demo.total}`
      : demo.phase === "resolved"
        ? "Run finished · loading writeup…"
        : "Demo complete — graded debrief";

  return (
    <div
      data-demo-pill
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
