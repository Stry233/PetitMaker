import { describe, it, expect } from 'vitest';
import { chunkLoadViolations, chunkLoadRule } from '../../rules/chunk-load';
import { CommandType, type PlacedObject, type PlaceObjectCommand } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { makeState } from './_helpers';

function obj(id: string, x: number, y: number, catalogId = 'path-overgrown-dirt'): PlacedObject {
  return { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 };
}

// The rule is gated off (CHUNK_LOAD_ENABLED=false) because real in-game loads are unknown,
// so these exercise the wired enforcement logic (chunkLoadViolations) directly. The current
// load is summed from the placed objects via the catalog loadValues.
describe('chunkLoadViolations (footprint-aware enforcement logic)', () => {
  it('allows a candidate exactly at the limit, rejects one over it', () => {
    const state = makeState(20, 20);
    expect(chunkLoadViolations(state, obj('c', 0, 0), 10_000)).toHaveLength(0); // == limit, allowed
    expect(chunkLoadViolations(state, obj('c', 0, 0), 10_001)).toHaveLength(1); // over limit
  });

  it('sums load from objects already in the same chunk', () => {
    const state = makeState(20, 20);
    state.objects.set('e', obj('e', 0, 0)); // the dirt path has a non-zero load
    expect(getCatalogItem('path-overgrown-dirt')!.loadValue).toBeGreaterThan(0);
    // existing load + a candidate at the limit (same chunk 0,0) exceeds the limit
    expect(chunkLoadViolations(state, obj('c', 1, 1), 10_000)).toHaveLength(1);
  });

  it('does not count objects in a different chunk', () => {
    const state = makeState(40, 40);
    state.objects.set('e', obj('e', 0, 0)); // chunk (0,0)
    // candidate in chunk (1,1) — separate accounting, so a full-limit candidate is allowed
    expect(chunkLoadViolations(state, obj('c', 20, 20), 10_000)).toHaveLength(0);
  });

  it('rule is gated off — placement is currently free even over the limit', () => {
    const state = makeState(20, 20);
    const cmd: PlaceObjectCommand = {
      type: CommandType.PlaceObject, timestamp: 0,
      object: obj('c', 0, 0), loadValue: 999_999,
    };
    expect(chunkLoadRule.validate(cmd, state)).toHaveLength(0);
  });
});
