import { useReport } from "../store/report";
import { groupFindingsByKind } from "../lib/findings-view";

/** Evidence extracted from the run (schema v1.2) — grouped by kind, deep-linking back to the
 *  command that produced each one. */
export function Findings() {
  // Default *outside* the selector: `?? []` inside would allocate a fresh array every render, so
  // zustand's snapshot never compares equal → infinite re-render (max update depth) on any report
  // whose schema predates `findings`. Return the stored reference (or undefined) and default here.
  const findings = useReport((s) => s.report.findings) ?? [];
  const reveal = useReport((s) => s.reveal);
  if (!findings.length) return null;

  const groups = groupFindingsByKind(findings);

  return (
    <div className="flex flex-col gap-2">
      {groups.map(([kind, list]) => (
        <div key={kind}>
          <div className="label text-faint">{kind}</div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {list.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => reveal(f.source_seq)}
                className="mono rounded border border-edge px-1.5 py-0.5 text-xs hover:border-signal"
                title={`from step #${f.source_seq}`}
              >
                {f.masked ? "••••" : f.value}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
