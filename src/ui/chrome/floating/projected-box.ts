/** Where a map rect stands on screen, through whatever projection the active view gives. */
import type { ViewProjection } from '../../../tools/pointer/runtime';
import { rectsBounds, type Rect } from '../../../core/grid/rect';
import type { GridState } from '../../../core/model/types';
import { liveMembers, type PlacedGroup } from '../../../core/model/placed-group';
import { terrainCellRect } from '../../../core/grid/grid-convert';
import type { ScreenBounds } from './selection-card-layout';

/** The screen box of a map rect: the bounds of its four projected corners, so a turned or tilted
 *  view gives the box the rect really covers; null when a corner stands behind the camera. */
export function projectedBox(proj: ViewProjection, { x, y, w, h }: Rect): ScreenBounds | null {
  const corners = [proj.cellToScreen(x, y), proj.cellToScreen(x + w, y), proj.cellToScreen(x, y + h), proj.cellToScreen(x + w, y + h)];
  if (corners.some((p) => p.behind)) return null;
  const xs = corners.map((p) => p.x), ys = corners.map((p) => p.y);
  const left = Math.min(...xs), top = Math.min(...ys);
  return { x: left, y: top, w: Math.max(...xs) - left, h: Math.max(...ys) - top };
}

/** The screen box of a placed blueprint: its frame, the objects' bodies and every laid terrain cell,
 *  which sit a half cell off the object grid the frame is on; null when none can be placed. */
export function groupScreenBox(proj: ViewProjection, state: GridState, group: PlacedGroup): ScreenBounds | null {
  const { objects, cells } = liveMembers(state, group);
  const boxes = [
    projectedBox(proj, group.frame),
    ...cells.map((c) => projectedBox(proj, terrainCellRect(c))),
    ...objects.map((o) => proj.objectScreenBox?.(o.id) ?? null),
  ].filter((b): b is ScreenBounds => !!b);
  return rectsBounds(boxes);
}
