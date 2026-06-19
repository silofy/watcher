import { useMemo, useState, type ReactNode } from "react";
import { ReactFlow, Background, BackgroundVariant, Handle, Position, type Node, type Edge, type NodeMouseHandler } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { useReport } from "../store/report";
import { ALIGNMENT_COLORS } from "../lib/scale";
import { detectFlags } from "../lib/flags";
import type { Episode, GoldenObjective } from "../types/report";

const FLAG_LABEL = { user: "User flag", system: "System flag" } as const;

const GLYPH: Record<string, string> = { match: "✓", alternative: "~", out_of_order: "⤺", detour: "!", skipped: "○" };
const STATUS_WORD: Record<string, string> = { match: "You did this", alternative: "Alt method", out_of_order: "Out of order", detour: "Off-path", skipped: "Skipped" };

// Invisible handles on every side; edges pick a side per relationship (spine = bottom→top,
// branch to a deviation = right→left). Read-only, so connections are disabled.
const HANDLE = { width: 1, height: 1, minWidth: 0, minHeight: 0, opacity: 0, border: "none" } as const;
function ObjNode({ data }: { data: { label: ReactNode } }) {
  return (
    <>
      <Handle type="target" position={Position.Top} id="top" style={HANDLE} isConnectable={false} />
      <Handle type="target" position={Position.Left} id="left" style={HANDLE} isConnectable={false} />
      {data.label}
      <Handle type="source" position={Position.Bottom} id="bottom" style={HANDLE} isConnectable={false} />
      <Handle type="source" position={Position.Right} id="right" style={HANDLE} isConnectable={false} />
    </>
  );
}
const nodeTypes = { obj: ObjNode };

function statusOf(o: GoldenObjective, epBySeq: Map<number, Episode>) {
  const seq = o.user_satisfied_by_seq ?? null;
  if (seq == null) return { status: "skipped", color: ALIGNMENT_COLORS.skipped, seq: null };
  const align = epBySeq.get(seq)?.alignment ?? "match";
  return { status: align, color: ALIGNMENT_COLORS[align] ?? ALIGNMENT_COLORS.match, seq };
}

/** Topological depth per objective (prerequisites are deeper-earlier). */
function depthMap(golden: GoldenObjective[]) {
  const byId = new Map(golden.map((o) => [o.objective, o]));
  const cache = new Map<string, number>();
  const depth = (id: string, stack = new Set<string>()): number => {
    if (cache.has(id)) return cache.get(id)!;
    if (stack.has(id)) return 0;
    stack.add(id);
    const deps = (byId.get(id)?.depends_on ?? []).filter((d) => byId.has(d));
    const d = deps.length ? 1 + Math.max(...deps.map((dep) => depth(dep, stack))) : 0;
    stack.delete(id);
    cache.set(id, d);
    return d;
  };
  const m = new Map<string, number>();
  for (const o of golden) m.set(o.objective, depth(o.objective));
  return m;
}

/** The intended attack graph (golden DAG) — nodes = objectives, edges = prerequisites; colored by
 *  what you did (teal), did differently (cyan), did out of order (coral), or skipped (slate). */
