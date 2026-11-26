/**
 * What collects a painted region, as the region pointer and the commands that edit the region as a
 * whole reach it (`view/interaction/pointer/region-channel.ts`): the cells a stroke covers, and the
 * one edit a stroke cannot make, emptying it. The collector owns the buffer and its own undo stack,
 * so a UI that wrote the store directly would leave that buffer stale and the stroke it took back
 * unrecoverable.
 */
import type { MacroCoord } from '../../../core/model/types';

export interface RegionBrushHandler {
  paint(coord: MacroCoord): void;
  /** Hover never changes the selection or its history. */
  preview?(coord: MacroCoord): void;
  /** The press in flight never happened (the browser cancelled it, or a second finger landed). */
  cancel?(): void;
  /** `time` is the release event's timestamp and `windowMs` the releasing pointer's double-click
   *  window, for a multi-click figure. */
  done(time?: number, windowMs?: number): void;
  /** Whether a multi-click figure stands unfinished. */
  hasPending?(): boolean;
  /** Escape: abandons a standing multi-click figure; false when none stands. */
  cancelPending?(): boolean;
  /** Delete: takes back the newest anchor of a standing figure; false when none stands. */
  undoPendingStep?(): boolean;
  /** Empty the region, as one entry on its own undo stack. */
  clear(): void;
}
