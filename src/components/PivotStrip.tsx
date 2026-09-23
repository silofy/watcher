import { useId, useMemo, useRef, useState } from "react";
import type { GhostItem } from "../types/report";
import { humanizeObjective } from "../lib/audits";
import { VERDICT, ghostDetail } from "../lib/ghost/headline";
import { DitherPattern } from "./dither";
import { Tag } from "./ui";
import { useWidth } from "./useWidth";

const RH = 26; // row height: room for the staircase to read
const LBL = 200; // label column
const TOP = 24; // step axis
const TIP_W = 300;

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * You vs. the Ghost as one picture: a row per objective on a step axis. A late pivot is a ring where
 * it unlocked, a coral dithered span, and a tick where you acted, so a run of them reads as a
 * staircase. Drawn 1:1 in px (no viewBox scaling) so the dither dots stay 2px.
 */
export function PivotStrip({ items, total, notes, onReveal }: { items: GhostItem[]; total: number; notes: Map<string, string>; onReveal: (seq: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const W = useWidth(ref, 720);
  const uid = useId().replace(/:/g, "");
  const [hot, setHot] = useState<number | null>(null);
  const rows = useMemo(() => [...items].sort((a, b) => (a.actual_seq ?? 1e9) - (b.actual_seq ?? 1e9) || (a.unlock_seq ?? 0) - (b.unlock_seq ?? 0)), [items]);
  const span = Math.max(1, total);
  const x = (s: number) => LBL + ((s - 0.5) / span) * (W - LBL - 10);
  const H = TOP + rows.length * RH + 4;
  const ticks = Array.from({ length: span }, (_, i) => i + 1).filter((t) => t === 1 || t % 5 === 0);
  const lateId = `${uid}-late`;
  const skipId = `${uid}-skip`;

  const it = hot == null ? null : rows[hot];
  let tip: { left: number; top: number } | null = null;
  if (it && hot != null) {
    const end = it.actual_seq != null ? x(it.actual_seq) : x(span);
    const fits = end + 14 + TIP_W <= W;
    tip = { left: fits ? end + 14 : Math.max(LBL, end - 14 - TIP_W), top: TOP + hot * RH + RH / 2 };
  }

  return (
    <div ref={ref} className="relative">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block overflow-visible" role="list" aria-label="Objectives against the optimal line">
        <defs>
          <DitherPattern id={lateId} color="var(--color-loud)" />
          <DitherPattern id={skipId} color="var(--color-skipped)" density={0.3} />
        </defs>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={TOP - 6} y2={H} stroke="var(--color-edge)" />
            <text x={x(t)} y={TOP - 10} textAnchor="middle" fontSize={10.5} fill="var(--color-faint)" className="mono">
              {t}
            </text>
          </g>
        ))}
        <text x={0} y={TOP - 10} fontSize={10.5} letterSpacing="0.12em" fill="var(--color-faint)" className="mono">
          OBJECTIVE · STEP →
        </text>
        {rows.map((r, i) => {
          const y = TOP + i * RH;
          const cy = y + RH / 2;
          const v = VERDICT[r.verdict];
          const on = hot === i;
          const can = r.actual_seq != null;
          return (
            <g
              key={r.objective}
              role="listitem"
              tabIndex={0}
              aria-label={`${humanizeObjective(r.objective)}: ${v.label}. ${ghostDetail(r)}`}
              className={`outline-none ${can ? "cursor-pointer" : ""}`}
              onMouseEnter={() => setHot(i)}
              onMouseLeave={() => setHot(null)}
              onFocus={() => setHot(i)}
              onBlur={() => setHot(null)}
              onClick={() => can && onReveal(r.actual_seq!)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && can) onReveal(r.actual_seq!);
              }}
            >
              <rect x={-10} y={y + 1} width={W + 10} height={RH - 2} fill={on ? "var(--color-panel-2)" : "transparent"} />
              {on && <rect x={-10} y={y + 1} width={2} height={RH - 2} fill={v.color} />}
              <text x={0} y={cy + 4} fontSize={13} fill={r.verdict === "late_pivot" ? "var(--color-fg)" : "var(--color-muted)"}>
                {truncate(humanizeObjective(r.objective), 26)}
              </text>
              <Marks r={r} cy={cy} x={x} end={span} lateFill={`url(#${lateId})`} skipFill={`url(#${skipId})`} />
            </g>
          );
        })}
      </svg>
      {it && tip && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 w-[300px] -translate-y-1/2 rounded-[3px] border border-edge-bright bg-panel-2 px-[13px] py-[11px] shadow-[0_10px_30px_rgba(0,0,0,.55)]"
          style={{ left: tip.left, top: tip.top }}
        >
          <Tag color={VERDICT[it.verdict].color}>{VERDICT[it.verdict].label}</Tag>
          <b className="mt-2 block text-[15px] font-semibold leading-tight text-fg">{humanizeObjective(it.objective)}</b>
          <p className="mt-1 text-[13px] leading-snug text-muted">{notes.get(it.objective) ?? ghostDetail(it)}</p>
          {it.actual_seq != null && <span className="mt-[9px] block font-mono text-[10px] uppercase tracking-[0.14em] text-signal">Click to replay step {it.actual_seq}</span>}
        </div>
      )}
    </div>
  );
}

function Marks({ r, cy, x, end, lateFill, skipFill }: { r: GhostItem; cy: number; x: (s: number) => number; end: number; lateFill: string; skipFill: string }) {
  const u = r.unlock_seq ?? null;
  const a = r.actual_seq ?? null;
  const ring = (at: number) => <circle cx={x(at)} cy={cy} r={4} fill="var(--color-ink)" stroke="var(--color-muted)" strokeWidth={1.2} />;
  if (r.verdict === "late_pivot" && u != null && a != null) {
    return (
      <>
        <rect x={x(u)} y={cy - 5} width={Math.max(2, x(a) - x(u))} height={10} fill={lateFill} />
        {ring(u)}
        <rect x={x(a) - 1.5} y={cy - 8} width={3} height={16} fill="var(--color-loud)" />
      </>
    );
  }
  if (r.verdict === "skipped") {
    const u0 = u ?? 1;
    return (
      <>
        <rect x={x(u0)} y={cy - 5} width={Math.max(2, x(end) - x(u0))} height={10} fill={skipFill} />
        {ring(u0)}
        <text x={x(end) + 4} y={cy + 4} fontSize={13} fill="var(--color-skipped)">
          ×
        </text>
      </>
    );
  }
  if (a == null) return null;
  const c = VERDICT[r.verdict].color;
  return (
    <>
      <rect x={x(a) - 1.5} y={cy - 8} width={3} height={16} fill={c} />
      {(r.verdict === "ahead" || r.verdict === "off_path_win") && <circle cx={x(a)} cy={cy} r={4} fill={c} />}
    </>
  );
}
