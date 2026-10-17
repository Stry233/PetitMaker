/**
 * The plan notes a transfer carries. Notes run no map rules, so the destination takes a note
 * anywhere on its map and nowhere off it: what lands off the destination is left behind, as terrain
 * and objects that do not fit are, and its cells join the transfer's lost cells.
 */
import { HALVES, movedNote, zoneHalfCells, zoneWithHalfCells, type AnnotationsState, type MapAnnotation } from '../../../core/model/annotations';
import type { MacroCoord, MapTemplate } from '../../../core/model/types';

/** The notes as they arrive, and the destination cells of every note or zone cell left behind. */
export interface CarriedNotes {
  /** Absent when the source had none. */
  annotations?: AnnotationsState;
  lost: MacroCoord[];
}

/** The whole cell holding map point (x, y). */
const cellAt = (x: number, y: number): MacroCoord => ({ x: Math.floor(x), y: Math.floor(y) });

/**
 * `source`'s notes moved by `offset` onto `target`. A zone is cells, so it keeps the cells that land
 * on the map and goes only when none do; a chip, route or measurement is one figure, so it comes
 * along whole only when every point of it lands on the map, and is left behind whole otherwise.
 */
export function carriedNotes(source: AnnotationsState | undefined, offset: MacroCoord, target: MapTemplate): CarriedNotes {
  if (!source) return { lost: [] };
  const { width, height } = target;
  const onMap = (left: number, top: number, right: number, bottom: number): boolean =>
    left >= 0 && top >= 0 && right <= width && bottom <= height;
  const lost: MacroCoord[] = [];
  const items: MapAnnotation[] = [];
  for (const note of source.items) {
    const moved = movedNote(note, offset.x, offset.y);
    if (moved.kind === 'zone') {
      const kept: MacroCoord[] = [];
      let off = false;
      for (const c of zoneHalfCells(moved)) {
        if (onMap(c.x / HALVES, c.y / HALVES, (c.x + 1) / HALVES, (c.y + 1) / HALVES)) kept.push(c);
        else { off = true; lost.push(cellAt(c.x / HALVES, c.y / HALVES)); }
      }
      if (!off) items.push(moved);
      else if (kept.length > 0) items.push(zoneWithHalfCells(moved, kept));
      continue;
    }
    // A measurement's points name cells (each spans one cell from its corner); the others are points.
    const span = moved.kind === 'measure' ? 1 : 0;
    const points: readonly MacroCoord[] = moved.kind === 'chip' ? [moved] : moved.points;
    if (points.every((p) => onMap(p.x, p.y, p.x + span, p.y + span))) items.push(moved);
    else for (const p of points) lost.push(cellAt(p.x, p.y));
  }
  const annotations: AnnotationsState = {
    items,
    ...(source.customTags ? { customTags: source.customTags.map((t) => ({ ...t })) } : {}),
    visible: source.visible,
    locked: source.locked,
  };
  return { annotations, lost };
}
