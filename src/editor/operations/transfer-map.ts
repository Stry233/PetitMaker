/**
 * Change planet: the carry `tools/generation/transfer/` builds on a detached map, installed as the
 * live map. Installing goes through the editor's port, which the generation worker that runs the
 * build for the carry preview has none of.
 */
import { templateOf } from '../../config/maps/resolve';
import type { MacroCoord, MapTemplate, ValidationError } from '../../core/model/types';
import type { MapPort } from '../session/context';
import type { EditContext } from '../../core/commands/edit-context';
import { newMap } from './map';
import { buildTransfer, anchorOffset, type TransferCounts } from '../../tools/generation/transfer';
import { requestTransferPreview, type TransferPreview } from '../../tools/generation/run';
import type { GridState } from '../../core/model/types';
import { mapVersionKey } from '../../core/model/grid-model';
import { createSignal } from '../../core/base/signal';
import { onAfterPaint } from '../../platform/async/after-paint';

export { hasCarriableContent } from '../../tools/generation/transfer';

/** What a transfer preview was worked out from: the map under the rules (`mapVersionKey`), and the
 *  store's notes epoch, since plan notes change in place without moving the revision. A preview
 *  answers only while this key holds. */
function transferPreviewKey(state: GridState, notesEpoch: number): string {
  return `${mapVersionKey(state)}|${notesEpoch}`;
}

/** One transfer preview per map version and destination, so a view change never asks again. */
const previews = new WeakMap<GridState, { key: string; byTarget: Map<string, TransferPreview> }>();
/** Counts the previews remembered, for a reader waiting on one. */
const remembered = createSignal(0);

/** The carry preview remembered for `state` with its notes at `notesEpoch` onto `target`, or null. */
export function cachedCarryPreview(state: GridState, notesEpoch: number, target: MapTemplate): TransferPreview | null {
  const entry = previews.get(state);
  return entry && entry.key === transferPreviewKey(state, notesEpoch) ? entry.byTarget.get(target.id) ?? null : null;
}

function rememberTransferPreview(state: GridState, key: string, target: MapTemplate, preview: TransferPreview): void {
  let entry = previews.get(state);
  if (!entry || entry.key !== key) {
    entry = { key, byTarget: new Map() };
    previews.set(state, entry);
  }
  entry.byTarget.set(target.id, preview);
  remembered.emit(remembered.get() + 1);
}

export function subscribeCarryPreviews(listener: () => void): () => void {
  return remembered.subscribe(listener);
}

/** Changes whenever a carry preview is remembered. */
export function carryPreviewsVersion(): number {
  return remembered.get();
}

/**
 * Works out the build as it would arrive on `target` and remembers it (`cachedCarryPreview`). The
 * transfer replays the whole build, far longer than a frame, so it runs in a worker; where none runs
 * it waits `settleMs` for the asking surface's motion to land and then runs after the next painted
 * frame. An answer worked out from a map or notes (`notesEpoch`, read as it lands) that have moved on
 * is dropped. Returns the cancel, after which nothing is remembered.
 */
export function requestCarryPreview(
  state: GridState, target: MapTemplate, opts: { notesEpoch: () => number; settleMs: number },
): () => void {
  const key = transferPreviewKey(state, opts.notesEpoch());
  const controller = new AbortController();
  const { signal } = controller;
  let settle: ReturnType<typeof setTimeout> | undefined;
  let cancelPaint = (): void => {};
  const whenIdle = () => new Promise<void>((resolve) => {
    settle = setTimeout(() => { cancelPaint = onAfterPaint(resolve); }, opts.settleMs);
  });
  void requestTransferPreview(state, target, { signal, whenIdle }).then((preview) => {
    // An edit since the request is a newer map than the one the answer was worked out from.
    if (!preview || signal.aborted || transferPreviewKey(state, opts.notesEpoch()) !== key) return;
    rememberTransferPreview(state, key, target, preview);
  });
  return () => {
    controller.abort();
    if (settle !== undefined) clearTimeout(settle);
    cancelPaint();
  };
}

export interface TransferOutcome {
  /** The planet arrived at. The template itself, so a caller can name it without a second lookup. */
  target: MapTemplate;
  /** The macro offset everything carried moved by: the difference of the two anchor landmark centres. */
  offset: MacroCoord;
  /** False = the destination opened empty (the plain new-map path). */
  carried: boolean;
  /** What stands on the destination that stood on the source. */
  moved: TransferCounts;
  /** What the destination would not take. */
  dropped: TransferCounts;
  /** Post-stroke violations that survived the commit. Empty on success. */
  violations: ValidationError[];
}

interface TransferOptions {
  /** The destination planet: a built-in template id, or the template itself (a planet the built-in
   *  registry does not hold). */
  target: string | MapTemplate;
  /** Default true. False is the plain new-map path — the build is left behind. */
  carry?: boolean;
}

/**
 * Change planet, carrying the current build to the new one.
 *
 * History resets exactly as it does for any other template switch: the destination arrives under a
 * fresh executor, so a transfer is not undoable (the modal that offers it carries that warning).
 */
export function transferMap(port: MapPort, kit: EditContext, opts: TransferOptions): TransferOutcome {
  const target = templateOf(opts.target);
  const source = kit.state;

  if (opts.carry === false) {
    newMap(port, target);
    return {
      target, offset: anchorOffset(source.template, target), carried: false,
      moved: { cells: 0, objects: 0 },
      dropped: { cells: 0, objects: 0 },
      violations: [],
    };
  }

  const built = buildTransfer(source, target);
  port.installLoaded(built.dest, built.registry);
  return {
    target, offset: built.offset, carried: true,
    moved: built.moved, dropped: built.dropped, violations: built.violations,
  };
}
