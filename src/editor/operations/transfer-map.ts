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
import type { TransferPreview } from '../../tools/generation/run';
import type { GridState } from '../../core/model/types';
import { mapRevisionOf } from '../../state/map-revision';

export { hasCarriableContent } from '../../tools/generation/transfer';

/** What a transfer preview was worked out from: the map's revision and whether it ignores the
 *  chunk load. A preview answers only while this key holds. */
export function transferPreviewKey(state: GridState): string {
  return `${mapRevisionOf(state)}|${!!state.ignoreChunkLoad}`;
}

/** One transfer preview per map version and destination, so a view change never asks again. */
const previews = new WeakMap<GridState, { key: string; byTarget: Map<string, TransferPreview> }>();

/** The preview remembered for `state` as it stands and `target`, or null. */
export function cachedTransferPreview(state: GridState, target: MapTemplate): TransferPreview | null {
  const entry = previews.get(state);
  return entry && entry.key === transferPreviewKey(state) ? entry.byTarget.get(target.id) ?? null : null;
}

/** Remembers `preview` for `state` as it stands and `target`. */
export function rememberTransferPreview(state: GridState, target: MapTemplate, preview: TransferPreview): void {
  const key = transferPreviewKey(state);
  let entry = previews.get(state);
  if (!entry || entry.key !== key) {
    entry = { key, byTarget: new Map() };
    previews.set(state, entry);
  }
  entry.byTarget.set(target.id, preview);
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

export interface TransferOptions {
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
