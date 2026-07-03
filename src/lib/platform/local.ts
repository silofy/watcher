import type { Machine, Target } from "../../types/report";
import { hueFor } from "../machine";
import type { PlatformAdapter } from "./types";
import type { DetectContext } from "./detect";

export const localAdapter: PlatformAdapter = {
  id: "local",
  label: "Local / CTF",
  kindNoun: "host",
  detect: () => 0.1, // guaranteed floor so resolveAdapter always has a winner
  identify(machine: Machine | undefined, ctx: DetectContext): Target {
    const raw = ctx.targetScope ?? "session";
    const name = machine?.name ?? (raw.replace(/\s*\(.*\)\s*/, "").trim() || "Local capture");
    return { platform: "local", kind: "host", name, os: machine?.os, difficulty: null, emblem: { avatar: null, hue: hueFor(name) }, url: null };
  },
};
