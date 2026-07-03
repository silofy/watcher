import type { Machine, Target } from "../../types/report";
import type { PlatformAdapter } from "./types";
import { hueFor, type DetectContext } from "./detect";

export const offsecAdapter: PlatformAdapter = {
  id: "offsec",
  label: "OffSec",
  kindNoun: "lab",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "offsec") return 1;
    if (/\boffsec|proving\s*grounds|pwk\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^offsec::/i.test(ctx.targetScope ?? "")) return 0.8;
    return 0;
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const ts = ctx.targetScope ?? "lab";
    const name = machine?.name ?? ((ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].trim() || ts);
    return { platform: "offsec", kind: "lab", name, os: machine?.os, difficulty: null, emblem: { avatar: null, hue: hueFor(name) }, url: null };
  },
};
