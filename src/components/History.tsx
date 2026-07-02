import { useRef, useState } from "react";
import { useReport, type SessionCard } from "../store/report";
import { MachineAvatar } from "./MachineAvatar";
import { DIFFICULTY_COLOR } from "../lib/machine";
import type { WatcherReport } from "../types/report";

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
  const m = c.machine;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="hover-lift group flex w-full items-center gap-4 rounded-lg border border-edge bg-panel px-4 py-3 text-left hover:border-edge-bright"
    >
      <MachineAvatar machine={m} size={42} />

      {/* identity + the one status that matters */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-display text-lg font-bold leading-tight text-fg">{m.name}</span>
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
          {m.difficulty && (
            <span className="label" style={{ color: DIFFICULTY_COLOR[m.difficulty] }}>
              {m.difficulty}
            </span>
          )}
          {m.os && <span className="text-faint">{m.os}</span>}
          {/* result of the run — a static outcome, not a live state */}
          <span style={{ color: c.rooted ? "var(--color-match)" : "var(--color-faint)" }}>
            {c.rooted ? "✓ Rooted" : "Foothold only"}
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

  async function importFile(file: File | undefined) {
    if (!file) return;
    setErr(null);
    try {
      const rep = JSON.parse((await file.text()).replace(/^﻿/, "")) as WatcherReport;
      if (!rep?.session?.uuid || !Array.isArray(rep.episodes)) throw new Error("shape");
      ingestLiveReport(rep);
      switchSession(`htb:${rep.session.uuid}`);
    } catch {
      setErr(`"${file.name}" isn't a Watcher session JSON — it should be a report exported by the capture agent.`);
    }
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
      <input ref={fileRef} type="file" accept="application/json,.json" className="hidden" onChange={(e) => void importFile(e.target.files?.[0])} />
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h2 className="label text-muted">Engagement history</h2>
          <span className="text-xs text-faint">{cards.length} runs · click to open the debrief</span>
        </div>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="label rounded-full border border-signal/50 px-3 py-1.5 text-signal transition-colors hover:bg-signal/15"
          title="Load a session JSON captured by the agent (or dropped from Pwnbox)"
        >
          Import session ↑
        </button>
      </div>
      {drag && <div className="mb-4 rounded-lg border-2 border-dashed border-signal bg-signal/10 px-6 py-8 text-center text-sm text-signal">Drop a session JSON to load it</div>}
      {err && <p className="mb-4 text-xs text-detour">{err}</p>}

      {cards.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge bg-panel px-6 py-16 text-center">
          <div className="font-display text-lg text-muted">No runs yet</div>
          <p className="mx-auto mt-2 max-w-[44ch] text-sm text-faint">
            Capture a session with the agent — or <span className="text-signal">Import</span> a session JSON (drag it anywhere here) to load a run you captured elsewhere, like Pwnbox.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {cards.map((c) => (
            <Row key={c.id} c={c} onOpen={() => (c.demo ? startLiveDemo() : switchSession(c.id))} />
          ))}
        </div>
      )}
    </div>
  );
}
