import type { CSSProperties, ReactNode } from "react";
import { ACTOR_COLORS, ACTOR_LABELS, DETOUR_COLOR } from "../lib/scale";
import type { ActorMode } from "../types/report";

/**
 * A flat console section — a stenciled label over a hairline rule, content flush on the ground. No
 * card border/bg (the Antimetal "ledger" feel); pass `boxed` only where grouping truly needs a box.
 */
export function Section({
  title,
  subtitle,
  right,
  children,
  className = "",
  boxed = false,
  i,
  collapsible = false,
  name,
  defaultOpen = false,
  srTitle = false,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  boxed?: boolean;
  i?: number;
  /** Render as a collapsed-by-default disclosure; the header becomes the click target. */
  collapsible?: boolean;
  /** Shared name → only one `<details>` in the group stays open at a time (native accordion). */
  name?: string;
  defaultOpen?: boolean;
  /** Keep the title in the markup (static export, screen readers) but visually hidden — for a section
   *  hosted under a tab/label that already shows the same heading (e.g. the Deep dive tabs), so the
   *  title isn't printed twice. Subtitle/right (often the section's only unique context) stay visible. */
  srTitle?: boolean;
}) {
  const titleEl = title && <h2 className={`font-display text-sm font-semibold uppercase tracking-[0.13em] text-muted ${srTitle ? "sr-only" : ""}`}>{title}</h2>;
  const subEl = subtitle && <span className="text-xs text-faint">{subtitle}</span>;
  const rightEl = right && <div className="text-xs text-muted">{right}</div>;

  if (collapsible) {
    return (
      <details
        name={name}
        open={defaultOpen}
        className={`group/sec relative ${i != null ? "rise" : ""} ${className}`}
        style={i != null ? ({ "--i": i } as CSSProperties) : undefined}
      >
        <summary className="flex cursor-pointer list-none items-baseline justify-between gap-4 py-1 [&::-webkit-details-marker]:hidden">
          <div className="flex items-baseline gap-2.5">
            <span className="text-faint transition-transform duration-200 group-open/sec:rotate-90">▸</span>
            {titleEl}
            {subEl}
          </div>
          {rightEl}
        </summary>
        <div className="mt-2 h-px bg-edge" />
        <div className="pt-3">{children}</div>
      </details>
    );
  }

  return (
    <section
      className={`relative ${boxed ? "rounded border border-edge bg-panel px-4 py-3" : ""} ${i != null ? "rise" : ""} ${className}`}
      style={i != null ? ({ "--i": i } as CSSProperties) : undefined}
    >
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-4 pb-2">
          <div className="flex items-baseline gap-2.5">
            {titleEl}
            {subEl}
          </div>
          {rightEl}
        </header>
      )}
      <div className="h-px bg-edge" />
      <div className="pt-3">{children}</div>
    </section>
  );
}

/** A generic one-at-a-time disclosure for content that isn't already a Section (shares the native
 *  `name` accordion group). The title row is the click target; the body shows when open.
 *
 *  Open state is uncontrolled by default (`defaultOpen`, native <details> toggling). Pass `open` to
 *  drive it from the parent instead — e.g. force the drawer open on a deep-link reveal — while still
 *  letting the user manually toggle it via `onToggle`. Existing callers that only pass `defaultOpen`
 *  are unaffected. */
