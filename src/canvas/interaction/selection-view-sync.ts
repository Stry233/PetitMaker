/**
 * The selection ring follows the ACTIVE view.
 *
 * A selection lives in the store, but the ring that shows it is drawn into ONE view's overlay — the
 * one that was active when the selection was made. A 2D↔3D swap therefore has to move it: the newly
 * visible overlay draws the rings for the current selection, and the outgoing one drops what it was
 * holding (otherwise switching back reveals a ring at a position the selection has since left).
 * `paintSelection` clears on an empty selection, so an emptied selection leaves no ring in either view.
 *
 * Hung off `onActiveViewChange` rather than on `viewMode`: the store flip and the registration are
 * separate moments (see canvas/active-view.ts), and the repaint needs the overlay that is actually
 * registered. Installed once, from App.
 */
import { onActiveViewChange } from '../active-view';
import type { ActiveView } from '../view-projection';
import { useEditorStore } from '../../state/store';
import { paintSelection } from './usePointerInteraction';

/** The signal's handler, exported so the behavior is testable without a canvas. */
export function syncSelectionToView(view: ActiveView | null, previous: ActiveView | null): void {
  // Same overlay (a re-registration of the same view) → skip the clear; the repaint below rewrites it.
  if (previous && previous.overlay !== view?.overlay) previous.overlay.clearSelection();
  const store = useEditorStore.getState();
  if (!view || !store.gridState) return;
  paintSelection(view.overlay, store.gridState, store.selection, store.showLayerNumbers);
}

/** Subscribe the sync to the active-view signal. Returns the unsubscribe. */
export function installSelectionViewSync(): () => void {
  return onActiveViewChange(syncSelectionToView);
}
