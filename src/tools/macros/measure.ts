/**
 * What a macro actually changed.
 *
 * Counted by object id rather than by map size: laying a road network sweeps decorations out of a
 * crossing's clearance, so a size delta nets those removals against the roads and can report zero
 * for a run that paved half the island.
 */
import { getCell } from '../../core/model/grid-model';
import type { GridState, MacroCell } from '../../core/model/types';

/** Call before the macro body; the returned function counts the objects whose presence differs
 *  since — arrivals PLUS departures. A run whose only effect was removing objects still leaves an
 *  undo entry on the stack, so counting arrivals alone would report nothing happened to a caller
 *  that has an entry to undo. */
export function objectsChanged(state: GridState): () => number {
  const before = new Set(state.objects.keys());
  return () => {
    let changed = 0;
    for (const id of state.objects.keys()) if (!before.has(id)) changed++;
    for (const id of before) if (!state.objects.has(id)) changed++;
    return changed;
  };
}

/** Legacy point builders count structural changes; complete gestures also count corner edits. */
function terrainMark(cell: MacroCell | null, includeCorners: boolean): string {
  const t = cell?.terrain;
  if (includeCorners) return JSON.stringify(t);
  return t ? `${t.type}:${t.elevation}:${t.patchOnly ? 1 : 0}` : '';
}

/** Call before the macro body; the returned function counts the cells whose terrain differs since.
 *  The terrain macros lay no objects, so `changes` is otherwise zero for a run that raised a hill. */
export function cellsChanged(state: GridState, includeCorners = false): () => number {
  const { width, height } = state.template;
  const before: string[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) before.push(terrainMark(getCell(state.cells, x, y), includeCorners));
  return () => {
    let changed = 0, i = 0;
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++, i++) {
      if (terrainMark(getCell(state.cells, x, y), includeCorners) !== before[i]) changed++;
    }
    return changed;
  };
}
