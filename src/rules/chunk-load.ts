/**
 * V-CHUNK-01: Chunk Load Limit (pre-command)
 *
 * Each chunk has a maximum capacity (loadMaxFor, every chunk defaulting to
 * CHUNK_LOAD_LIMIT). A placement is rejected if it would push any chunk in the object's
 * footprint over that limit (<=, so exactly the limit is allowed). Reads the per-chunk load
 * already memoized by state/map-stats.ts and adds only the candidate's own footprint, so one
 * placement check costs the candidate's footprint, never the map's object count.
 *
 * GATED OFF for now (CHUNK_LOAD_ENABLED = false): the real in-game load values are unknown,
 * so every placement is free. The enforcement below is wired and footprint-correct — flipping
 * CHUNK_LOAD_ENABLED (and setting real catalog loadValues) enables it with no further plumbing.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type PlacedObject,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { CHUNK_LOAD_ENABLED, CHUNK_LOAD_LIMIT } from '../core/model/constants';
import { getFootprint } from '../core/model/grid-model';
import { chunksOf, getMapStats } from '../state/map-stats';
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';

/** One chunk's load ceiling. A function, not a bare constant, so a future map template or
 *  in-game config can vary a chunk's capacity; every chunk defaults to CHUNK_LOAD_LIMIT until
 *  one actually does. */
function loadMaxFor(_state: GridState, _key: string): number {
  return CHUNK_LOAD_LIMIT;
}

/** If `candidate.id` already names an object on the map, that copy's own contribution must be
 *  discounted per chunk it occupies, or a caller that validates a replacement before removing
 *  the old copy under the same id (road-reconcile.ts does exactly this) would have the
 *  candidate double-charged against itself. patchOnly objects are excluded because map-stats
 *  never counted them in the first place. O(candidate's prior footprint), not O(map objects). */
function selfContribution(state: GridState, candidate: PlacedObject): { chunks: Set<string>; load: number } {
  const prior = state.objects.get(candidate.id);
  if (!prior || prior.patchOnly) return { chunks: new Set(), load: 0 };
  return { chunks: new Set(chunksOf(prior)), load: getCatalogItem(prior.catalogId)?.loadValue ?? 0 };
}

/**
 * Would placing `candidate` (carrying `loadValue`) push any chunk in its footprint over that
 * chunk's load ceiling, given the objects already in `state`? Exported for testing; the rule
 * gates calling this behind CHUNK_LOAD_ENABLED.
 */
export function chunkLoadViolations(
  state: GridState,
  candidate: PlacedObject,
  loadValue: number,
): ValidationError[] {
  const chunks = getMapStats(state).chunks;
  const self = selfContribution(state, candidate);
  for (const key of chunksOf(candidate)) {
    const existing = (chunks.get(key)?.load ?? 0) - (self.chunks.has(key) ? self.load : 0);
    if (existing + loadValue > loadMaxFor(state, key)) {
      const { w, h } = getPlacedObjectSize(candidate);
      // Non-spatial rule: the evidence is the whole attempted footprint.
      return [{
        ruleId: 'V-CHUNK-01',
        message: 'error.chunk_full',
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
  agentHint: 'Per-chunk object load limit (currently disabled).',
  phase: 'pre-command',
  appliesTo: [CommandType.PlaceObject],
  validate(cmd: Command, state: GridState): ValidationError[] {
    if (cmd.type !== CommandType.PlaceObject) return [];
    if (!CHUNK_LOAD_ENABLED) return []; // the real load values are unknown, so placement is free
    return chunkLoadViolations(state, cmd.object, cmd.loadValue);
  },
};
