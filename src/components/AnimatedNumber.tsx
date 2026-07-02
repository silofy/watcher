import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

/**
 * A number that eases to its target instead of snapping — so live readouts (stealth, time lost) tick
 * up as telemetry lands, and static readouts count in on reveal. Uses rAF, eases with easeOutCubic,
 * and honors prefers-reduced-motion by jumping straight to the value.
 */
export function AnimatedNumber({
  value,
  round = true,
  duration = 480,
  className,
  style,
}: {
  value: number;
  round?: boolean;
  duration?: number;
  className?: string;
  style?: CSSProperties;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef(0);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;
    if (reduce || from === value) {
      fromRef.current = value;
      setDisplay(value);
      return;
    }
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const e = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(from + (value - from) * e);
      if (t < 1) rafRef.current = requestAnimationFrame(tick);
      else fromRef.current = value;
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, duration]);

  return (
    <span className={className} style={style}>
      {round ? Math.round(display) : display}
    </span>
  );
}
