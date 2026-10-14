import type { Corners, GridState } from './types';
import { FNV_BASIS, fnv1aStep } from '../base/hash';
import { mapVersionKey } from './grid-model';

/**
 * The map as one short string: its cells, its objects and its locked layers.
 *
 * Everything a rule can read goes in, since what this answers is whether a command validated
 * against one map is still that command against another. It compares by content rather than by a
 * mutation counter, so a paint the user undid leaves the map eligible again, which is the honest
 * answer: that map is the map the run was built on.
 */
export function mapFingerprint(state: GridState): string {
  let h = FNV_BASIS;
  let g = 0x2545f491;
  const mix = (v: number): void => {
    h = fnv1aStep(h, v);
    g = Math.imul(g ^ (v >>> 0), 0x85ebca6b) + 0x6b43a9b5;
  };
  const mixText = (s: string): void => {
    mix(s.length);
    for (let i = 0; i < s.length; i++) mix(s.charCodeAt(i));
  };
  const mixCorners = (corners: Corners | undefined): void => {
    if (!corners) { mix(0); return; }
    mix(1);
    for (const c of corners) mixText(c);
  };

  mix(state.ignoreChunkLoad ? 1 : 0);
  mix(state.template.width);
  mix(state.template.height);
  for (const row of state.cells) {
    for (const cell of row) {
      mix(cell.zone);
      // A session rim cell's kept ground, offset past the 0 or 1 terrain flag that follows; other cells add nothing.
      if (cell.under !== undefined) mix(cell.under + 8);
      const t = cell.terrain;
      if (!t) { mix(0); continue; }
      mix(1);
      mix(t.type);
      mix(t.elevation);
      mix(t.patchOnly ? 1 : 0);
      mix((t.patchBase ?? -1) + 1);
      mixCorners(t.corners);
    }
  }
  // Insertion order counts. Two maps that reached the same objects by different routes read as
  // different maps here, which costs a rebuild and never a wrong result.
  for (const obj of state.objects.values()) {
    mixText(obj.id);
    mixText(obj.catalogId);
    mixText(`${obj.position.x},${obj.position.y},${obj.rotation},${obj.elevation}`);
    mixText(`${obj.spanLength ?? ''},${obj.width ?? ''},${obj.height ?? ''},${obj.color ?? ''}`);
    mix(obj.locked ? 1 : 0);
    mix(obj.patchOnly ? 1 : 0);
    mixCorners(obj.corners);
  }
  for (const layer of [...state.lockedLayers].sort((a, b) => a - b)) mix(layer);
  return `${h >>> 0}.${g >>> 0}`;
}

/** A map's fingerprint with the version key it was read at, and the map object it was read from:
 *  the version counters belong to one map. */
export interface MapStamp {
  readonly map: GridState;
  readonly key: string;
  readonly fingerprint: string;
}

export function stampMap(state: GridState): MapStamp {
  return { map: state, key: mapVersionKey(state), fingerprint: mapFingerprint(state) };
}

/** Whether `state` is the stamped map and still holds what `stamp` read. Every edit bumps a version,
 *  so an unchanged key answers without hashing; a moved key falls back to the content, so an undone
 *  edit still matches. A replaced map never matches, whatever its counters or content. */
export function stillStamped(state: GridState, stamp: MapStamp): boolean {
  if (state !== stamp.map) return false;
  return mapVersionKey(state) === stamp.key || mapFingerprint(state) === stamp.fingerprint;
}
