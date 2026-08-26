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
import type { ActiveView } from './view-projection';
import type { ToolManager } from '../tools/runtime';

type ActiveViewListener = (view: ActiveView | null, previous: ActiveView | null) => void;

let view: ActiveView | null = null;
let toolManager: ToolManager | null = null;
const listeners = new Set<ActiveViewListener>();

export function setActiveView(v: ActiveView | null): void {
  const previous = view;
  view = v;
  if (v) toolManager?.setView(v);
  // Snapshot: a listener may unsubscribe (an unmount) from inside its own call.
  for (const notify of [...listeners]) notify(v, previous);
}

/** Subscribe to active-view changes. Returns the unsubscribe. */
export function onActiveViewChange(listener: ActiveViewListener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function getActiveView(): ActiveView | null {
  return view;
}

/** The editor's single ToolManager (PixiCanvas owns its lifecycle). */
export function registerToolManager(tm: ToolManager | null): void {
  toolManager = tm;
  if (tm && view) tm.setView(view);
}

export function getActiveToolManager(): ToolManager | null {
  return toolManager;
}
