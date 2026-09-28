import { useRef, useState } from "react";
import { useReport, type SessionCard } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { DIFFICULTY_COLOR } from "../lib/machine";
import { targetOf, platformLabel } from "../lib/platform";
import type { WatcherReport } from "../types/report";
import { reportFromCapture } from "../lib/ingest/detect";
import { Check } from "./icons";

function gradeColor(letter: string): string {
  if (letter === "A" || letter === "B") return "var(--color-match)";
  if (letter === "C") return "var(--color-signal)";
  return "var(--color-skipped)";
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** One engagement per row: identity → status → result → metrics → grade → date. */
function Row({ c, onOpen }: { c: SessionCard; onOpen: () => void }) {
  const t = c.target;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover-lift group flex w-full items-center gap-4 rounded-lg border border-edge bg-panel px-4 py-3 text-left hover:border-edge-bright"
    >
      <MachineAvatar target={t} size={42} />

      {/* identity + the one status that matters */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-lg font-bold leading-tight text-fg">{t.name}</span>
          {c.demo ? (
            <span
              title="A scripted demo — opens and plays the run live, start to finish."
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-signal"
              style={{ background: "color-mix(in oklch, var(--color-signal) 14%, transparent)" }}
            >
              ▶ Watch live demo
            </span>
          ) : c.recording ? (
            <span
              title="Live — capturing now. Stops when you exit the capture agent (or the box is terminated)."
              className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs text-signal"
              style={{ background: "color-mix(in oklch, var(--color-signal) 14%, transparent)" }}
            >
              <span className="caret">●</span> Recording
            </span>
          ) : (
            c.isLatest && <span className="label text-xs text-signal">· Latest</span>
          )}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
          {/* which platform this run is from — read at a glance, before difficulty/OS */}
          <span className="label text-faint">{platformLabel(t.platform)}</span>
          {t.difficulty?.label && (
            <span className="label" style={{ color: DIFFICULTY_COLOR[t.difficulty.label] }}>
              {t.difficulty.label}
            </span>
          )}
          {t.os && <span className="text-faint">{t.os}</span>}
          {/* result of the run — a static outcome, not a live state */}
          <span className="flex items-center gap-1" style={{ color: c.rooted ? "var(--color-match)" : "var(--color-faint)" }}>
            {c.rooted ? (
              <>
                <Check size={12} /> Rooted
              </>
            ) : (
              "Foothold only"
            )}
          </span>
        </div>
      </div>

      {/* metrics — quiet, hidden on narrow widths */}
      <span className="mono hidden whitespace-nowrap text-xs text-faint sm:inline">
        cov {Math.round(c.coverage)}% · eff {Math.round(c.efficiency)}% · {c.episodes} ep
      </span>

      <span className="mono hidden whitespace-nowrap text-xs text-faint md:inline">{fmtDate(c.ended_at)}</span>

      {/* grade */}
      <div className="w-10 shrink-0 text-right">
        <div className="font-display text-3xl font-bold leading-none" style={{ color: gradeColor(c.letter) }}>
          {c.letter}
        </div>
        <div className="label mt-0.5 tabular-nums text-faint">{Math.round(c.grade)}</div>
      </div>
    </button>
  );
}

export function History() {
  const { sessionCards, switchSession, ingestLiveReport, startLiveDemo } = useReport();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const cards = [...sessionCards].sort(
    (a, b) =>
      Number(b.recording) - Number(a.recording) ||
      Number(b.isLatest) - Number(a.isLatest) ||
      Date.parse(b.ended_at) - Date.parse(a.ended_at),
  );

  function open(rep: WatcherReport) {
    ingestLiveReport(rep);
    switchSession(`${targetOf(rep).platform}:${rep.session.uuid}`);
  }

  async function importFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    const text = (await file.text()).replace(/^﻿/, "");
    // A raw capture (Claude Code transcript, HAR, or Sysmon export) — run the adapter.
    try {
      const fromCapture = reportFromCapture(text, file.name);
      if (fromCapture) return open(fromCapture);
    } catch {
      /* fall through to the report-JSON path */
    }
    // An already-assembled Watcher report JSON (from the agent / Pwnbox).
    try {
      const rep = JSON.parse(text) as WatcherReport;
      if (rep?.session?.uuid && Array.isArray(rep.episodes)) return open(rep);
    } catch {
      /* not JSON */
    }
    setErr(`"${file.name}" isn't a recognized session. Import a Watcher report JSON, a Claude Code transcript (.jsonl), a HAR file, or a Sysmon export.`);
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        void importFile(e.dataTransfer.files[0]);
      }}
    >
      <input ref={fileRef} type="file" accept="application/json,.json,.har,.jsonl,.ndjson" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="label text-muted">Engagement history</h2>
          <span className="text-xs text-faint">{cards.length} runs · click to open the debrief</span>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="label rounded-full border border-signal/50 px-3 py-1.5 text-signal transition-colors hover:bg-signal/15"
          title="Import a run: a Watcher report JSON, a Claude Code transcript (.jsonl), a HAR export, or a Sysmon log"
        >
          Import session ↑
        </button>
      </div>
      {drag && <div className="mb-4 rounded-lg border-2 border-dashed border-signal bg-signal/10 px-6 py-8 text-center text-sm text-signal">Drop a report JSON, Claude Code transcript, HAR, or Sysmon export to grade it</div>}
      {err && <p className="mb-4 text-xs text-detour">{err}</p>}

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge bg-panel px-6 py-16 text-center">
          <div className="font-display text-lg text-muted">No runs yet</div>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-faint">
            Capture a session with the agent, or <span className="text-signal">Import</span> a run (drag it anywhere here): a Watcher report JSON, a Claude Code transcript, a HAR export, or a Sysmon log.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <Row key={c.id} c={c} onOpen={() => (c.demo ? startLiveDemo(c.id) : switchSession(c.id))} />
          ))}
        </div>
      )}
    </div>
  );
}
