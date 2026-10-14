/**
 * The selection ring follows the store and the active view, in one place, so every path that
 * changes a selection (click, marquee, Ctrl+A, the delete popover, an agent tool, undo) draws the
 * same ring. Signals:
 *  - the selection changing repaints the active view (an empty list clears);
 *  - the layer-number toggle, since a single selection labels its elevation only while the global
 *    numbers are off;
 *  - the active view changing, on `onActiveViewChange` rather than `viewMode` because the store flip
 *    and the overlay's registration are separate moments (view/active-view.ts); the outgoing
 *    overlay drops its ring;
 *  - `objects-changed` while something is selected, for geometry moving under the selection; a
 *    rotation tween drives the ring through `paintRotationRing`.
 */
import { onActiveViewChange, getActiveView } from '../../active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { useEditorStore } from '../../../state/store';
import { layerNumbersShown } from '../../../state/layer-utils';
import { selectedObjectIds } from '../../../state/selection';
import { paintSelection } from './selection-paint';

/** Draw the current selection into the active view. */
function repaint(): void {
  const view = getActiveView();
  const store = useEditorStore.getState();
  if (!view || !store.gridState) return;
  paintSelection(view.overlay, store.gridState, store.selection, layerNumbersShown(store));
}

/** The active-view signal's handler. */
function syncSelectionToView(view: ActiveView | null, previous: ActiveView | null): void {
  // Same overlay (a re-registration of the same view) → skip the clear; the repaint below rewrites it.
  if (previous && previous.overlay !== view?.overlay) previous.overlay.clearSelection();
  repaint();
}

/** A terrain-only selection cannot be affected by an object change. The 3D overlay defers the
 *  repaint, so it bounds the instance after the scene remeshes it. */
function repaintObjects(): void {
  if (selectedObjectIds(useEditorStore.getState().selection).length > 0) repaint();
}

/** Subscribe the ring to the store, the editor's objects and the active-view signal. Returns the
 *  unsubscribe. */
export function installSelectionViewSync(): () => void {
  const offView = onActiveViewChange(syncSelectionToView);
  const bus = useEditorStore.getState().eventBus;
  bus.on('objects-changed', repaintObjects);
  const offStore = useEditorStore.subscribe((state, prev) => {
    if (state.selection !== prev.selection || layerNumbersShown(state) !== layerNumbersShown(prev)) repaint();
  });
  return () => { offView(); offStore(); bus.off('objects-changed', repaintObjects); };
}
