import { CommandType, type GridState, type PlacedObject, type StrokeScope, type ValidationError } from '../core/model/types';
import { bodyEvidence } from '../core/grid/footprint';
import { chunksOf, getMapStats } from '../state/map-stats';
import { exceedsLoadBudget, isChunkLoadEnforced, roundLoad } from '../core/model/load';
import { catalogLoadValue } from '../state/catalog';
import { objectRect } from '../state/object-geometry';
import { CHUNK_LOAD_LIMIT } from '../core/game/profile';
import { definePreRule, failFor } from './define';

const RULE_ID = 'V-CHUNK-01';
const fail = failFor(RULE_ID);

/** The candidate's own prior version, whether it still stands on the map or the open stroke has
 *  lifted it: its load is credited in the regions it occupied, so a move or turn is not charged twice. */
function priorSelf(state: GridState, candidate: PlacedObject, scope: StrokeScope | undefined): { onMap: boolean; object: PlacedObject } | null {
  const standing = state.objects.get(candidate.id);
  if (standing) return standing.patchOnly ? null : { onMap: true, object: standing };
  const lifted = scope?.lifted.get(candidate.id);
  return lifted && !lifted.patchOnly ? { onMap: false, object: lifted } : null;
}

/** The full object cost is charged to every touched region, including partial footprints. A
 *  re-placed object is judged on its net change, so moving or turning it inside an overloaded
 *  region is permitted while added load is not. */
export function chunkLoadViolations(
  state: GridState,
  candidate: PlacedObject,
  loadValue: number,
  scope?: StrokeScope,
): ValidationError[] {
  const chunks = getMapStats(state).chunks;
  const prior = priorSelf(state, candidate, scope);
  const priorChunks = prior ? new Set(chunksOf(prior.object, state.template)) : null;
  const priorLoad = prior ? catalogLoadValue(prior.object.catalogId) : 0;
  for (const key of chunksOf(candidate, state.template)) {
    const current = chunks.get(key)?.load ?? 0;
    const credit = priorChunks?.has(key) ? priorLoad : 0;
    // `before` is the region with the prior version standing; `after` with the candidate instead.
    const before = prior?.onMap ? current : roundLoad(current + credit);
    const after = roundLoad(before - credit + loadValue);
    if (exceedsLoadBudget(before, roundLoad(after - before))) {
      // Non-spatial rule: the evidence is the whole attempted footprint.
      return [fail('error.chunk_full', bodyEvidence([objectRect(candidate)]), { messageParams: { max: CHUNK_LOAD_LIMIT } })];
    }
  }
  return [];
}

export const chunkLoadRule = definePreRule({
  id: RULE_ID,
  appliesTo: [CommandType.PlaceObject],
  validate(cmd, state, _fail, scope) {
    if (!isChunkLoadEnforced(state) || cmd.object.patchOnly) return [];
    return chunkLoadViolations(state, cmd.object, catalogLoadValue(cmd.object.catalogId), scope);
  },
});
