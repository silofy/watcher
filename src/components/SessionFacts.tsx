import { useReport } from "../store/report";
import { fmtDuration } from "../lib/format";

const SOURCE_LABEL: Record<string, string> = {
  local_pty: "Local terminal",
  in_vm_daemon: "Pwnbox / VM",
  plugin: "Plugin",
};

/** Low-level session metadata — where/when the capture ran. Lives in the Session window section,
 *  not the identity band, which is reserved for the result and the takeaway. */
export function SessionFacts() {
  const { report, timeline } = useReport();
  const { session } = report;
  const facts: [string, string][] = [
    ["Date", new Date(session.started_at).toISOString().slice(0, 10)],
    ["Location", SOURCE_LABEL[session.source] ?? session.source],
    ["Duration", fmtDuration(timeline.totalMs)],
    ["Shell", session.shell || "—"],
    ["Context", session.context_path ?? "host"],
    ["Session", session.uuid.slice(0, 8)],
  ];
  return (
    <div className="mb-3 grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-3">
      {facts.map(([label, value]) => (
        <div key={label} className="flex flex-col gap-0.5">
          <span className="label text-xs text-faint">{label}</span>
          <span className="mono text-sm text-fg">{value}</span>
        </div>
      ))}
    </div>
  );
}
