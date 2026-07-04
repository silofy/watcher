import type { ReactNode, SVGProps } from "react";

/**
 * Local, dependency-free stroke icons — Lucide's path data embedded directly (MIT-licensed), matching
 * the codebase's existing hand-rolled stroke-icon convention (see the inline `Icon` this replaces in
 * `PhaseAudit.tsx`). No `lucide-react` import: keeps the bundle offline-safe and avoids version drift.
 *
 * All icons share the same stroke contract — `currentColor`, no fill, 2px rounded strokes — so they
 * drop in anywhere text currently sits at `1em`/`text-xs` size. `size` defaults to 16; pass a number
 * (px) or let the parent's `className` override width/height via Tailwind if needed.
 */
type IconProps = { size?: number; className?: string } & Omit<SVGProps<SVGSVGElement>, "width" | "height" | "viewBox" | "fill" | "stroke">;

function IconBase({ size = 16, className = "", children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Disclosure chevron — points down by default (closed); rotate it yourself on open if desired. */
export function ChevronDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="6 9 12 15 18 9" />
    </IconBase>
  );
}

/** A reached / satisfied / confirmed objective. */
export function Check(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 6 9 17l-5-5" />
    </IconBase>
  );
}

/** A skipped / not-reached objective — the open, empty counterpart to `Check`. */
export function Circle(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
    </IconBase>
  );
}

/** A captured flag / milestone win. */
export function Flag(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" x2="4" y1="22" y2="15" />
    </IconBase>
  );
}

/** An internal deep-link jump (e.g. "step N") — stays on the page. */
export function ArrowUpRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <line x1="7" x2="17" y1="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </IconBase>
  );
}

/** A link that leaves the app (opens an external page/browser). */
export function ExternalLink(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </IconBase>
  );
}

/** Efficiency / speed. */
export function Zap(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8z" />
    </IconBase>
  );
}

/** Commands run — a shell prompt. */
export function Terminal(props: IconProps) {
  return (
    <IconBase {...props}>
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </IconBase>
  );
}

/** Techniques / targeting (ATT&CK). */
export function Crosshair(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <line x1="22" x2="18" y1="12" y2="12" />
      <line x1="6" x2="2" y1="12" y2="12" />
      <line x1="12" x2="12" y1="6" y2="2" />
      <line x1="12" x2="12" y1="22" y2="18" />
    </IconBase>
  );
}

/** The brand mark — a scanning eye, for "The Watcher" in the nav. */
export function ScanEye(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <circle cx="12" cy="12" r="1" />
      <path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0" />
    </IconBase>
  );
}
