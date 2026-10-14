/**
 * The active-view registry: which map view (2D or 3D) currently owns pointer
 * input and tool feedback. Each canvas registers its view when it becomes the
 * visible one; the pointer machine and ToolManager read the current view here,
 * so mode switches re-point the whole tool layer in one place.
 *
 * "The active view changed" is an explicit signal (`onActiveViewChange`), not something a listener
 * infers from `viewMode`. The two facts are not simultaneous: the 3D scene is built lazily, so its
 * first registration lands one microtask-chain later than the store flip, and 2D re-registers from a
 * passive effect that runs after every layout effect. Anything that must follow the live projection
 * or the live overlay (the selection ring, the selection handles) therefore hangs off this signal
 * instead of guessing when the swap completed. Listeners must be idempotent: a re-registration of
 * the same view notifies too, and the signal only claims "the registry was pointed at a view".
 */
import type { EventBus } from '../core/commands/event-bus';
import type { EditorEvents } from '../state/editing/events';
import type { ActiveView, ToolManager } from '../tools/pointer/runtime';
import { createSignal } from '../core/base/signal';
import { anyOverlayOpen } from '../platform/channels/overlay-state';
import { pinchZoom } from './interaction/camera-gestures';

type ActiveViewListener = (view: ActiveView | null, previous: ActiveView | null) => void;

const view = createSignal<ActiveView | null>(null);
let toolManager: ToolManager | null = null;

/** Ctrl+wheel (a trackpad pinch included) zooms the active view from anywhere on the page. The
 *  registry holds the one window listener while a view is active, so a second mounted view never
 *  zooms the same event again. */
function onWindowPinch(e: WheelEvent): void {
  if (!e.ctrlKey) return;
  e.preventDefault(); // the browser's page zoom never fires over the editor
  if (anyOverlayOpen()) return; // a dialog is up: the map behind it stays put
  const camera = view.get()?.camera;
  if (camera) pinchZoom(camera, e);
}

export function setActiveView(v: ActiveView | null): void {
  toolManager?.setView(v);
  view.emit(v);
  if (typeof window === 'undefined') return; // the registry also runs without a DOM
  // Adding the same listener twice registers it once.
  if (view.get()) window.addEventListener('wheel', onWindowPinch, { passive: false });
  else window.removeEventListener('wheel', onWindowPinch);
}

/** A view going away detaches itself; a view that is not the active one leaves the registry alone.
 *  Each view hands out one object for its life, so identity names it. */
export function releaseActiveView(released: ActiveView): void {
  if (view.get() === released) setActiveView(null);
}

/** Subscribe to active-view changes. Returns the unsubscribe. */
export function onActiveViewChange(listener: ActiveViewListener): () => void {
  return view.subscribe(listener);
}

/**
 * Calls `fn` whenever a map-following overlay has to be placed again: the camera moved, the window
 * resized, the active view was swapped, or the terrain under the projection changed. `objects` adds
 * object edits for an overlay drawn around objects; `cells: false` leaves terrain edits out. A map
 * edit passes its `cause`.
 * Returns the unsubscribe.
 */
export function onProjectionChange(
  bus: EventBus<EditorEvents>, fn: (cause?: string) => void, { cells = true, objects = false }: { cells?: boolean; objects?: boolean } = {},
): () => void {
  const run = () => { fn(); };
  const runEdit = (edit: { cause?: string }) => { if (edit.cause === undefined) fn(); else fn(edit.cause); };
  bus.on('viewport-changed', run);
  if (cells) bus.on('cells-changed', runEdit);
  if (objects) bus.on('objects-changed', runEdit);
  window.addEventListener('resize', run);
  const offView = onActiveViewChange(run);
  return () => {
    bus.off('viewport-changed', run);
    bus.off('cells-changed', runEdit);
    bus.off('objects-changed', runEdit);
    window.removeEventListener('resize', run);
    offView();
  };
}

export function getActiveView(): ActiveView | null {
  return view.get();
}

/** The editor's single ToolManager (`editor/session/editor-tools.ts` owns its lifecycle); it is pointed at
 *  whichever view is active, or none. */
export function registerToolManager(tm: ToolManager | null): void {
  toolManager = tm;
  tm?.setView(view.get());
}

export function getActiveToolManager(): ToolManager | null {
  return toolManager;
}
