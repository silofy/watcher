import { useEffect, useRef } from "react";
import { asciiChar, asciiField } from "../lib/ascii";

const CELL = 14;
const FRAME_MS = 38; // ~26fps is plenty for a drifting texture

/** Decorative ASCII texture on a canvas: paused off-screen, one static frame under reduced motion. */
export function AsciiField({ mask, alpha = 0.3, className = "" }: { mask: (nx: number, ny: number) => number; alpha?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const t0 = performance.now();
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = 0;
    let visible = true;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      W = r.width;
      H = r.height;
      canvas.width = Math.floor(W * dpr);
      canvas.height = Math.floor(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.font = '12px "Spline Sans Mono Variable", ui-monospace, monospace';
      ctx.textBaseline = "top";
    };
    const draw = (now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        const t = ((now - t0) / 1000) * 0.45;
        ctx.clearRect(0, 0, W, H);
        for (let j = 0; j * CELL < H; j++) {
          for (let i = 0; i * CELL < W; i++) {
            const nx = (i * CELL) / W;
            const ny = (j * CELL) / H;
            const m = mask(nx, ny);
            if (m <= 0) continue;
            const v = asciiField(nx, ny, t);
            const a = v * m;
            if (a < 0.05) continue;
            const ch = asciiChar(v);
            if (ch === " ") continue;
            const al = Math.min(alpha, a * 0.5);
            ctx.fillStyle = v > 0.8 ? `rgba(47,230,176,${al})` : `rgba(237,237,238,${al * 0.5})`;
            ctx.fillText(ch, i * CELL, j * CELL);
          }
        }
      }
      if (!reduce && visible) raf = requestAnimationFrame(draw);
    };

    resize();
    const ro = new ResizeObserver(() => {
      resize();
      if (reduce) draw(performance.now() + FRAME_MS);
    });
    ro.observe(canvas);
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible && !reduce) {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(draw);
      }
    });
    io.observe(canvas);
    raf = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, [mask, alpha]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute ${className}`} />;
}
