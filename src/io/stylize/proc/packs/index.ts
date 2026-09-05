/*
 * The pack registry, and the order the shelf shows them in.
 *
 * A pack is a palette plus a drawing function; the field bake, the outlines and the substrate are
 * shared, so this list is the whole surface a new look has to join.
 */
import { aquarellePack } from './aquarelle';
import { coloredpencilPack } from './coloredpencil';
import { NEURAL_PACKS } from './neural';
import type { ProcPack } from './types';

export type { ProcPack, ProcPackId, ProcPackMeta } from './types';
export { PROC_PACK_META, isProcPackId, procPackMeta } from './manifest';

export const PROC_PACKS: readonly ProcPack[] = [aquarellePack, coloredpencilPack, ...NEURAL_PACKS];

const byId = new Map<string, ProcPack>(PROC_PACKS.map((p) => [p.id, p]));

export function procPack(id: string): ProcPack | undefined {
  return byId.get(id);
}
