import { useEffect, useState } from 'react';
import type { GridState } from '../../core/model/types';
import { mapRevisionOf } from '../../state/map-revision';
import { useVersioned } from '../primitives/use-versioned';
import { useMapRevision } from './use-map-revision';

/**
 * A value derived from a map that is edited in place, recomputed when `deps` change or the map's
 * revision moves. `grid` names the map: absent, the live map, heard as `useMapRevision` hears it
 * (`listening` and `timing` pass through); given, that grid's revision as of this render, which a
 * caller re-renders for.
 */
export function useMapDerived<T>(
  compute: () => T,
  deps: readonly unknown[],
  opts: { grid?: GridState | null; listening?: boolean; timing?: 'edit' | 'frame' } = {},
): T {
  const live = useMapRevision(!('grid' in opts) && (opts.listening ?? true), opts.timing ?? 'edit');
  const revision = 'grid' in opts ? mapRevisionOf(opts.grid) : live;
  return useVersioned(compute, [revision, ...deps]);
}

/** `grid`'s revision as of this render: what a painter keyed by revision is handed. */
export function useGridRevision(grid: GridState | null | undefined): string {
  return mapRevisionOf(grid);
}

/** `grid`'s revision once it has stood still for `quietMs`, so a costly derivation waits out a stroke. */
export function useSettledRevision(grid: GridState | null | undefined, quietMs: number): string {
  const now = mapRevisionOf(grid);
  const [settled, setSettled] = useState(now);
  useEffect(() => {
    if (now === settled) return undefined;
    const id = setTimeout(() => setSettled(now), quietMs);
    return () => clearTimeout(id);
  }, [now, settled, quietMs]);
  return settled;
}