export function Collapse({
  title,
  subtitle,
  name,
  defaultOpen = false,
  open,
  onToggle,
  className = "",
  children,
}: {
  title: string;
  subtitle?: string;
  name?: string;
  defaultOpen?: boolean;
  /** Controlled open state. When provided, this drives whether the drawer is open instead of `defaultOpen`. */
  open?: boolean;
  /** Fired when the user toggles a controlled drawer (click, keyboard), so the parent can stay in sync. */
  onToggle?: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}) {
  const controlled = open !== undefined;
  return (
    <details
      name={name}
      open={controlled ? open : defaultOpen}
      className={`group/sec relative ${className}`}
      onToggle={controlled ? (e) => onToggle?.((e.currentTarget as HTMLDetailsElement).open) : undefined}
    >
      <summary className="flex cursor-pointer list-none items-baseline gap-2.5 py-1 [&::-webkit-details-marker]:hidden">
        <span className="text-faint transition-transform duration-200 group-open/sec:rotate-90">▸</span>
        <h2 className="font-display text-sm font-semibold uppercase tracking-[0.13em] text-muted">{title}</h2>
        {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
      </summary>
      <div className="mt-2 h-px bg-edge" />
      <div className="pt-3">{children}</div>
    </details>
  );
}

/** A right-aligned tabular-mono number cell — the ledger's default numeric. */
export function Num({ children, color, className = "" }: { children: ReactNode; color?: string; className?: string }) {
  return (
    <span className={`mono tabular-nums ${className}`} style={color ? { color } : undefined}>
      {children}
    </span>
  );
}

/** A dense ledger row: a CSS grid keyed by `cols`, hairline-divided by the parent, hover/active aware. */
export function LedgerRow({
  cols,
  active,
  onMouseEnter,
  onMouseLeave,
  onClick,
  children,
}: {
  cols: string;
  active?: boolean;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid items-center gap-2 px-1.5 py-1 text-sm transition-colors ${active ? "bg-panel-2" : "hover:bg-panel-2/45"} ${onClick ? "cursor-pointer" : ""}`}
      style={{ gridTemplateColumns: cols }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onClick}
    >
      {children}
    </div>
  );
}

/** Column headings for a ledger, sharing the row's `cols` grid. */
export function LedgerHead({ cols, children }: { cols: string; children: ReactNode }) {
  return (
    <div className="label grid gap-2 px-1.5 pb-1.5 text-xs" style={{ gridTemplateColumns: cols }}>
      {children}
    </div>
  );
}

/** A debrief panel: stenciled label header over a hairline baseline, like an instrument readout. */
export function Panel({
  title,
  subtitle,
  right,
  children,
  className = "",
  i,
}: {
  title?: string;
  subtitle?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  i?: number;
}) {
  return (
    <section
      className={`relative rounded-lg border border-edge bg-panel ${i != null ? "rise" : ""} ${className}`}
      style={i != null ? ({ "--i": i } as CSSProperties) : undefined}
    >
      {(title || right) && (
        <header className="flex items-baseline justify-between gap-4 px-5 pt-3.5 pb-3">
          <div className="flex items-baseline gap-3">
            {title && <h2 className="font-display text-sm font-semibold uppercase tracking-[0.13em] text-muted">{title}</h2>}
            {subtitle && <span className="text-xs text-faint">{subtitle}</span>}
          </div>
          {right && <div className="text-xs text-muted">{right}</div>}
        </header>
      )}
      <div className="mx-5 h-px bg-edge" />
      <div className="px-5 py-4">{children}</div>
    </section>
  );
}

const polar = (cx: number, cy: number, r: number, deg: number): [number, number] => {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};
const arc = (cx: number, cy: number, r: number, a0: number, a1: number): string => {
  const [x0, y0] = polar(cx, cy, r, a0);
  const [x1, y1] = polar(cx, cy, r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}`;
};

// Higher is better for every score we gauge. Green / caution-amber / warning-red zones — like the
// arc zones painted on a real cockpit instrument, so a needle's POSITION tells the story.
const ZONES = [
  { to: 40, color: "var(--color-detour)" }, // bad — coral
  { to: 65, color: "var(--color-tool)" }, // neutral — lavender
  { to: 100, color: "var(--color-match)" }, // good — teal
] as const;

export function tierColor(v: number): string {
  return v >= 65 ? "var(--color-match)" : v >= 40 ? "var(--color-tool)" : "var(--color-detour)";
}

/** A 270° arc gauge with painted zone bands and a neutral needle — the report's signature readout. */
export function Gauge({ label, value, caption, unit = "%" }: { label: string; value: number; caption?: string; unit?: string }) {
  const cx = 50;
  const cy = 50;
  const r = 38;
  const START = 135;
  const SWEEP = 270;
  const v = Math.max(0, Math.min(100, value));
  const frac = v / 100;
  const needleDeg = START + SWEEP * frac;

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative h-[108px] w-[108px]">
        <svg viewBox="0 0 100 100" className="h-full w-full">
          {/* base track */}
          <path d={arc(cx, cy, r, START, START + SWEEP)} fill="none" stroke="var(--color-edge)" strokeWidth="6" strokeLinecap="round" />
          {/* painted zone bands (faint) */}
          {ZONES.map((z, idx) => {
            const from = idx === 0 ? 0 : ZONES[idx - 1].to;
            return (
              <path
                key={z.to}
                d={arc(cx, cy, r, START + SWEEP * (from / 100), START + SWEEP * (z.to / 100))}
                fill="none"
                stroke={z.color}
                strokeWidth="6"
                strokeLinecap="butt"
                opacity="0.34"
              />
            );
          })}
          {/* filled value arc — neutral needle fill */}
          <path
            d={arc(cx, cy, r, START, START + SWEEP)}
            fill="none"
            stroke="var(--color-fg)"
            strokeWidth="2.5"
            strokeLinecap="round"
            pathLength={1}
            style={{ strokeDasharray: 1, strokeDashoffset: 1 - frac, transition: "stroke-dashoffset 720ms var(--ease-out-expo)" }}
          />
          {/* needle tip */}
          {(() => {
            const [x1, y1] = polar(cx, cy, r - 7, needleDeg);
            const [x2, y2] = polar(cx, cy, r + 3.5, needleDeg);
            return <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={tierColor(v)} strokeWidth="2.5" strokeLinecap="round" />;
          })()}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-display text-3xl font-bold tabular-nums leading-none" style={{ color: tierColor(v) }}>
            {Math.round(value)}
          </span>
          <span className="-mt-0.5 text-xs text-faint">{unit}</span>
        </div>
      </div>
      <div className="text-center">
        <div className="label text-fg">{label}</div>
        {caption && <div className="mt-0.5 text-xs text-faint">{caption}</div>}
      </div>
    </div>
  );
}

export function Chip({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs font-medium"
      style={{ color, backgroundColor: `color-mix(in oklch, ${color} 16%, transparent)` }}
    >
      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
      {children}
    </span>
  );
}

const LEGEND: { mode: ActorMode | "detour"; color: string; label: string }[] = [
  { mode: "machine_bound", color: ACTOR_COLORS.machine_bound, label: ACTOR_LABELS.machine_bound },
  { mode: "human_active", color: ACTOR_COLORS.human_active, label: ACTOR_LABELS.human_active },
  { mode: "think_pause", color: ACTOR_COLORS.think_pause, label: ACTOR_LABELS.think_pause },
  { mode: "detour", color: DETOUR_COLOR, label: "Detour" },
];

/** The actor-mode color vocabulary, taught once and reused on every chart. */
export function ActorLegend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1.5">
      {LEGEND.map((l) => (
        <span key={l.mode} className="inline-flex items-center gap-1.5 text-xs text-muted">
          <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: l.color }} />
          {l.label}
        </span>
      ))}
    </div>
  );
}
