import type { MacroCoord, RegionTool } from '../../core/model/types';
import { clampCentre, slideOnMap, type MapExtent } from '../../core/runtime/region-brush';
import { circleCells, curveCells, lineCells, rectCells, snapShapeEnd } from './shapes';

/** Region stamps use cell indices, independently of the terrain brush's half-cell pointer offset. */
export function regionShapeCells(tool: RegionTool, pointer: MacroCoord, size: number, options: {
  anchor?: MacroCoord | null;
  curve?: readonly MacroCoord[];
  constrain: boolean;
  minSide: number | null;
  map: MapExtent | null;
}): MacroCoord[] {
  let anchor = options.anchor ?? pointer;
  if (tool === 'brush' || tool === 'eraser') {
    const half = Math.floor((size - 1) / 2);
    return rectCells({ x: pointer.x - half, y: pointer.y - half }, { x: pointer.x - half + size - 1, y: pointer.y - half + size - 1 });
  }
  if (tool === 'curve') {
    const points = options.curve ?? [];
    if (points.length >= 2) return curveCells(points[0]!, points[1]!, pointer, size);
    anchor = points[0] ?? pointer;
    return lineCells(anchor, options.constrain ? snapShapeEnd(anchor, pointer, 'line') : pointer, size);
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
