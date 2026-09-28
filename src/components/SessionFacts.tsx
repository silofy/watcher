import { useReport } from "../store/report";
import { fmtDuration } from "../lib/format";
import { captureSource } from "../lib/capture-source";
import { Chip } from "./ui";
import type { Session } from "../types/report";

/** Low-level session metadata — where/when the capture ran. Lives in the Session window section,
 *  not the identity band, which is reserved for the result and the takeaway.
 *
 *  Accepts an optional `session`/`totalMs` override so the defense debrief (whose active session
 *  isn't the store's offense `report`) can reuse this same badge; omitted, it reads the active
 *  offense report exactly as before. */
export function SessionFacts({ session: sessionProp, totalMs: totalMsProp }: { session?: Session; totalMs?: number } = {}) {
  const { report, timeline } = useReport();
  const session = sessionProp ?? report.session;
  const totalMs = totalMsProp ?? timeline.totalMs;
  const src = captureSource(session);
  const facts: [string, string][] = [
    ["Date", new Date(session.started_at).toISOString().slice(0, 10)],
    ["Duration", fmtDuration(totalMs)],
    ["Shell", session.shell || "—"],
    ["Context", session.context_path ?? "host"],
    ["Session", session.uuid.slice(0, 8)],
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      <div className="flex flex-col gap-0.5">
        <span className="label text-xs text-faint">Source</span>
        <span title={src.hint}>
          <Chip color={src.color}>{src.label}</Chip>
        </span>
      </div>
      {facts.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="label text-xs text-faint">{label}</span>
          <span className="mono text-sm text-fg">{value}</span>
        </div>
      ))}
    </div>
  );
}
