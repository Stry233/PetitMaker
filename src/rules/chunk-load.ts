/**
 * V-CHUNK-01: Chunk Load Limit (pre-command)
 *
 * Each 16x16 chunk has a maximum capacity of CHUNK_LOAD_LIMIT load units. A placement is
 * rejected if it would push any chunk in the object's footprint over the limit (<=, so
 * exactly the limit is allowed).
 *
 * GATED OFF for now (CHUNK_LOAD_ENABLED = false): the real in-game load values are unknown,
 * so every placement is free. The enforcement below is wired and footprint-correct — it
 * computes the current load directly from the placed objects, so flipping CHUNK_LOAD_ENABLED
 * (and setting real catalog loadValues) enables it with no further plumbing.
 */
import {
  CommandType,
  type Command,
  type GridState,
  type PlacedObject,
  type PreCommandRule,
  type ValidationError,
} from '../core/model/types';
import { CHUNK_LOAD_ENABLED } from '../core/model/constants';
import { ChunkTracker } from '../core/model/chunk-tracker';
import { getFootprint } from '../core/model/grid-model';
import { getCatalogItem } from '../state/catalog';
import { getPlacedObjectSize } from '../state/object-geometry';

/**
 * Would placing `candidate` (carrying `loadValue`) push any chunk in its footprint over
 * CHUNK_LOAD_LIMIT, given the objects already in `state`? Pure; current load is summed
 * directly from `state.objects` via the catalog. Exported for testing; the rule gates
 * calling this behind CHUNK_LOAD_ENABLED.
 */
export function chunkLoadViolations(
  state: GridState,
  candidate: PlacedObject,
  loadValue: number,
): ValidationError[] {
  const tracker = new ChunkTracker();
  for (const obj of state.objects.values()) {
    if (obj.patchOnly || obj.id === candidate.id) continue;
    const { w, h } = getPlacedObjectSize(obj);
    tracker.addObject(obj.position, w, h, getCatalogItem(obj.catalogId)?.loadValue ?? 0);
  }
  const { w, h } = getPlacedObjectSize(candidate);
  if (!tracker.canPlace(candidate.position, w, h, loadValue)) {
    // Non-spatial rule: the evidence is the whole attempted footprint.
    return [{
      ruleId: 'V-CHUNK-01',
      message: 'error.chunk_full',
      cells: getFootprint(candidate.position.x, candidate.position.y, w, h),
      grid: 'macro',
      severity: 'error',
    }];
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
    if (!CHUNK_LOAD_ENABLED) return []; // deliberate: load values unknown, placement is free for now
    return chunkLoadViolations(state, cmd.object, cmd.loadValue);
  },
};
