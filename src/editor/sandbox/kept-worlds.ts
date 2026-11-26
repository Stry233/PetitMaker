/**
 * Sandbox worlds kept across sessions in the figure cache, under the build that computed them: any
 * change of code or data is a new build, and a development server has no identity of its own, so it
 * keeps nothing. A read resolves undefined where nothing is kept, so a caller always has its own
 * build to fall back on.
 */
import type { GridState } from '../../core/model/types';
import { BUILD_NUMBER, BUILD_SHA } from '../../platform/build/build-info';
import { readFigureCache, writeFigureCache } from '../../platform/storage/figure-cache';
import { restoredWorld, storedWorld, type StoredWorld } from './stored-world';

let identity: string | null = BUILD_SHA === 'dev' ? null : `${BUILD_SHA}.${BUILD_NUMBER}`;

/** Test seam: the identity kept worlds are keyed by, null to keep none. */
export function __setKeptWorldIdentity(id: string | null): void {
  identity = id;
}

const keyOf = (templateId: string | undefined, part: string): string | null =>
  identity === null ? null : `${identity}|scene-world|${templateId ?? ''}|${part}`;

/** Whether this build keeps worlds at all. */
export const keepsWorlds = (): boolean => identity !== null;

/** The world kept as `part` of `templateId`'s worlds, or undefined. */
export async function keptWorld(templateId: string | undefined, part: string): Promise<GridState | undefined> {
  const key = keyOf(templateId, part);
  if (key === null) return undefined;
  const stored = await readFigureCache<StoredWorld>(key);
  return stored ? restoredWorld(templateId, stored) : undefined;
}

/** Keeps `state` as `part` of `templateId`'s worlds; the write drops what older builds kept. */
export function keepWorld(templateId: string | undefined, part: string, state: GridState): void {
  const key = keyOf(templateId, part);
  if (key === null) return;
  void writeFigureCache(key, storedWorld(state), `${identity}|`);
}
