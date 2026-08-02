/**
 * Stroke atomicity under exceptions: a write tool that crashes mid-stroke must
 * leave the map exactly as it found it — "Tool crashed" and "REVERTED" both
 * mean the map is unchanged.
 */
import { describe, it, expect } from 'vitest';
import { runStroke, runStrokeBody } from '../../agent/tools/tools-common';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, EditorEvents } from '../../core/model/types';
import type { AgentToolDeps } from '../../agent/tools';
import { makeState } from '../rules/_helpers';

function world() {
  const state = makeState(10, 10);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const deps = { getState: () => state, getExecutor: () => executor, getRegion: () => [] } as unknown as AgentToolDeps;
  return { state, executor, deps };
}

const paint = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, timestamp: 0,
  cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
});

describe('stroke crash rollback', () => {
  it('runStroke rolls back already-executed commands when a later step throws', () => {
    const { state, executor, deps } = world();
    const before = executor.getUndoStackSize();
    expect(() =>
      runStroke(deps, [paint(2, 2)], (n) => `ok ${n}`, undefined, () => {
        throw new Error('handler crashed');
      }),
    ).toThrow('handler crashed');
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('runStrokeBody rolls back the body\'s commands when it throws', async () => {
    const { state, executor, deps } = world();
    const before = executor.getUndoStackSize();
    await expect(
      runStrokeBody(deps, () => {
        executor.execute(paint(3, 3));
        throw new Error('body crashed');
      }),
    ).rejects.toThrow('body crashed');
    expect(state.cells[3]![3]!.terrain).toBeNull();
    expect(executor.getUndoStackSize()).toBe(before);
  });
});
