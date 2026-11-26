/**
 * The region-selection channel: whatever is collecting a painted region registers here
 * (`editor/editing/region-brush.ts`), and everything that edits that region as a whole goes through
 * the same handle: the pointer machine reports the cells a stroke covers, and the screen that arms it
 * asks for the one edit a stroke cannot make, emptying it. An empty region already means the whole
 * planet, so there is no take-everything edit beside it. With nothing registered the calls are no-ops.
 *
 * The pointer machine's own `regionBrushing` (from `resolvePress`) gates on `store.selectingRegion`,
 * not on whether a handler is registered here: this channel only carries the cells once that gate
 * is already open.
 */
import type { MacroCoord } from '../../../core/model/types';
import type { RegionBrushHandler } from '../../../tools/pointer/region';

/** The page's one registration: region selection is a single page-wide mode, and its callers (the
 *  pointer machine, the command keys, the scope screen) hold no tool context to carry a port on. */
let handler: RegionBrushHandler | null = null;

/** Register for as long as region selection is on; returns its unregister. A stale unregister is
 *  ignored, so a remount that registers before the old one tears down keeps the newer handler. */
export function setRegionBrushHandler(next: RegionBrushHandler | null): () => void {
  handler = next;
  return () => { if (handler === next) handler = null; };
}

export function paintRegionCell(coord: MacroCoord): void { handler?.paint(coord); }
export function previewRegionCell(coord: MacroCoord): void { handler?.preview?.(coord); }
export function cancelRegionStroke(): void { handler?.cancel?.(); }
export function finishRegionStroke(time?: number, windowMs?: number): void { handler?.done(time, windowMs); }
export function clearRegionSelection(): void { handler?.clear(); }
export function pendingRegion(): boolean { return handler?.hasPending?.() ?? false; }
export function cancelPendingRegion(): boolean { return handler?.cancelPending?.() ?? false; }
export function undoPendingRegionStep(): boolean { return handler?.undoPendingStep?.() ?? false; }
