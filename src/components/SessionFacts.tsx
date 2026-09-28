import { useReport } from "../store/report";
import { fmtDuration } from "../lib/format";
import { captureSource } from "../lib/capture-source";
import { Chip } from "./ui";

/** Low-level session metadata — where/when the capture ran. Lives in the Session window section,
 *  not the identity band, which is reserved for the result and the takeaway. */
export function SessionFacts() {
  const { report, timeline } = useReport();
  const { session } = report;
  const src = captureSource(session);
  const facts: [string, string][] = [
    ["Date", new Date(session.started_at).toISOString().slice(0, 10)],
    ["Duration", fmtDuration(timeline.totalMs)],
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
