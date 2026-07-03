import type { Machine, Target } from "../../types/report";
import type { PlatformAdapter } from "./types";
import { cidrConfidence, hueFor, ipsInScope, type DetectContext } from "./detect";

const DIFF_LEVEL: Record<string, 1 | 2 | 3 | 4 | 5> = { Info: 1, Easy: 1, Medium: 3, Hard: 4, Insane: 5 };

export const thmAdapter: PlatformAdapter = {
  id: "thm",
  label: "TryHackMe",
  kindNoun: "room",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "thm") return 1;
    if (/\bthm|tryhackme\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^thm::/i.test(ctx.targetScope ?? "")) return 0.8;
    return cidrConfidence(ctx.targetIps ?? ipsInScope(ctx.targetScope), "thm");
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const ts = ctx.targetScope ?? "room";
    const name = machine?.name ?? ((ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].trim() || ts);
    const label = machine?.difficulty;
    const difficulty = label && DIFF_LEVEL[label] ? { level: DIFF_LEVEL[label], label } : null;
    const slug = name.toLowerCase().replace(/[^a-z0-9]/g, "");
    return { platform: "thm", kind: "room", name, slug, os: machine?.os, difficulty, emblem: { avatar: null, hue: hueFor(name) }, url: `https://tryhackme.com/room/${slug}` };
  },
  // intendedPath added in Task 8
};
