import { useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useReport } from "../store/report";
import { draftReport } from "../lib/report/draft";
import { Section } from "./ui";
import { Check } from "./icons";

/**
 * The deliverable: the same OSCP/CPTS-style Markdown report that `npm run report` writes, drafted
 * in-browser from the loaded run (draftReport is pure + deterministic — no opts = no model) and
 * rendered via react-markdown. Surfaced in the debrief so the "the debrief writes your report" step
 * is visible in the app and the demos, not just a CLI feature. Styling lives in `.md-report`.
 */
export function ReportDraft() {
  const report = useReport((s) => s.report);
  const md = useMemo(() => draftReport(report), [report]);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(md);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard blocked (e.g. insecure context) — the viewer is still readable */
    }
  }

  return (
    <Section title="The report" subtitle="an OSCP/CPTS-style draft, written from the run — deterministic and offline" dataShot="report">
      <div className="overflow-hidden rounded-lg border border-edge bg-panel">
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
        <div className="md-report max-h-[560px] overflow-y-auto px-5 py-4">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{md}</ReactMarkdown>
        </div>
      </div>
    </Section>
  );
}
