/**
 * Pure geometry for the Ctrl+drag rubber band. Both functions operate on MACRO (map) coordinates,
 * never screen coordinates: the band is a map rectangle, so a camera move mid-drag does not
 * change what it covers.
 */
import type { GridState, MacroCoord } from '../../core/model/types';
import { rectsOverlap, type Rect } from '../../core/model/grid-model';
import { entriesNear, getObjectIndex } from '../../state/object-index';

export type MacroRect = Rect;

/** Normalises a drag between two macro cells into an axis-aligned rect covering
 *  both endpoint cells, whichever direction the drag ran (each cell spans one
 *  unit, so the extent is the endpoint delta plus one). */
export function macroRect(a: MacroCoord, b: MacroCoord): MacroRect {
  const x0 = Math.min(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  return { x: x0, y: y0, w: Math.max(a.x, b.x) - x0 + 1, h: Math.max(a.y, b.y) - y0 + 1 };
}

/** Ids of objects whose footprint INTERSECTS `rect` — containment would make a
 *  large building nearly unselectable by band. Collected through the object
 *  index (never a scan of state.objects), so a band over a generated map costs
 *  the rect's chunk span, not the map's object count. */
export function objectsInBand(state: GridState, rect: MacroRect): string[] {
  const out: string[] = [];
  for (const entry of entriesNear(getObjectIndex(state), rect)) {
    if (rectsOverlap(entry.rect, rect)) out.push(entry.obj.id);
  }
  return out;
}
