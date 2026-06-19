import { useState } from "react";
import { hueFor, DIFFICULTY_COLOR, type MachineMeta } from "../lib/machine";

/**
 * The machine's emblem. Fetches the real avatar (e.g. HTB CDN) when one is provided, with an
 * onError fall-through to a generated, deterministic instrument emblem so it always renders —
 * offline, broken URL, or local capture all degrade gracefully.
 */
export function MachineAvatar({ machine, size = 64 }: { machine: MachineMeta; size?: number }) {
  const [failed, setFailed] = useState(false);
  const initials = (machine.name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2) || "??").toUpperCase();
  const hue = hueFor(machine.name);
  const ring = machine.difficulty ? DIFFICULTY_COLOR[machine.difficulty] ?? "var(--color-edge-bright)" : "var(--color-edge-bright)";

  if (machine.avatar && !failed) {
    return (
      <img
        src={machine.avatar}
        onError={() => setFailed(true)}
        width={size}
        height={size}
        alt={machine.name}
        className="rounded-full object-cover"
        style={{ boxShadow: "inset 0 0 0 1px var(--color-edge)" }}
      />
    );
  }

  // local / host capture — a terminal-prompt emblem, not box initials
  if (machine.local) {
    return (
      <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={machine.name}>
        <circle cx="32" cy="32" r="31.25" fill="var(--color-panel-2)" stroke="var(--color-edge)" />
        <text x="32" y="40" textAnchor="middle" fontFamily="var(--font-mono)" fontWeight="600" fontSize="24" fill="var(--color-tool)">
          {">_"}
        </text>
        <circle cx="32" cy="32" r="29.5" fill="none" stroke="var(--color-tool)" strokeWidth="1.5" opacity="0.55" />
      </svg>
    );
  }

  const r = size / 64; // viewBox is 64
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={machine.name}>
      <circle cx="32" cy="32" r="31.25" fill="var(--color-panel-2)" stroke="var(--color-edge)" />
      {/* seeded geometric backdrop */}
      <g stroke={`oklch(0.58 0.09 ${hue})`} strokeWidth="1" fill="none" opacity="0.45">
        <circle cx="32" cy="32" r="21" />
        <line x1="8" y1={20 + (hue % 24)} x2="56" y2={44 - (hue % 24)} />
      </g>
      <text
        x="32"
        y="40.5"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontWeight="700"
        fontSize="23"
        letterSpacing="0.01em"
        fill="var(--color-fg)"
      >
        {initials}
      </text>
      {/* difficulty ring */}
      <circle cx="32" cy="32" r="29.5" fill="none" stroke={ring} strokeWidth={2 * r > 1.5 ? 2 : 1.5} opacity="0.75" />
    </svg>
  );
}
