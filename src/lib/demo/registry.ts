import type { DemoDef } from "./build";
import { ABDUCTED } from "./abducted";
import { ROOTME } from "./rootme";

export const DEMOS: DemoDef[] = [ABDUCTED, ROOTME];
export const LEGACY_DEMO_ID = DEMOS[0].id;

const BY_ID = new Map(DEMOS.map((d) => [d.id, d]));
export function demoById(id: string): DemoDef | undefined { return BY_ID.get(id); }
export function isDemoId(id: string): boolean { return BY_ID.has(id); }
