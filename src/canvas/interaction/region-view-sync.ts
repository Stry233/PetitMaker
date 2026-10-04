/**
 * The generate region's highlight follows the active view.
 *
 * The highlight is imperative: the scope screen, the assistant panel and the region brush tell the
 * ACTIVE overlay what to show, and a generation landing tells it to clear. Only one overlay hears
 * each call, so a 2D↔3D swap would otherwise register an overlay that never heard of the region a
 * person just painted. The last request is kept here and re-applied to whichever overlay the
 * registry points at, on the `onActiveViewChange` signal rather than `viewMode` for the reason
 * `selection-view-sync.ts` gives: the store flip and the registration are separate moments.
 */
import { onActiveViewChange, getActiveView } from '../active-view';
import type { ActiveView } from '../view-projection';
import type { MacroCoord } from '../../core/model/types';

/** The cells last asked for, or null after a clear. An empty show is a clear. */
let shown: { cells: MacroCoord[]; dimensionScale?: number } | null = null;

export function showBuildableRegion(cells: MacroCoord[], dimensionScale?: number): void {
  shown = cells.length > 0 ? { cells: [...cells], dimensionScale } : null;
  getActiveView()?.overlay.showBuildableRegion(cells, true, dimensionScale);
}

export function clearBuildableRegion(): void {
  shown = null;
  getActiveView()?.overlay.clearBuildableRegion();
}

/** The active-view signal's handler. */
function syncRegionToView(view: ActiveView | null, previous: ActiveView | null): void {
  if (previous && previous.overlay !== view?.overlay) previous.overlay.clearBuildableRegion();
  if (view && shown) view.overlay.showBuildableRegion(shown.cells, true, shown.dimensionScale);
}

/** Subscribe the highlight to the active-view signal. Returns the unsubscribe. */
export function installRegionViewSync(): () => void {
  return onActiveViewChange(syncRegionToView);
}
