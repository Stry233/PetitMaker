/**
 * What changing planet would leave, computed before the change: the same transfer `transferMap`
 * installs, run on a detached map and never installed. The replay costs a few hundred milliseconds
 * on a dense build, so the window asks through `requestTransferPreview`, which runs it in the
 * generation worker pool and on the main thread only where the pool is unavailable.
 */
import type { GridState, MapTemplate } from '../../../core/model/types';
import type { GridCellRef } from '../../../core/grid/grids';
import { poolAvailable, runTransferPreviewInPool } from './candidate-pool';
import { buildTransfer, type TransferCounts } from '../transfer';

export interface TransferPreview {
  /** The destination as the transfer would install it, for painting: cells, objects and versions.
   *  Detached: nothing live refers to it. One worked out in a worker carries its plan notes but no
   *  provenance or map notes. */
  state: GridState;
  /** The cells to mark as lost, each on the grid it names, in destination coordinates and including
   *  cells off the destination, each once: every dropped terrain cell (terrain grid) plus every cell
   *  a dropped object's footprint covers (placement grid). Its length is the number of red cells,
   *  the count shown beside them: one dropped house adds each cell it covers, and a dropped tree on
   *  dropped ground adds none. */
  dropped: GridCellRef[];
  /** What arrives: source terrain cells and objects, counted apart. */
  moved: TransferCounts;
  /** What does not arrive: `cells` is the number of source terrain cells that land nowhere,
   *  `objects` the number of objects left behind. Exactly `TransferOutcome.dropped` for the same
   *  transfer. */
  droppedCounts: TransferCounts;
}

/** The preview of carrying `source` onto `target`: the one computation both threads run. */
export function transferPreviewOf(source: GridState, target: MapTemplate): TransferPreview {
  const built = buildTransfer(source, target);
  return { state: built.dest, dropped: built.droppedCells, moved: built.moved, droppedCounts: built.dropped };
}

export interface TransferPreviewRequest {
  /** Aborted by the caller once the answer is no longer wanted. A request aborted before it runs
   *  resolves null without running; one already running in a worker finishes there unread. */
  signal: AbortSignal;
  /** Resolves when the main thread can afford the replay: the main-thread path waits on it, the
   *  worker path does not. */
  whenIdle: () => Promise<void>;
}

/**
 * The carry preview of `state` onto `target`, off the main thread where the worker pool runs, or
 * null when `signal` was aborted first. The pool encodes the map when a worker takes the job, so
 * the answer describes the map as it stood then; a caller that edits the map meanwhile compares
 * versions. A pool that is unavailable or breaks leaves the same replay to the main thread after
 * `whenIdle`.
 */
export async function requestTransferPreview(
  state: GridState, target: MapTemplate, { signal, whenIdle }: TransferPreviewRequest,
): Promise<TransferPreview | null> {
  if (poolAvailable()) {
    try {
      return await runTransferPreviewInPool(state, target, signal);
    } catch {
      // The pool refused or lost this job; the main thread answers it.
    }
  }
  if (signal.aborted) return null;
  await whenIdle();
  return signal.aborted ? null : transferPreviewOf(state, target);
}
