/**
 * "The map was edited", as one subscription over the editor's bus.
 *
 * Every change to a map's cells or objects emits `cells-changed` or `objects-changed`, and undo and
 * redo emit `cells-changed` before `history-applied`, so these two events cover every edit and a
 * listener on `history-applied` as well hears an undo twice.
 */
import type { KernelEvents } from './events';
import type { EventBus } from './event-bus';

/** Calls `fn` after every edit. Returns the unsubscribe. A listener that wants one call per frame
 *  wraps `fn` in `platform/async/after-paint.ts:coalesceToFrame`. */
export function onMapEdited(bus: EventBus<KernelEvents>, fn: () => void): () => void {
  const run = () => { fn(); };
  bus.on('cells-changed', run);
  bus.on('objects-changed', run);
  return () => {
    bus.off('cells-changed', run);
    bus.off('objects-changed', run);
  };
}
