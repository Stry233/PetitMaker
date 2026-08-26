/**
 * The whole-map roads press, and the one thing it has to remember between presses.
 *
 * PRESSING AGAIN HANDS BACK ANOTHER CANDIDATE. That takes two things the macro cannot hold for
 * itself: a seed that moves, and the ids the last press laid, so the next one takes its own work
 * back instead of adding to it. Both live here, at module level, exactly as `generate.ts` keeps
 * `lastRunRegion`.
 *
 * PER MAP, and by the map's OWN IDENTITY rather than by a lifecycle call: opening or loading a map
 * installs a new `GridState`, so a press against one this module has not seen starts from nothing.
 * A `forget…()` hook beside `forgetGenerationScope` would work equally well right up until a path
 * that installs a map forgets to call it, and the failure then is a press stripping roads on a map
 * it never laid them on.
 *
 * NOTHING A HAND PLACED IS EVER IN THE LIST. It holds only what a press created and `roads.ts`
 * handed back, so a road the user painted, a bridge they built and a plant beside the street are
 * outside it by construction. That is why it is an id list rather than a provenance read: the
 * ledger answers null for a map loaded without one, which is the case this feature was asked for.
 *
 * After a reload the list is empty, so a press adds to the standing network exactly as a first
 * press does — the honest behaviour, since the ids of that network are gone.
 */
import type { GridState } from '../../core/model/types';
import { applyMacro, type MacroOpts, type MacroOutcome } from '../../tools/macros';
import type { KitContext } from '../context';

/** The map the three fields below describe. */
let owner: GridState | null = null;
/** Everything the presses so far amount to on that map. */
let ownedIds: readonly string[] = [];
/** Advances only on a press that changed the map: a press that changed nothing offers no different
 *  plan next time, so re-pressing must not burn a seed to find that out again. */
let seed = 1;
/** How many presses have landed a network here, so the shell can say which one this is. */
let landed = 0;

export interface RoadPress {
  outcome: MacroOutcome;
  /** Which landed press of this map's road network this was. 1 is the first, so anything above it
   *  is a candidate offered in place of one the user has already seen. 0 when nothing landed. */
  nth: number;
}

/** One press of the roads macro, with the run's own scope, surface and gauge supplied by the caller. */
export function pressRoadNetwork(kit: KitContext, opts: Omit<MacroOpts, 'seed' | 'replace'>): RoadPress {
  if (owner !== kit.state) { owner = kit.state; ownedIds = []; seed = 1; landed = 0; }
  const outcome = applyMacro(kit, 'roads', {
    ...opts,
    seed,
    ...(ownedIds.length > 0 ? { replace: ownedIds } : {}),
  });
  if (outcome.changes > 0) {
    // The macro answers with what the gesture owns AFTER the run, take-back included; a run that
    // kept nothing hands back the list unchanged.
    ownedIds = outcome.ownedIds ?? [];
    seed += 1;
    landed += 1;
  }
  return { outcome, nth: outcome.changes > 0 ? landed : 0 };
}
