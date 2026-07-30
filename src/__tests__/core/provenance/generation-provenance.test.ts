// src/__tests__/tools/generation-provenance.test.ts
import { describe, it, expect } from 'vitest';
import { makeState } from '../../rules/_helpers';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { CommandType, TerrainType, type Command } from '../../../core/model/types';
import { ProvSource } from '../../../core/provenance/types';

// Mirrors the wrapping useGenerateRun will apply: paint inside a procedural source.
describe('generation provenance', () => {
  it('procedurally-painted terrain is procedural, not AI', () => {
    const s = makeState(8, 8);
    const e = new CommandExecutor(s, new EventBus(), createDefaultRegistry());
    const start = e.getUndoStackSize();
    e.withSource({ source: ProvSource.Procedural, procedural: { seed: 42, algorithm: 'random', configHash: 'abc' } }, () => {
      e.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 1, y: 1 }], terrainType: TerrainType.Mountain, elevation: 1 } as Command);
    });
    e.commitStrokeGroup(start);
    const sum = e.getProvenanceSummary();
    expect(sum.containsProcedural).toBe(true);
    expect(sum.containsAi).toBe(false);
    expect(e.getProvenanceTracker().state.ledger[0]!.procedural?.seed).toBe(42);
  });
});
