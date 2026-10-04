/**
 * The active-view registry: which map view (2D or 3D) currently owns pointer
 * input and tool feedback. Each canvas registers its view when it becomes the
 * visible one; the pointer machine and ToolManager read the CURRENT view here,
 * so mode switches re-point the whole tool layer in one place.
 *
 * "The active view changed" is an explicit SIGNAL (`onActiveViewChange`), not something a listener
 * infers from `viewMode`. The two facts are not simultaneous: the 3D scene is built lazily, so its
 * first registration lands one microtask-chain later than the store flip, and 2D re-registers from a
 * passive effect that runs after every layout effect. Anything that must follow the live projection
 * or the live overlay (the selection ring, the selection handles) therefore hangs off this signal
 * instead of guessing when the swap completed. Listeners must be idempotent: a re-registration of
 * the same view notifies too (the 2D view is a fresh object per call), and the signal only claims
 * "the registry was pointed at a view".
 */
import type { EventBus } from '../core/commands/event-bus';
import type { EditorEvents } from '../core/model/types';
import type { ActiveView } from './view-projection';
import type { ToolManager } from '../tools/runtime';
import { createSignal } from '../core/runtime/signal';

type ActiveViewListener = (view: ActiveView | null, previous: ActiveView | null) => void;

const view = createSignal<ActiveView | null>(null);
let toolManager: ToolManager | null = null;

export function setActiveView(v: ActiveView | null): void {
  if (v) toolManager?.setView(v);
  view.emit(v);
}

/** Subscribe to active-view changes. Returns the unsubscribe. */
export function onActiveViewChange(listener: ActiveViewListener): () => void {
  return view.subscribe(listener);
}

/**
 * Calls `fn` whenever a map-following overlay has to be placed again: the camera moved, the window
 * resized, the active view was swapped, or the terrain under the projection changed. `objects` adds
 * object edits for an overlay drawn around objects; `cells: false` leaves terrain edits out.
 * Returns the unsubscribe.
 */
export function onProjectionChange(
  bus: EventBus<EditorEvents>, fn: () => void, { cells = true, objects = false }: { cells?: boolean; objects?: boolean } = {},
): () => void {
  const run = () => { fn(); };
  bus.on('viewport-changed', run);
  if (cells) bus.on('cells-changed', run);
  if (objects) bus.on('objects-changed', run);
  window.addEventListener('resize', run);
  const offView = onActiveViewChange(run);
  return () => {
    bus.off('viewport-changed', run);
    bus.off('cells-changed', run);
    bus.off('objects-changed', run);
    window.removeEventListener('resize', run);
    offView();
  };
}

export function getActiveView(): ActiveView | null {
  return view.get();
}

/** The editor's single ToolManager (PixiCanvas owns its lifecycle). */
export function registerToolManager(tm: ToolManager | null): void {
  toolManager = tm;
  const v = view.get();
  if (tm && v) tm.setView(v);
}

export function getActiveToolManager(): ToolManager | null {
  return toolManager;
}
