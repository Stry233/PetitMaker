/**
 * The standing marks follow the active view: the generate region's highlight and the path drape
 * (the maze's way).
 *
 * Both are imperative: the scope screen, the assistant panel and the region brush tell the active
 * overlay what region to show, the maze shelf what way to drape, and a generation landing tells
 * them to clear. Only one overlay hears each call, so a 2D↔3D swap would otherwise register an
 * overlay that never heard of the mark, and leave the outgoing one showing a mark that may be
 * cleared while it is off screen. The last request is kept here and re-applied to whichever overlay
 * the registry points at, on the `onActiveViewChange` signal rather than `viewMode` for the reason
 * `selection-view-sync.ts` gives: the store flip and the registration are separate moments.
 */
import { onActiveViewChange, getActiveView } from '../../active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { MacroCoord } from '../../../core/model/types';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { cellSet, type CellSet } from '../../../core/grid/grids';

/** The marks last asked for: the region's cells (null after a clear; an empty show is a clear)
 *  and the drape's cells (null after a clear). */
let shown: { region: { cells: MacroCoord[]; dimensionScale?: number } | null; path: CellSet | null } = { region: null, path: null };

export function showBuildableRegion(cells: MacroCoord[], dimensionScale?: number): void {
  shown = { ...shown, region: cells.length > 0 ? { cells: [...cells], dimensionScale } : null };
  getActiveView()?.overlay.showBuildableRegion(cellSet(TERRAIN_GRID, cells), dimensionScale);
}

export function clearBuildableRegion(): void {
  shown = { ...shown, region: null };
  getActiveView()?.overlay.clearBuildableRegion();
}

export function showPath(cells: CellSet): void {
  shown = { ...shown, path: cells };
  getActiveView()?.overlay.showPath(cells);
}

export function clearPath(): void {
  shown = { ...shown, path: null };
  getActiveView()?.overlay.clearPath();
}

/** The active-view signal's handler. */
function syncMarksToView(view: ActiveView | null, previous: ActiveView | null): void {
  if (previous && previous.overlay !== view?.overlay) {
    previous.overlay.clearBuildableRegion();
    previous.overlay.clearPath();
  }
  if (!view) return;
  if (shown.region) view.overlay.showBuildableRegion(cellSet(TERRAIN_GRID, shown.region.cells), shown.region.dimensionScale);
  if (shown.path) view.overlay.showPath(shown.path);
}

/** Subscribe the marks to the active-view signal. Returns the unsubscribe. */
export function installOverlayViewSync(): () => void {
  return onActiveViewChange(syncMarksToView);
}
