/**
 * Stroke atomicity under exceptions: a write tool that crashes mid-stroke must
 * leave the map exactly as it found it, including edits applied before the crash.
 */
import { describe, it, expect } from 'vitest';
import { runStroke, runStrokeBody } from '../../../agent/tools/stroke';
import { CommandType, TerrainType } from '../../../core/model/types';
import type { Command } from '../../../core/model/types';
import type { AgentToolDeps } from '../../../agent/tools';
import { makeState, makeExecutor } from '../../_support/map-state';

function world() {
  const state = makeState(10, 10);
  const executor = makeExecutor(state);
  const deps = { getState: () => state, getExecutor: () => executor, getRegion: () => [] } as unknown as AgentToolDeps;
  return { state, executor, deps };
}

const paint = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain,   cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
});

describe('stroke crash rollback', () => {
  it('counts all retained edits after a callback stroke is partially rolled back and grouped', async () => {
    const { state, executor, deps } = world();
    const result = await runStrokeBody(deps, 'the edit', () => {
      executor.execute(paint(5, 5));
      for (const x of [1, 7]) {
        expect(executor.execute({
          type: CommandType.PlaceObject,           object: { id: `tree-${x}`, catalogId: 'tree-apple', position: { x, y: 1 }, rotation: 0, elevation: 0 },
        }).success).toBe(true);
      }
      executor.execute({
        type: CommandType.PaintTerrain,         cells: [{ x: 5, y: 8 }], terrainType: TerrainType.Water, elevation: 1,
      });
    });
    expect('refusal' in result && result.refusal.detail).toMatchObject({ reverted: true, partialRevert: true, cells: 1, objects: 2 });
    expect(executor.historyDepth()).toBe(1);
    expect(state.cells[8]![5]!.terrain).toBeNull();
    executor.undo();
    expect(state.objects.size).toBe(0);
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('runStroke rolls back already-executed commands when a later step throws', () => {
    const { state, executor, deps } = world();
    const before = executor.historyDepth();
    expect(() =>
      runStroke(deps, [paint(2, 2)], (n) => `ok ${n}`, { afterApply: () => {
        throw new Error('handler crashed');
      } }),
    ).toThrow('handler crashed');
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(before);
  });

  it('runStrokeBody rolls back the body\'s commands when it throws', async () => {
    const { state, executor, deps } = world();
    const before = executor.historyDepth();
    await expect(
      runStrokeBody(deps, 'the edit', () => {
        executor.execute(paint(3, 3));
        throw new Error('body crashed');
      }),
    ).rejects.toThrow('body crashed');
    expect(state.cells[3]![3]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(before);
  });
});
