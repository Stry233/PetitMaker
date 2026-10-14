import { describe, it, expect } from 'vitest';
import { chunkLoadViolations, chunkLoadRule } from '../../rules/chunk-load';
import { CommandType, type PlacedObject, type PlaceObjectCommand } from '../../core/model/types';
import { getCatalogItem } from '../../state/catalog';
import { makeState } from '../_support/map-state';
import { CHUNK_LOAD_LIMIT } from '../../core/game/profile';

function obj(id: string, x: number, y: number, catalogId = 'flower-protea'): PlacedObject {
  return { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 };
}

describe('chunkLoadViolations (footprint-aware enforcement logic)', () => {
  it('allows a candidate exactly at the limit, rejects one over it', () => {
    const state = makeState(20, 20);
    expect(chunkLoadViolations(state, obj('c', 0, 0), 10_000)).toHaveLength(0); // == limit, allowed
    expect(chunkLoadViolations(state, obj('c', 0, 0), 10_001)).toHaveLength(1); // over limit
  });

  it('reports the limit as a message param', () => {
    const [violation] = chunkLoadViolations(makeState(20, 20), obj('c', 0, 0), CHUNK_LOAD_LIMIT + 1);
    expect(violation?.messageParams).toEqual({ max: CHUNK_LOAD_LIMIT });
  });

  it('sums load from objects already in the same chunk', () => {
    const state = makeState(20, 20);
    state.objects.set('e', obj('e', 0, 0)); // Measured flower load.
    expect(getCatalogItem('flower-protea')!.loadValue).toBeGreaterThan(0);
    // existing load + a candidate at the limit (same chunk 0,0) exceeds the limit
    expect(chunkLoadViolations(state, obj('c', 1, 1), 10_000)).toHaveLength(1);
  });

  it('does not count objects in a different chunk', () => {
    const state = makeState(40, 40);
    state.objects.set('e', obj('e', 0, 0)); // chunk (0,0)
    // candidate in chunk (1,1) — separate accounting, so a full-limit candidate is allowed
    expect(chunkLoadViolations(state, obj('c', 20, 20), 10_000)).toHaveLength(0);
  });

  it('uses the template origin for both existing objects and candidate footprints', () => {
    const state = makeState(40, 40);
    state.template.chunkGrid = { origin: { x: -15, y: -23 }, columns: 13, rows: 12 };
    state.objects.set('e', obj('e', 16, 24));
    expect(chunkLoadViolations(state, obj('c', 17, 25), 10_000)).toHaveLength(0);
    expect(chunkLoadViolations(state, obj('c', 1, 9), 10_000)).toHaveLength(1);
    const straddling = { ...obj('c', 16.5, 24.5), width: 1, height: 1 };
    expect(chunkLoadViolations(state, straddling, 10_000)).toHaveLength(1);
    expect(chunkLoadViolations(state, obj('e', 16, 24), 10_000)).toHaveLength(0);
  });

  it('uses catalog prices and honors the map enforcement switch', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < CHUNK_LOAD_LIMIT / getCatalogItem('flower-protea')!.loadValue; i++) {
      state.objects.set(`existing-${i}`, obj(`existing-${i}`, i % 10, Math.floor(i / 10)));
    }
    const cmd: PlaceObjectCommand = {
      type: CommandType.PlaceObject,       object: obj('candidate', 12, 12),
    };
    expect(chunkLoadRule.validate(cmd, state)).toHaveLength(1);
    state.ignoreChunkLoad = true;
    expect(chunkLoadRule.validate(cmd, state)).toHaveLength(0);
    state.ignoreChunkLoad = false;
    expect(chunkLoadRule.validate(cmd, state)).toHaveLength(1);
    expect(chunkLoadRule.validate({ ...cmd, object: obj('unknown', 12, 12, 'shrub') }, state)).toHaveLength(0);
  });

  it('permits a neutral replacement on an overloaded imported map', () => {
    const state = makeState(20, 20);
    for (let i = 0; i < 120; i++) state.objects.set(`existing-${i}`, obj(`existing-${i}`, 1, 1));
    expect(chunkLoadViolations(state, obj('existing-0', 2, 2), getCatalogItem('flower-protea')!.loadValue)).toHaveLength(0);
  });
});
