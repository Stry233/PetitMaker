import type { MacroCoord } from '../../../core/model/types';
import type { RegionTool } from '../../../state/editing/vocabulary';
import { brushCells, circleCells, lineCells, rectCells, snapShapeEnd, splineCells } from '../../../core/grid/shapes';

/** How big the map is, for the two helpers below. */
export interface MapExtent { w: number; h: number }

/**
 * A dragged box slid back onto the map, keeping the size it was grown to.
 *
 * Why it slides rather than clips. A figure with a minimum side is grown in the drag's own
 * direction, and a drag that starts near an edge grows straight off the map: the cells beyond it are
 * dropped and the region arrives short of the floor that pushed it there, so the drag can never
 * satisfy its own minimum however far it is pulled. At an edge there is only one direction left, so
 * the whole figure moves that way instead. A box wider than the map has nowhere to go and sits at
 * its edge, clipped — which is the one case where the floor genuinely cannot be met.
 */
function slideOnMap(
  anchor: { x: number; y: number }, end: { x: number; y: number }, map: MapExtent,
): { anchor: { x: number; y: number }; end: { x: number; y: number } } {
  const shift = (a: number, b: number, size: number): number => {
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const back = hi > size - 1 ? size - 1 - hi : 0;
    return lo + back < 0 ? -lo : back;
  };
  const dx = shift(anchor.x, end.x, map.w), dy = shift(anchor.y, end.y, map.h);
  return {
    anchor: { x: anchor.x + dx, y: anchor.y + dy },
    end: { x: end.x + dx, y: end.y + dy },
  };
}

/** The same for a figure drawn from its centre: the centre moved in far enough that a radius fits
 *  either side of it, or held at the middle where the figure is wider than the map. */
function clampCentre(centre: number, radius: number, size: number): number {
  const lo = radius, hi = size - 1 - radius;
  if (hi < lo) return (size - 1) >> 1;
  return Math.min(hi, Math.max(lo, centre));
}

/** Region stamps use cell indices, independently of the terrain brush's half-cell pointer offset. */
export function regionShapeCells(tool: RegionTool, pointer: MacroCoord, size: number, options: {
  anchor?: MacroCoord | null;
  /** The anchors a curve runs through, the pointer's included; empty before its first anchor. */
  curve?: readonly MacroCoord[];
  constrain: boolean;
  minSide: number | null;
  map: MapExtent | null;
}): MacroCoord[] {
  let anchor = options.anchor ?? pointer;
  if (tool === 'free' || tool === 'erase') return brushCells(pointer.x, pointer.y, size);
  if (tool === 'curve') {
    const through = options.curve ?? [];
    return through.length > 0 ? splineCells(through, size) : lineCells(pointer, pointer, size);
  }
  let end = options.constrain ? snapShapeEnd(anchor, pointer, tool) : pointer;
  if (options.minSide !== null && (tool === 'rect' || tool === 'circle')) {
    const least = tool === 'rect' ? options.minSide - 1 : Math.ceil((options.minSide - 1) / 2);
    const grow = (from: number, to: number) => from + (to < from ? -1 : 1) * Math.max(least, Math.abs(to - from));
    end = { x: grow(anchor.x, end.x), y: grow(anchor.y, end.y) };
    if (options.map) {
      if (tool === 'rect') ({ anchor, end } = slideOnMap(anchor, end, options.map));
      else {
        const rx = Math.abs(end.x - anchor.x), ry = Math.abs(end.y - anchor.y);
        anchor = { x: clampCentre(anchor.x, rx, options.map.w), y: clampCentre(anchor.y, ry, options.map.h) };
        end = { x: anchor.x + rx, y: anchor.y + ry };
      }
    }
  }
  if (tool === 'rect') return rectCells(anchor, end);
  if (tool === 'circle') return circleCells(anchor, Math.abs(end.x - anchor.x), Math.abs(end.y - anchor.y));
  return lineCells(anchor, end, size);
}
