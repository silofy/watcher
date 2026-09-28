import type { DefenseGrade } from "../lib/defense/types";

export function DefenseRubric({ grade }: { grade: DefenseGrade }) {
  return (
    <div>
      <div className="flex items-baseline gap-3">
        <span className="font-display text-4xl" style={{ color: "var(--color-signal)" }}>{grade.letter}</span>
        <span className="mono text-lg text-fg">{grade.score}</span>
        <span className="label text-faint">defensive investigation</span>
      </div>
      <div className="mt-3 space-y-1">
        {grade.metrics.map((m) => (
          <div key={m.name} className="flex items-center justify-between text-sm">
            <span className="text-muted">{m.name}</span>
            <span className="mono text-fg">{m.score} <span className="text-faint">· {Math.round(m.weight * 100)}% · +{m.points}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}
