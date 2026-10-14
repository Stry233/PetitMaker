/**
 * The region-selection channel.
 *
 * Whatever is collecting a painted region registers here, and everything that edits that region as
 * a whole goes through the same handle: the pointer machine reports the cells a stroke covers, and
 * the screen that arms it asks for the one edit a stroke cannot make — emptying it. An empty
 * region already means the whole planet, so there is no take-everything edit beside it. With
 * nothing registered the calls are no-ops.
 *
 * They belong together because the collector owns the buffer and its own undo stack: a UI that
 * wrote the store directly would leave that buffer stale and the stroke it took back unrecoverable.
 * The pointer machine's own `regionBrushing` (from `resolvePress`) gates on `store.selectingRegion`,
 * not on whether a handler is registered here — this channel only carries the cells once that gate
 * is already open.
 */
import type { MacroCoord } from '../../../core/model/types';

export interface RegionBrushHandler {
  paint(coord: MacroCoord): void;
  /** Hover never changes the selection or its history. */
  preview?(coord: MacroCoord): void;
  /** The press in flight never happened (the browser cancelled it, or a second finger landed). */
  cancel?(): void;
  /** `time` is the release event's timestamp, for a multi-click figure's double-click window. */
  done(time?: number): void;
  /** Escape: abandons a standing multi-click figure; false when none stands. */
  cancelPending?(): boolean;
  /** Delete: takes back the newest anchor of a standing figure; false when none stands. */
  undoPendingStep?(): boolean;
  /** Empty the region, as one entry on its own undo stack. */
  clear(): void;
}

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
export function finishRegionStroke(time?: number): void { handler?.done(time); }
export function clearRegionSelection(): void { handler?.clear(); }
export function cancelPendingRegion(): boolean { return handler?.cancelPending?.() ?? false; }
export function undoPendingRegionStep(): boolean { return handler?.undoPendingStep?.() ?? false; }
