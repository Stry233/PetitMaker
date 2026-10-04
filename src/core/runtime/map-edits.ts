/**
 * "The map was edited", as one subscription over the editor's bus.
 *
 * Every change to a map's cells or objects emits `cells-changed` or `objects-changed`, and undo and
 * redo emit `cells-changed` before `history-applied`, so these two events cover every edit and a
 * listener on `history-applied` as well hears an undo twice.
 */
import type { EventBus } from '../commands/event-bus';
import type { EditorEvents } from '../model/types';

/**
 * Calls `fn` after every edit. With `frame`, calls made within one animation frame collapse into a
 * single call at that frame. Returns the unsubscribe, which also drops a pending frame.
 */
export function onMapEdited(bus: EventBus<EditorEvents>, fn: () => void, opts: { frame?: boolean } = {}): () => void {
  let frame = 0;
  const run = opts.frame
    ? () => { if (!frame) frame = requestAnimationFrame(() => { frame = 0; fn(); }); }
    : () => { fn(); };
  bus.on('cells-changed', run);
  bus.on('objects-changed', run);
  return () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    bus.off('cells-changed', run);
    bus.off('objects-changed', run);
  };
}
