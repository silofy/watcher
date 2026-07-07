import type { DemoDef } from "./build";
import { FORGE } from "./playthrough";

export const DEMOS: DemoDef[] = [FORGE];
export const LEGACY_DEMO_ID = DEMOS[0].id;

const BY_ID = new Map(DEMOS.map((d) => [d.id, d]));
export function demoById(id: string): DemoDef | undefined { return BY_ID.get(id); }
export function isDemoId(id: string): boolean { return BY_ID.has(id); }
