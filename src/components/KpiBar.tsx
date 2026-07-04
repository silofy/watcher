import { useReport } from "../store/report";
import { tierColor } from "./ui";
import { computeGrade, gradeColor } from "../lib/bridge/grade";
import { ArrowUpRight } from "./icons";

function goTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

type Cell = { label: string; value: string; unit?: string; color: string; to: string; section: string; caption: string };

function MetricCard({ c }: { c: Cell }) {
  return (
    <button
      type="button"
      onClick={() => goTo(c.to)}
      title={`Open “${c.section}”`}
      className="group flex h-full flex-col justify-between gap-2 rounded-lg border border-edge bg-panel px-3 pt-3 pb-2.5 text-left transition-colors hover:border-edge-bright hover:bg-panel-2/50"
    >
      <div className="flex items-center justify-between">
        <span className="label text-xs">{c.label}</span>
        <ArrowUpRight size={12} className="text-faint transition-colors group-hover:text-signal" />
      </div>
      {/* value + meaning anchored to the bottom of the card */}
      <div>
        <div className="flex items-baseline gap-0.5">
          <span className="readout text-4xl" style={{ color: c.color }}>
            {c.value}
          </span>
          {c.unit && <span className="text-2xl text-faint">{c.unit}</span>}
        </div>
        {/* at rest: what the number means · on hover: where it's explained */}
        <span className="mt-1 block text-xs leading-tight text-faint">
          <span className="group-hover:hidden">{c.caption}</span>
          <span className="hidden text-signal group-hover:inline">→ {c.section}</span>
        </span>
      </div>
    </button>
  );
}

/** The verdict summary — a Grade-forward card set; each card jumps to the section that explains it. */
export function KpiBar() {
  const { report, metrics } = useReport();
  const grade = computeGrade(report);
  const tw = metrics.time_waster;
  const lost = Math.round(((tw.detour_ms + tw.stuck_ms + tw.loop_ms) / Math.max(1, tw.t_active_ms)) * 100);

  const cells: Cell[] = [
    { label: "Coverage", value: String(Math.round(metrics.objective_coverage_pct)), unit: "%", color: tierColor(metrics.objective_coverage_pct), to: "path", section: "What you'd do differently", caption: "objectives hit vs the write-up" },
    { label: "Time lost", value: String(lost), unit: "%", color: lost >= 30 ? "var(--color-detour)" : lost >= 15 ? "var(--color-tool)" : "var(--color-match)", to: "deviated", section: "Where you deviated", caption: "detours, loops & stalls" },
    { label: "Stealth", value: String(Math.round(metrics.stealth_score)), color: tierColor(metrics.stealth_score), to: "stealth", section: "Stealth & Noise", caption: "vs the lab noise baseline" },
    { label: "Techniques", value: String(metrics.technique_breadth), color: "var(--color-fg)", to: "unfolded", section: "How the run unfolded", caption: "distinct ATT&CK techniques" },
  ];

  return (
    <div className="flex flex-wrap items-stretch gap-2.5">
      {/* the headline grade — the hero card, clearly the largest */}
      <button
        type="button"
        onClick={() => goTo("bridge")}
        title="Open “Coaching & grade” — the rubric and playbook"
        className="group flex min-w-[15rem] flex-col justify-between rounded-lg border border-edge bg-panel px-5 pt-3 pb-4 text-left transition-colors hover:border-edge-bright hover:bg-panel-2/50 lg:min-w-[17rem]"
      >
        <div className="flex items-center justify-between">
          <span className="label text-xs">Grade</span>
          <ArrowUpRight size={12} className="text-faint transition-colors group-hover:text-signal" />
        </div>
        <div className="flex w-full items-baseline justify-between gap-2">
          <span className="font-display text-7xl font-bold leading-none" style={{ color: gradeColor(grade.letter) }}>
            {grade.letter}
          </span>
          <span className="mono text-base text-faint">{Math.round(grade.score)}/100</span>
        </div>
      </button>

      {/* the supporting metrics — narrower cards beside the hero */}
      <div className="grid flex-1 grid-cols-2 gap-2.5 sm:grid-cols-4">
        {cells.map((c) => (
          <MetricCard key={c.label} c={c} />
        ))}
      </div>
    </div>
  );
}
