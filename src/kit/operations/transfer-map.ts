/**
 * Change planet: the carry `transfer.ts` builds on a detached map, installed as the live map. Kept
 * apart from the build because installing reaches the editor store, which the generation worker
 * that runs the build for the carry preview does not load.
 */
import { templateOf } from '../../config/maps/resolve';
import type { MacroCoord, MapTemplate, ValidationError } from '../../core/model/types';
import { installLoadedMap, type KitContext } from '../context';
import { forgetGenerationScope } from './generate';
import { newMap } from './map';
import { buildTransfer, plazaOffset, type TransferCounts } from './transfer';

export interface TransferOutcome {
  /** The planet arrived at. The template itself, so a caller can name it without a second lookup. */
  target: MapTemplate;
  /** The macro offset everything carried moved by: the difference of the two plaza centres. */
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
export function transferMap(kit: KitContext, opts: TransferOptions): TransferOutcome {
  const target = templateOf(opts.target);
  const source = kit.state;

  if (opts.carry === false) {
    newMap(target);
    return {
      target, offset: plazaOffset(source.template, target), carried: false,
      moved: { cells: 0, objects: 0 },
      dropped: { cells: 0, objects: 0 },
      violations: [],
    };
  }

  const built = buildTransfer(source, target);
  installLoadedMap(built.dest, built.registry);
  forgetGenerationScope();
  return {
    target, offset: built.offset, carried: true,
    moved: built.moved, dropped: built.dropped, violations: built.violations,
  };
}
