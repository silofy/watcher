import type { DemoDef } from "./build";
import { ABDUCTED } from "./abducted";
import { ROOTME } from "./rootme";

export const DEMOS: DemoDef[] = [ABDUCTED, ROOTME];
export const LEGACY_DEMO_ID = DEMOS[0].id;

const BY_ID = new Map(DEMOS.flatMap((d) => [[d.id, d], [d.slug, d]] as const));
export function demoById(idOrSlug: string): DemoDef | undefined { return BY_ID.get(idOrSlug); }
export function isDemoId(idOrSlug: string): boolean { return BY_ID.has(idOrSlug); }
