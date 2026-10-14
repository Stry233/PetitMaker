/**
 * The pointer side of the region brush (`tools/pointer/region/region-brush.ts`), while the Generate panel
 * picks a region: a left press paints the terrain cell under it and owns the pointer until release,
 * a drag keeps painting, and a hovering pointer previews the cell a press would paint. A region is
 * a set of terrain cells, so every cell resolves on the terrain grid, through the same
 * `core/grid/pointer.ts` resolution the tools' `resolvePointer` uses; the brush is no `Tool`, so it
 * has no context for `resolvePointer` to write.
 */
import type { MacroCoord } from '../../../core/model/types';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { useEditorStore } from '../../../state/store';
import { cancelRegionStroke, finishRegionStroke, paintRegionCell, previewRegionCell } from '../../../tools/pointer/region';
import { cellUnder } from '../../../core/grid/pointer';
import { getActiveView } from '../../active-view';

function cellAt(x: number, y: number): MacroCoord | null {
  const view = getActiveView();
  return view ? cellUnder(view.projection, x, y, TERRAIN_GRID) : null;
}

export class RegionPointer {
  painting = false;

  /** Paints the cell under screen (x, y) and takes the pointer until release. */
  begin(x: number, y: number): void {
    const cell = cellAt(x, y);
    if (cell) paintRegionCell(cell);
    this.painting = true;
  }

  /** Paints the cell under a dragging pointer; false when no stroke is open. */
  move(x: number, y: number): boolean {
    if (!this.painting) return false;
    const cell = cellAt(x, y);
    if (cell) paintRegionCell(cell);
    return true;
  }

  /** While a region is being picked, hover belongs to the brush: previews the cell under (x, y)
   *  when `over` the map. False when no region is being picked. */
  hover(x: number, y: number, over: boolean): boolean {
    if (!useEditorStore.getState().selectingRegion) return false;
    const cell = over ? cellAt(x, y) : null;
    if (cell) previewRegionCell(cell);
    return true;
  }

  /** Closes the stroke into the region; false when no stroke is open. `time` is the release event's
   *  timestamp, which a multi-click figure's double-click window reads. */
  release(time?: number): boolean {
    if (!this.painting) return false;
    this.painting = false;
    finishRegionStroke(time);
    return true;
  }

  /** Drops the open stroke without changing the region. */
  cancel(): void {
    if (!this.painting) return;
    this.painting = false;
    cancelRegionStroke();
  }
}
