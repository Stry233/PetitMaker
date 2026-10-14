import { describe, it, expect } from 'vitest';
import { makeState, makeExecutor } from '../../_support/map-state';
import { CommandType, TerrainType, type Command } from '../../../core/model/types';
import { ProvSource } from '../../../core/provenance/types';

// Mirrors the wrapping `editor/operations/generate.ts` applies: paint inside a procedural source.
describe('generation provenance', () => {
  it('procedurally-painted terrain is procedural, not AI', () => {
    const s = makeState(8, 8);
    const e = makeExecutor(s);
    const start = e.beginStroke();
    e.transaction({ source: { source: ProvSource.Procedural, procedural: { seed: 42, algorithm: 'designed', configHash: 'abc' } } }, () => {
      e.execute({ type: CommandType.PaintTerrain, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command);
    });
    start.commit();
    const sum = e.getProvenanceSummary();
    expect(sum.containsProcedural).toBe(true);
    expect(sum.containsAi).toBe(false);
    expect(s.provenance!.ledger[0]!.procedural?.seed).toBe(42);
  });
});
