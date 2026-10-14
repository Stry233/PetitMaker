import { describe, expect, it } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, TerrainType, type Command } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { createDefaultRegistry } from '../../../rules/index';
import { ProvSource } from '../../../core/provenance/types';
import { makeState } from '../../_support/map-state';
import { createExecutor } from '../../../state/executor';

const mountain = (x: number, y: number, elevation = 1): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation,
});
const floatingWater = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Water, elevation: 1,
});

function world() {
  const state = makeState();
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  const whole = executor.beginStroke();
  const events: string[] = [];
  for (const name of ['cells-changed', 'history-changed', 'history-applied'] as const) bus.on(name, () => { events.push(name); });
  return { state, executor, events, whole };
}

function stroke(executor: CommandExecutor, ...cmds: Command[]) {
  const start = executor.beginStroke();
  for (const cmd of cmds) expect(executor.execute(cmd).success).toBe(true);
  return start.commit();
}

describe('undo and redo at the edges', () => {
  it('undo and redo on empty stacks change nothing and announce nothing', () => {
    const { state, executor, events } = world();
    const before = JSON.stringify(state.cells);
    expect(executor.undo()).toBe(false);
    executor.redo();
    expect(events).toEqual([]);
    expect(JSON.stringify(state.cells)).toBe(before);
    expect(executor.canUndo()).toBe(false);
    expect(executor.canRedo()).toBe(false);
  });

  it('runs out after the last step in both directions', () => {
    const { state, executor } = world();
    stroke(executor, mountain(2, 2));
    expect(executor.undo()).toBe(true);
    expect(executor.undo()).toBe(false);
    executor.redo();
    executor.redo();
    expect(state.cells[2]![2]!.terrain).toMatchObject({ elevation: 1 });
    expect(executor.canRedo()).toBe(false);
    expect(executor.historyDepth()).toBe(1);
  });

  it('a commit with nothing executed is no step', () => {
    const { executor, whole } = world();
    expect(whole.commit()).toEqual([]);
    expect(executor.canUndo()).toBe(false);
  });
});

describe('an async transaction cancelled mid-body', () => {
  it('takes back its own commands, keeps earlier strokes and pops its source', async () => {
    const { state, executor } = world();
    stroke(executor, mountain(1, 1));
    const controller = new AbortController();
    const cancelled = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')));
    });
    const run = executor.transactionAsync({ source: { source: ProvSource.Procedural }, silent: true }, async (tx) => {
      executor.execute(mountain(4, 4));
      executor.execute(mountain(5, 5));
      await cancelled;
      tx.commit();
    });
    await Promise.resolve();
    expect(state.cells[5]![5]!.terrain).not.toBeNull();
    controller.abort();
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(state.cells[4]![4]!.terrain).toBeNull();
    expect(state.cells[5]![5]!.terrain).toBeNull();
    expect(state.cells[1]![1]!.terrain).not.toBeNull();
    expect(executor.historyDepth()).toBe(1);
    expect(executor.getAuthorship().currentSource().source).toBe(ProvSource.Human);
    // The surviving stroke still undoes and redoes as one step.
    executor.undo();
    expect(state.cells[1]![1]!.terrain).toBeNull();
    executor.redo();
    expect(state.cells[1]![1]!.terrain).not.toBeNull();
  });
});

describe('post-stroke violations', () => {
  it('a reverted fragment never reaches redo and leaves the earlier steps undoable', () => {
    const { state, executor } = world();
    stroke(executor, mountain(2, 2));
    const violations = stroke(executor, mountain(5, 5), floatingWater(5, 8));
    expect(violations.length).toBeGreaterThan(0);
    expect(state.cells[8]![5]!.terrain).toBeNull();
    expect(state.cells[5]![5]!.terrain).not.toBeNull();
    expect(executor.canRedo()).toBe(false);
    expect(executor.historyDepth()).toBe(2);

    executor.undo();
    expect(state.cells[5]![5]!.terrain).toBeNull();
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    executor.undo();
    expect(state.cells[2]![2]!.terrain).toBeNull();
    executor.redo();
    executor.redo();
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    expect(state.cells[5]![5]!.terrain).not.toBeNull();
    expect(state.cells[8]![5]!.terrain).toBeNull();
  });

  it('a stroke never reverts below its own start, even over a violation an earlier step left', () => {
    const { state, executor } = world();
    stroke(executor, mountain(2, 2));
    // The map already breaks a post-stroke rule (as an imported map may), outside any history entry.
    state.cells[8]![5]!.terrain = { type: TerrainType.Water, elevation: 1 };
    const violations = stroke(executor, mountain(12, 12));
    expect(violations.length).toBeGreaterThan(0);
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
    expect(state.cells[8]![5]!.terrain).not.toBeNull();
    expect(executor.historyDepth()).toBeGreaterThanOrEqual(1);
  });

  it('undo keeps going through steps that would leave the map illegal, and redo brings the same steps back', () => {
    const built = world();
    const ring: Command[] = [];
    for (let y = 7; y <= 9; y++) for (let x = 4; x <= 6; x++) if (x !== 5 || y !== 8) ring.push(mountain(x, y));
    expect(stroke(built.executor, ...ring)).toEqual([]);
    expect(stroke(built.executor, { ...floatingWater(5, 8) })).toEqual([]);
    const [ringEntry, waterEntry] = built.executor.getUndoEntries();

    // A history whose top step's revert alone would strand the water, as a restored history can be.
    const { state, executor } = world();
    for (const cmd of ring) executor.execute(cmd);
    executor.execute(floatingWater(5, 8));
    executor.restoreHistory([waterEntry!, ringEntry!]);
    expect(executor.undo()).toBe(true);
    expect(state.cells[8]![5]!.terrain).toBeNull();
    expect(state.cells[7]![4]!.terrain).toBeNull();
    expect(executor.canUndo()).toBe(false);

    executor.redo();
    expect(executor.getRegistry().validatePostStroke(state)).toEqual([]);
    expect(state.cells[8]![5]!.terrain).toMatchObject({ type: TerrainType.Water });
    expect(state.cells[7]![4]!.terrain).toMatchObject({ type: TerrainType.Mountain });
    expect(executor.canRedo()).toBe(false);
  });
});

describe('provenance across undo', () => {
  it('undo takes back the taint of an AI stroke and redo brings it back', () => {
    const { executor } = world();
    executor.transaction({ source: { source: ProvSource.AiWrite } }, () => { stroke(executor, mountain(3, 3)); });
    const tainted = executor.getProvenanceSummary();
    expect(tainted.containsAi).toBe(true);
    executor.undo();
    expect(executor.getProvenanceSummary().containsAi).toBe(false);
    executor.redo();
    expect(executor.getProvenanceSummary()).toEqual(tainted);
  });

  it('a human stroke over AI cells is attributed to the human, and undoing it restores the AI taint', () => {
    const { executor } = world();
    executor.transaction({ source: { source: ProvSource.AiWrite } }, () => { stroke(executor, mountain(3, 3)); });
    const ai = executor.getProvenanceSummary();
    stroke(executor, mountain(3, 3, 2));
    executor.undo();
    expect(executor.getProvenanceSummary()).toEqual(ai);
  });

  it('a cancelled AI transaction leaves no taint behind', async () => {
    const { executor } = world();
    await expect(executor.transactionAsync({ source: { source: ProvSource.AiWrite } }, async () => {
      executor.execute(mountain(6, 6));
      await Promise.resolve();
      throw new DOMException('Cancelled', 'AbortError');
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(executor.getProvenanceSummary().containsAi).toBe(false);
  });
});
