/**
 * The selection ring follows the store and the active view.
 *
 * The selection lives in the store; the ring that shows it is drawn into ONE view's overlay. Both
 * facts are kept true here, in one place, so every path that changes a selection — a click, a
 * marquee, Ctrl+A, the delete popover, an agent tool, an undo — draws the same ring without
 * arranging it for itself.
 *
 * Three signals feed it:
 *  - the SELECTION changing: repaint the active view (an emptied selection clears, since
 *    `paintSelection` clears on an empty list).
 *  - the LAYER-NUMBER toggle: a single selection labels its own elevation only while the global
 *    numbers are off, so the ring is redrawn when that flips.
 *  - the ACTIVE VIEW changing: a 2D↔3D swap moves the ring, and the outgoing overlay drops what it
 *    was holding, or switching back reveals a ring where the selection no longer is. Hung off
 *    `onActiveViewChange` rather than `viewMode`, because the store flip and the registration are
 *    separate moments (see canvas/active-view.ts) and the repaint needs the overlay that is
 *    actually registered.
 *
 * Geometry that moves UNDER a selection (a committed drag, a rotation) changes no selection state,
 * so each canvas repaints its own ring on `objects-changed`; a rotation tween drives the ring
 * frame by frame through `paintRotationRing`.
 *
 * A selection is only meaningful while a click can make one, so the mode rule lives here too:
 * switching to a tool that cannot hold a selection drops it.
 */
import { onActiveViewChange, getActiveView } from '../active-view';
import type { ActiveView } from '../view-projection';
import { useEditorStore } from '../../state/store';
import { canHoldSelection } from './selection-hover';
import { paintSelection } from './usePointerInteraction';

/** Draw the current selection into the active view. */
function repaint(): void {
  const view = getActiveView();
  const store = useEditorStore.getState();
  if (!view || !store.gridState) return;
  paintSelection(view.overlay, store.gridState, store.selection, store.showLayerNumbers);
}

/** The active-view signal's handler, exported so the behavior is testable without a canvas. */
export function syncSelectionToView(view: ActiveView | null, previous: ActiveView | null): void {
  // Same overlay (a re-registration of the same view) → skip the clear; the repaint below rewrites it.
  if (previous && previous.overlay !== view?.overlay) previous.overlay.clearSelection();
  repaint();
}

/** Subscribe the ring to the store and the active-view signal. Returns the unsubscribe. */
export function installSelectionViewSync(): () => void {
  const offView = onActiveViewChange(syncSelectionToView);
  const offStore = useEditorStore.subscribe((state, prev) => {
    if (state.selection.length > 0 && !canHoldSelection(state.activeTool)) {
      useEditorStore.getState().clearSelection();
      return; // the clear publishes its own update, which repaints
    }
    if (state.selection !== prev.selection || state.showLayerNumbers !== prev.showLayerNumbers) repaint();
  });
  return () => { offView(); offStore(); };
}
