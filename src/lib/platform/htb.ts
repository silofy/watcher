import type { Machine, Target } from "../../types/report";
import type { PlatformAdapter } from "./types";
import { cidrConfidence, hueFor, ipsInScope, type DetectContext } from "./detect";

const DIFF_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = { Easy: 1, Medium: 2, Hard: 4, Insane: 5 };

function parseScope(scope?: string): { name: string; label?: string } {
  const ts = scope ?? "session";
  const name = (ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].split("—")[0].trim() || ts;
  const label = /\beasy\b/i.test(ts) ? "Easy" : /\bmedium\b/i.test(ts) ? "Medium" : /\bhard\b/i.test(ts) ? "Hard" : /\binsane\b/i.test(ts) ? "Insane" : undefined;
  return { name, label };
}

export const htbAdapter: PlatformAdapter = {
  id: "htb",
  label: "Hack The Box",
  kindNoun: "box",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "htb") return 1;
    if (/\bhtb|pwnbox|hackthebox\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^htb::/i.test(ctx.targetScope ?? "")) return 0.8;
    return cidrConfidence(ctx.targetIps ?? ipsInScope(ctx.targetScope), "htb");
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const scoped = parseScope(ctx.targetScope);
    const name = machine?.name ?? scoped.name;
    const label = machine?.difficulty ?? scoped.label;
    const difficulty = label && DIFF_LEVEL[label] ? { level: DIFF_LEVEL[label], label } : null;
    const slug = machine?.slug ?? name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return {
      platform: "htb",
      kind: "box",
      name,
      slug,
      os: machine?.os,
      difficulty,
      emblem: { avatar: machine?.avatar ?? null, hue: hueFor(name) },
      url: `https://app.hackthebox.com/machines/${slug}`,
    };
  },
  calibration: {
    difficultyColor: (label) => ({ Easy: "var(--color-match)", Medium: "var(--color-signal)", Hard: "var(--color-detour)", Insane: "var(--color-skipped)" }[label]),
  },
};
