/* Standalone embed bundle: mounts real Watcher report components into any host page
 * (e.g. the marketing landing) inside a Shadow DOM, so the app's Tailwind reset is
 * isolated from the host and the theme's :root vars resolve inside the shadow. The
 * store auto-loads the fullest demo (Abducted) — see src/store/report.ts loadSessions. */
import { createRoot } from "react-dom/client";
import cssRaw from "../src/index.css?inline";
import { GhostCard } from "../src/components/GhostCard";
import { Assessment } from "../src/components/Assessment";
import { LiveDashboard } from "../src/components/LiveDashboard";
import { PhaseAudit } from "../src/components/PhaseAudit";
import { IdentityBar } from "../src/components/IdentityBar";
import { Progress } from "../src/components/Progress";
import { CommandReplay } from "../src/components/CommandReplay";

// Tailwind puts theme tokens on :root; that selector doesn't match inside a shadow tree,
// so rehome them onto :host where they inherit into the mounted component.
const css = (cssRaw as string).replace(/:root\b/g, ":host");

// `header` = the report's identity band (machine, difficulty, live/graded scores) plus the
// Writeup-reference row it renders — the persistent top block of the real app.
const VIEWS: Record<string, React.ComponentType> = {
  header: IdentityBar, ghost: GhostCard, grade: Assessment, liveops: LiveDashboard, phase: PhaseAudit,
  progress: Progress, replay: CommandReplay,
};

function mount(el: HTMLElement, view: string) {
  const C = VIEWS[view];
  if (!C || (el as unknown as { __w?: boolean }).__w) return;
  (el as unknown as { __w?: boolean }).__w = true;
  const shadow = el.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = css;
  shadow.appendChild(style);
  const host = document.createElement("div");
  host.style.colorScheme = "dark";
  shadow.appendChild(host);
  createRoot(host).render(<C />);
}

function auto() {
  document.querySelectorAll<HTMLElement>("[data-watcher]").forEach((el) => mount(el, el.dataset.watcher!));
}
(window as unknown as { mountWatcher: () => void }).mountWatcher = auto;
if (document.readyState !== "loading") auto();
else document.addEventListener("DOMContentLoaded", auto);
