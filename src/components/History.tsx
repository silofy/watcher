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

function Card({ c, onOpen }: { c: SessionCard; onOpen: () => void }) {
  const m = c.machine;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative rounded-lg border border-edge bg-panel p-4 text-left transition-[border-color,transform] duration-200 hover:-translate-y-0.5 hover:border-edge-bright"
    >
      <div className="flex items-start gap-3">
        <MachineAvatar machine={m} size={52} />
        <div className="min-w-0">
          <div className="font-display text-xl font-bold leading-none text-fg">{m.name}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {c.recording && (
              <span className="label flex items-center gap-1 text-xs text-signal">
                <span className="caret">●</span> Rec
              </span>
            )}
            {!c.recording && c.isLatest && (
              <span className="label flex items-center gap-1 text-xs text-signal">
                <span className="h-1.5 w-1.5 rounded-full bg-signal" /> Latest
              </span>
            )}
            <span className="label text-xs" style={{ color: c.rooted ? "var(--color-match)" : "var(--color-faint)" }}>
              {c.rooted ? "Rooted" : "Foothold"}
            </span>
            {m.difficulty && (
              <span className="label text-xs" style={{ color: DIFFICULTY_COLOR[m.difficulty] }}>
                {m.difficulty}
              </span>
            )}
            {m.os && <span className="label text-xs text-faint">{m.os}</span>}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="font-display text-4xl font-bold leading-none" style={{ color: gradeColor(c.letter) }}>
            {c.letter}
          </div>
          <div className="label mt-0.5 tabular-nums">{Math.round(c.grade)}</div>
        </div>
      </div>

      <div className="mt-3.5 h-px bg-edge" />
      <div className="mt-2.5 flex items-center justify-between text-xs text-faint">
        <span className="mono">
          cov {Math.round(c.coverage)}% · eff {Math.round(c.efficiency)}% · {c.episodes} ep
        </span>
        <span className="mono">{fmtDate(c.ended_at)}</span>
      </div>
    </button>
  );
}

export function History() {
  const { sessionCards, switchSession, ingestLiveReport } = useReport();
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
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
          {cards.map((c) => (
            <Card key={c.id} c={c} onOpen={() => switchSession(c.id)} />
          ))}
        </div>
      )}
    </div>
  );
}
