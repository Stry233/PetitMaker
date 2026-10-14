/** What the map holds under a window point, read through the active view. */
import { getActiveView } from '../../view/active-view';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { mapChunkAt, mapFrame } from '../../core/grid/map-chunks';
import { useEditorStore } from '../../state/store';
import { cellUnder } from '../../core/grid/pointer';

/** The chunk under client point `x`, `y`, or null where the point is off the map's frame. */
export function chunkAtClient(x: number, y: number): { cx: number; cy: number } | null {
  const view = getActiveView();
  const cell = view && cellUnder(view.projection, x, y, PLACEMENT_GRID);
  const grid = useEditorStore.getState().gridState;
  if (!cell || !grid) return null;
  const frame = mapFrame(grid.template);
  if (cell.x < frame.x || cell.y < frame.y || cell.x >= frame.x + frame.width || cell.y >= frame.y + frame.height) return null;
  const { cx, cy } = mapChunkAt(grid.template, cell.x, cell.y);
  return { cx, cy };
}
