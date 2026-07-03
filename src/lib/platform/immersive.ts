import type { Machine, Target } from "../../types/report";
import { hueFor } from "../machine";
import type { PlatformAdapter } from "./types";
import type { DetectContext } from "./detect";

export const immersiveAdapter: PlatformAdapter = {
  id: "immersive",
  label: "Immersive Labs",
  kindNoun: "lab",
  detect(ctx: DetectContext) {
    if (ctx.platformHint === "immersive") return 1;
    if (/\bimmersive\b/i.test(ctx.contextPath ?? "")) return 0.9;
    if (/^immersive::/i.test(ctx.targetScope ?? "")) return 0.8;
    return 0;
  },
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const ts = ctx.targetScope ?? "lab";
    const name = machine?.name ?? ((ts.includes("::") ? ts.split("::")[1] : ts).split("(")[0].trim() || ts);
    return { platform: "immersive", kind: "lab", name, os: machine?.os, difficulty: null, emblem: { avatar: null, hue: hueFor(name) }, url: null };
  },
};
