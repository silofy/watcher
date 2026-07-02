import { techniqueName, techniqueDesc, techniqueUrl } from "../lib/attack";
import { openExternal } from "../lib/net";

/**
 * An ATT&CK technique id that reveals a rich hover card — name, plain-English description, and a link
 * to the canonical MITRE page — so "T1548" isn't a dead code the reader has to already know. The card
 * is visibility-hidden until hover (so it never intercepts pointer events), fades in, and stays open
 * while the cursor is over it so the MITRE link is clickable.
 */
export function TechniqueChip({ id }: { id: string }) {
  return (
    <span className="group/tt relative inline-block">
      <span className="mono cursor-help text-muted underline decoration-dotted decoration-faint/60 underline-offset-2 transition-colors group-hover/tt:text-fg">
        {id}
      </span>
      <span
        role="tooltip"
        className="invisible absolute left-1/2 top-full z-30 mt-2 w-64 -translate-x-1/2 rounded-lg border border-edge bg-panel p-3 text-left opacity-0 shadow-xl transition-opacity duration-150 group-hover/tt:visible group-hover/tt:opacity-100"
      >
        <span className="mono text-xs text-faint">{id}</span>
        <span className="mt-0.5 block font-display text-sm font-semibold text-fg">{techniqueName(id)}</span>
        <span className="mt-1.5 block text-xs leading-relaxed text-muted">{techniqueDesc(id)}</span>
        <a
          href={techniqueUrl(id)}
          onClick={(e) => {
            e.preventDefault();
            openExternal(techniqueUrl(id));
          }}
          className="mt-2 inline-block text-xs text-signal hover:underline"
        >
          MITRE ATT&amp;CK ↗
        </a>
      </span>
    </span>
  );
}
