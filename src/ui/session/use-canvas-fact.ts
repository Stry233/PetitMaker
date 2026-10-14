import { useState } from 'react';
import type { GridState } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { useMapRevision } from './use-map-revision';

/** `read(state)` for the live canvas, re-read when the map is replaced and at most once a frame
 *  while its cells or objects change (`useMapRevision(…, 'frame')`). A reading `same` as the last
 *  keeps the last value, so a fact held by value renders only when it moves. */
export function useCanvasFact<T>(read: (state: GridState | null) => T, same: (a: T, b: T) => boolean = Object.is): T {
  const grid = useEditorStore((s) => s.gridState);
  const revision = useMapRevision(true, 'frame');
  const [held, setHeld] = useState(() => ({ grid, revision, value: read(grid) }));
  if (held.grid === grid && held.revision === revision) return held.value;
  const next = read(grid);
  const value = same(held.value, next) ? held.value : next;
  setHeld({ grid, revision, value });
  return value;
}
