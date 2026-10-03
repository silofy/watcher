import { useMemo, useState, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReport } from "../store/report";
import { draftReport } from "../lib/report/draft";
import { computeGrade, gradeColor } from "../lib/bridge/grade";
import { Section } from "./ui";
import { Check } from "./icons";

/** Severity → colour, for the inline badges in the findings. */
const SEV: Record<string, string> = {
  critical: "var(--color-loud)",
  high: "#ff8a4a",
  medium: "var(--color-flag)",
  low: "#4d9bff",
  info: "var(--color-muted)",
  unset: "var(--color-muted)",
};

// Wrap each finding's severity value in backticks so the inline-code renderer below turns it into a
// coloured badge, without changing the generated Markdown (that restyle is step B).
const badgeSeverities = (md: string) => md.replace(/\*\*Severity\*\*:\s*([A-Za-z]+)/g, "**Severity**: `$1`");

/**
 * The deliverable: the OSCP/CPTS-style report (draftReport — pure, deterministic) rendered in-browser
 * as a designed document, not raw Markdown. A cover (title · target · grade · redaction state) stands
 * in for the Markdown's plain header, findings severities render as coloured badges, and `.md-report`
 * carries the document typography. Offense debrief only.
 */
export function ReportDraft() {
  const report = useReport((s) => s.report);
  const md = useMemo(() => draftReport(report), [report]);
  const [copied, setCopied] = useState(false);

  // Strip the Markdown's own header block (title + target + redaction note) — the cover renders it —
  // and keep everything from the first "## " section onward. Severities become badges.
  const body = useMemo(() => {
    const i = md.indexOf("\n## ");
    return badgeSeverities(i >= 0 ? md.slice(i + 1) : md);
  }, [md]);

  const { session } = report;
  const target = session.target ?? session.machine;
  const name = (target && "name" in target ? target.name : undefined) ?? session.target_scope ?? "Engagement";
  const platform = target && "platform" in target ? target.platform : undefined;
  const difficulty = target?.difficulty && typeof target.difficulty === "object" ? target.difficulty.label : (target?.difficulty as string | undefined);
  const os = target?.os;
  const publicSafe = report.redaction_profile === "public_safe";

  const grade = useMemo(() => {
    try {
      const g = computeGrade(report);
      return { letter: g.letter, score: g.score, color: gradeColor(g.letter) };
    } catch {
      return null;
    }
  }, [report]);

  const chips = [platform?.toUpperCase(), difficulty, os].filter(Boolean) as string[];

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (insecure context) — the viewer is still readable */
    }
  }

  const mdComponents = {
    code({ className, children, ...props }: { className?: string; children?: ReactNode }) {
      const txt = String(children ?? "").trim();
      const key = txt.toLowerCase();
      if (!className && SEV[key]) {
        return (
          <span className="rpt-sev" style={{ color: SEV[key], borderColor: `color-mix(in oklch, ${SEV[key]} 45%, transparent)`, background: `color-mix(in oklch, ${SEV[key]} 14%, transparent)` }}>
            {txt}
          </span>
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <Section title="The report" subtitle="an OSCP/CPTS-style draft, written from the run — deterministic and offline" dataShot="report">
      <div className="overflow-hidden rounded-lg border border-edge bg-panel">
        {/* chrome bar */}
        <div className="flex items-center gap-2.5 border-b border-edge px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="h-2.5 w-2.5 rounded-full bg-edge-bright" />
            <i className="h-2.5 w-2.5 rounded-full bg-edge-bright" />
            <i className="h-2.5 w-2.5 rounded-full bg-edge-bright" />
          </span>
          <span className="mono text-xs text-faint">report.md</span>
          <button
            type="button"
            onClick={copy}
            className="label ml-auto inline-flex items-center gap-1.5 rounded border border-edge px-2 py-1 text-muted transition-colors hover:border-signal hover:text-fg"
          >
            {copied ? (
              <>
                <Check size={12} /> Copied
              </>
            ) : (
              <>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
                Copy Markdown
              </>
            )}
          </button>
        </div>

        {/* cover */}
        <div className="flex items-start justify-between gap-4 border-b border-edge px-6 pb-5 pt-6">
          <div className="min-w-0">
            <div className="label text-faint">Penetration Test Report</div>
            <h3 className="mt-1.5 font-display text-2xl font-bold tracking-[-0.02em] text-fg">{name}</h3>
            {chips.length > 0 && (
              <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                {chips.map((c) => (
                  <span key={c} className="label rounded border border-edge px-1.5 py-0.5 text-faint">
                    {c}
                  </span>
                ))}
                <span className={`label rounded px-1.5 py-0.5 ${publicSafe ? "text-match" : "text-flag"}`} style={{ background: `color-mix(in oklch, ${publicSafe ? "var(--color-match)" : "var(--color-flag)"} 14%, transparent)` }}>
                  {publicSafe ? "redacted · shareable" : "full · do not share"}
                </span>
              </div>
            )}
          </div>
          {grade && (
            <div className="shrink-0 rounded-lg border border-edge bg-ink/40 px-4 py-2.5 text-center">
              <div className="label text-faint">Grade</div>
              <div className="font-display text-3xl font-bold leading-none" style={{ color: grade.color }}>
                {grade.letter}
              </div>
              <div className="mono mt-1 text-[11px] text-faint">{grade.score}/100</div>
            </div>
          )}
        </div>

        {/* body */}
        <div className="md-report max-h-[560px] overflow-y-auto px-6 py-5">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
            {body}
          </ReactMarkdown>
        </div>
      </div>
    </Section>
  );
}
