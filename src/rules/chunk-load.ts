import {
  CommandType,
  type Command,
  type GridState,
  type PlacedObject,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { getFootprint } from '../core/model/grid-model';
import { chunksOf, getMapStats } from '../state/map-stats';
import { exceedsLoadBudget, isChunkLoadEnforced, roundLoad } from '../core/model/load';
import { catalogLoadValue } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';
import { CHUNK_LOAD_LIMIT } from '../core/model/game-profile';

/** The candidate's own prior version, whether it still stands on the map or the open stroke has
 *  lifted it: its load is credited in the regions it occupied, so a move or turn is not charged twice. */
function priorSelf(state: GridState, candidate: PlacedObject): { onMap: boolean; object: PlacedObject } | null {
  const standing = state.objects.get(candidate.id);
  if (standing) return standing.patchOnly ? null : { onMap: true, object: standing };
  const lifted = state.liftedObjects?.get(candidate.id);
  return lifted && !lifted.patchOnly ? { onMap: false, object: lifted } : null;
}

/** The full object cost is charged to every touched region, including partial footprints. A
 *  re-placed object is judged on its net change, so moving or turning it inside an overloaded
 *  region is permitted while added load is not. */
export function chunkLoadViolations(
  state: GridState,
  candidate: PlacedObject,
  loadValue: number,
): ValidationError[] {
  const chunks = getMapStats(state).chunks;
  const prior = priorSelf(state, candidate);
  const priorChunks = prior ? new Set(chunksOf(prior.object, state.template)) : null;
  const priorLoad = prior ? catalogLoadValue(prior.object.catalogId) : 0;
  for (const key of chunksOf(candidate, state.template)) {
    const current = chunks.get(key)?.load ?? 0;
    const credit = priorChunks?.has(key) ? priorLoad : 0;
    // `before` is the region with the prior version standing; `after` with the candidate instead.
    const before = prior?.onMap ? current : roundLoad(current + credit);
    const after = roundLoad(before - credit + loadValue);
    if (exceedsLoadBudget(before, roundLoad(after - before))) {
      const { w, h } = getPlacedObjectSize(candidate);
      // Non-spatial rule: the evidence is the whole attempted footprint.
      return [{
        ruleId: 'V-CHUNK-01',
        message: 'error.chunk_full',
        messageParams: { max: CHUNK_LOAD_LIMIT },
        cells: getFootprint(candidate.position.x, candidate.position.y, w, h),
        grid: 'macro',
        severity: 'error',
      }];
    }
  }
  return [];
}

export const chunkLoadRule: PreCommandRule = {
  id: 'V-CHUNK-01',
  agentHint: `When regional load enforcement is on, each region may carry at most ${CHUNK_LOAD_LIMIT}. The full object load counts in every region it touches; moving or turning an item counts only the net change. Unknown loads count as zero.`,
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],
  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    if (!isChunkLoadEnforced(state) || cmd.object.patchOnly) return [];
    return chunkLoadViolations(state, cmd.object, catalogLoadValue(cmd.object.catalogId));
  },
};