export function PathGraph() {
  const s = useReport();
  const { report, timeline } = s;
  const [selObj, setSelObj] = useState<string | null>(null);

  // flags are telemetry milestones (reading user.txt / root.txt); pin each onto the node its seq satisfied
  const flagBySeq = useMemo(() => {
    const f = detectFlags(report.episodes);
    const m = new Map<number, "user" | "system">();
    if (f.user != null) m.set(f.user, "user");
    if (f.system != null) m.set(f.system, "system");
    return m;
  }, [report.episodes]);

  const { nodes, edges, extent } = useMemo(() => {
    const golden = report.golden_dag;
    const epBySeq = new Map(report.episodes.map((e) => [e.seq, e]));
    const byId = new Map(golden.map((o) => [o.objective, o]));
    const depths = depthMap(golden);

    // top-down by depth; intended (matched) on the LEFT spine, deviations on the RIGHT
    const perCell = new Map<string, number>();
    const pos = new Map<string, { x: number; y: number }>();
    for (const o of golden) {
      const d = depths.get(o.objective) ?? 0;
      const onPath = statusOf(o, epBySeq).status === "match";
      const side = onPath ? 0 : 1;
      const key = `${d}:${side}`;
      const idx = perCell.get(key) ?? 0;
      perCell.set(key, idx + 1);
      pos.set(o.objective, { x: (onPath ? 0 : 360) + idx * 220, y: d * 122 });
    }

    // bounding box of the placed nodes, so the canvas can't pan into empty space
    const NODE_W = 196;
    const NODE_H = 74;
    const PAD = 80;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pos.values()) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + NODE_W);
      maxY = Math.max(maxY, p.y + NODE_H);
    }
    const extent: [[number, number], [number, number]] = pos.size
      ? [
          [minX - PAD, minY - PAD],
          [maxX + PAD, maxY + PAD],
        ]
      : [
          [-300, -300],
          [900, 900],
        ];

    const nodes: Node[] = golden.map((o) => {
      const st = statusOf(o, epBySeq);
      const flag = st.seq != null ? flagBySeq.get(st.seq) : undefined;
      return {
        id: o.objective,
        type: "obj",
        position: pos.get(o.objective) ?? { x: 0, y: 0 },
        draggable: false,
        data: {
          seq: st.seq,
          label: (
            <div className="min-w-0">
              {flag && (
                <div
                  className="mb-1 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold"
                  style={{ color: "var(--color-ink)", background: "var(--color-flag)" }}
                >
                  ⚑ {FLAG_LABEL[flag]} captured
                </div>
              )}
              <div className="truncate font-semibold" style={{ color: st.color }}>
                {GLYPH[st.status] ?? "•"} {o.objective.replace(/_/g, " ")}
              </div>
              <div className="mono truncate text-xs opacity-70">{o.satisfied_by[0]}</div>
              <div className="text-xs opacity-60">{st.seq != null ? `step ${st.seq} · ${st.status.replace("_", "-")}` : "never attempted"}</div>
            </div>
          ),
        },
        style: {
          width: 196,
          borderRadius: 6,
          border: `1.5px ${st.status === "skipped" ? "dashed" : "solid"} ${st.color}`,
          background: "var(--color-panel)",
          padding: "7px 9px",
          color: "var(--color-fg)",
          fontSize: 12,
          textAlign: "left" as const,
          opacity: st.status === "skipped" ? 0.7 : 1,
          // milestone nodes get a gold ring so the flags pop out of the path
          boxShadow: flag ? "0 0 0 2px var(--color-flag)" : undefined,
        },
      };
    });

    // matched/DID nodes flow down the spine (bottom→top); any edge touching a deviation branches
    // off the side (right→left), so the left column stays a clean vertical path.
    const onPath = (id: string) => statusOf(byId.get(id)!, epBySeq).status === "match";
    const edges: Edge[] = [];
    for (const o of golden)
      for (const dep of o.depends_on ?? [])
        if (byId.has(dep)) {
          const spine = onPath(dep) && onPath(o.objective);
          edges.push({
            id: `${dep}->${o.objective}`,
            source: dep,
            target: o.objective,
            sourceHandle: spine ? "bottom" : "right",
            targetHandle: spine ? "top" : "left",
            type: "straight",
            style: { stroke: "var(--color-edge-bright)", strokeWidth: 1.5 },
          });
        }

    return { nodes, edges, extent };
  }, [report.golden_dag, report.episodes, flagBySeq]);

  const onNodeClick: NodeMouseHandler = (_e, node) => {
    setSelObj((cur) => (cur === node.id ? null : node.id));
    const seq = (node.data as { seq?: number | null }).seq;
    if (seq != null) s.select(s.selectedSeq === seq ? null : seq);
  };
  const onNodeEnter: NodeMouseHandler = (_e, node) => {
    const seq = (node.data as { seq?: number | null }).seq;
    if (seq != null) s.hover(seq);
  };

  // selected-node detail for the aside
  const obj = selObj ? report.golden_dag.find((o) => o.objective === selObj) : undefined;
  const objSt = obj ? statusOf(obj, new Map(report.episodes.map((e) => [e.seq, e]))) : undefined;
  const objEp = objSt?.seq != null ? report.episodes.find((e) => e.seq === objSt.seq) : undefined;
  const objAt = objEp ? Math.round((timeline.bySeq.get(objEp.seq)?.t1 ?? 0) / 60_000) : null;

  return (
    <div className="flex flex-col gap-3 lg:flex-row">
      <div className="relative h-[560px] overflow-hidden rounded-lg border border-edge bg-ink/50 lg:flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          defaultViewport={{ x: 70, y: 28, zoom: 1.15 }}
          minZoom={0.4}
          maxZoom={1.5}
          translateExtent={extent}
          panOnScroll
          zoomOnScroll={false}
          nodesConnectable={false}
          proOptions={{ hideAttribution: true }}
          defaultEdgeOptions={{ type: "straight" }}
          onNodeClick={onNodeClick}
          onNodeMouseEnter={onNodeEnter}
          onNodeMouseLeave={() => s.hover(null)}
        >
          <Background variant={BackgroundVariant.Dots} gap={22} size={1} color="var(--color-edge)" />
        </ReactFlow>
      </div>

      {/* aside — detail for the clicked node */}
      <aside className="overflow-y-auto rounded-lg border border-edge bg-panel p-3.5 lg:h-[560px] lg:w-72 lg:shrink-0">
        {obj && objSt ? (
          <div className="space-y-3">
            <div>
              {objSt.seq != null && flagBySeq.get(objSt.seq) && (
                <div
                  className="mb-2 flex w-fit items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-semibold"
                  style={{ color: "var(--color-ink)", background: "var(--color-flag)" }}
                >
                  ⚑ {FLAG_LABEL[flagBySeq.get(objSt.seq)!]} captured here{objAt != null ? ` · ${objAt}m in` : ""}
                </div>
              )}
              <span className="label block" style={{ color: objSt.color }}>
                {GLYPH[objSt.status]} {STATUS_WORD[objSt.status] ?? objSt.status}
              </span>
              <h4 className="mt-1 font-display text-base font-semibold leading-tight text-fg">{obj.objective.replace(/_/g, " ")}</h4>
            </div>

            <div>
              <div className="label text-faint">Intended method</div>
              <div className="mono mt-0.5 text-sm text-fg">{obj.satisfied_by.join(" · ")}</div>
            </div>

            {obj.depends_on && obj.depends_on.length > 0 && (
              <div>
                <div className="label text-faint">Needs first</div>
                <div className="mt-0.5 text-xs text-muted">{obj.depends_on.map((d) => d.replace(/_/g, " ")).join(", ")}</div>
              </div>
            )}

            <div className="border-t border-edge pt-2.5">
              <div className="label text-faint">Your move</div>
              {objEp ? (
                <>
                  <div className="mt-0.5 text-sm" style={{ color: objSt.color }}>
                    {STATUS_WORD[objSt.status]} {objAt != null ? `· ${objAt}m in` : ""}
                  </div>
                  <div className="mono mt-1.5 truncate rounded bg-ink/60 px-2 py-1.5 text-xs text-muted">$ {objEp.cmd}</div>
                </>
              ) : (
                <div className="mt-0.5 text-sm text-detour">Never attempted — this is a gap in your route.</div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex h-full min-h-[8rem] items-center justify-center px-2 text-center text-sm text-faint">
            Click a node to inspect that objective — what it is, how it&apos;s meant to be done, and what you did.
          </div>
        )}
      </aside>
    </div>
  );
}
