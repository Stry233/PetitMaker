/** A stroke transaction scopes authorship and silence to its body and reverts its group on a throw. */
import { describe, it, expect, vi } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, TerrainType, type Command, type PlacedObject } from '../../../core/model/types';
import { type EditorEvents } from '../../../state/editing/events';
import { createDefaultRegistry } from '../../../rules/index';
import { ProvSource } from '../../../core/provenance/types';
import { makeState } from '../../_support/map-state';
import { ANCHOR_LANDMARK } from '../../_support/anchor';
import { createExecutor } from '../../../state/executor';

const mountain = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1,
});
const floatingWater = (x: number, y: number): Command => ({
  type: CommandType.PaintTerrain, cells: [{ x, y }], terrainType: TerrainType.Water, elevation: 1,
});
const plaza: PlacedObject = {
  id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 14.5, y: 14.5 }, width: 3, height: 3, rotation: 0, elevation: 0, locked: true,
};
const refused: Command = { type: CommandType.RemoveObject, objectId: ANCHOR_LANDMARK.id};

function world() {
  const state = makeState();
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  const failures: number[] = [];
  bus.on('validation-failed', () => { failures.push(1); });
  return { state, executor, failures, source: () => executor.getAuthorship().currentSource().source };
}

describe('CommandExecutor.transaction', () => {
  it('pushes the source for the body only and commits the group as one entry', () => {
    const { state, executor, source } = world();
    let inside: ProvSource | undefined;
    const violations = executor.transaction({ source: { source: ProvSource.Procedural } }, (tx) => {
      expect(tx.size).toBe(0);
      executor.execute(mountain(2, 2));
      executor.execute(mountain(4, 4));
      inside = source();
      return tx.commit();
    });
    expect(violations).toEqual([]);
    expect(inside).toBe(ProvSource.Procedural);
    expect(source()).toBe(ProvSource.Human);
    expect(executor.historyDepth()).toBe(1);
    expect(state.cells[4]![4]!.terrain).not.toBeNull();
  });

  it('silences refusals across the body when asked, and only then', () => {
    const { state, executor, failures } = world();
    state.objects.set(ANCHOR_LANDMARK.id, plaza);
    executor.transaction({ silent: true }, () => { executor.execute(refused); });
    expect(failures).toHaveLength(0);
    executor.transaction({}, () => { executor.execute(refused); });
    expect(failures).toHaveLength(1);
  });

  it('reverts only until clean on a plain commit and the whole group on an atomic one', () => {
    const partial = world();
    partial.executor.transaction({}, (tx) => {
      partial.executor.execute(mountain(5, 5));
      partial.executor.execute(floatingWater(5, 8));
      expect(tx.commit()).not.toEqual([]);
    });
    expect(partial.state.cells[5]![5]!.terrain).not.toBeNull();
    expect(partial.executor.historyDepth()).toBe(1);

    const atomic = world();
    atomic.executor.transaction({}, (tx) => {
      atomic.executor.execute(mountain(5, 5));
      atomic.executor.execute(floatingWater(5, 8));
      expect(tx.commit({ atomic: true })).not.toEqual([]);
    });
    expect(atomic.state.cells[5]![5]!.terrain).toBeNull();
    expect(atomic.executor.historyDepth()).toBe(0);
  });

  it('rolls back on request', () => {
    const { state, executor } = world();
    executor.transaction({}, (tx) => { executor.execute(mountain(2, 2)); tx.rollback(); });
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(0);
  });

  it('reverts the group and pops the source when the body throws', () => {
    const { state, executor, source } = world();
    expect(() => executor.transaction({ source: { source: ProvSource.AiWrite } }, () => {
      executor.execute(mountain(2, 2));
      throw new Error('body fault');
    })).toThrow('body fault');
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(0);
    expect(source()).toBe(ProvSource.Human);
  });

  it('holds source and silence across awaits and reverts an async throw', async () => {
    const { state, executor, failures, source } = world();
    state.objects.set(ANCHOR_LANDMARK.id, plaza);
    await executor.transactionAsync({ source: { source: ProvSource.Procedural }, silent: true }, async (tx) => {
      await Promise.resolve();
      expect(source()).toBe(ProvSource.Procedural);
      executor.execute(refused);
      executor.execute(mountain(2, 2));
      tx.commit();
    });
    expect(failures).toHaveLength(0);
    expect(source()).toBe(ProvSource.Human);
    expect(executor.historyDepth()).toBe(1);

    await expect(executor.transactionAsync({}, async () => {
      executor.execute(mountain(6, 6));
      await Promise.resolve();
      throw new Error('async fault');
    })).rejects.toThrow('async fault');
    expect(state.cells[6]![6]!.terrain).toBeNull();
    expect(executor.historyDepth()).toBe(1);
  });

  it('keeps silence while any overlapping silent run is open and lifts it once all have settled', async () => {
    const { state, executor, failures } = world();
    state.objects.set(ANCHOR_LANDMARK.id, plaza);
    let releaseFirst = () => {};
    let releaseSecond = () => {};
    const first = executor.transactionAsync({ silent: true }, () => new Promise<void>((r) => { releaseFirst = r; }));
    const second = executor.transactionAsync({ silent: true }, () => new Promise<void>((r) => { releaseSecond = r; }));
    releaseFirst();
    await first;
    executor.execute(refused);
    expect(failures, 'the second run is still silent').toHaveLength(0);
    releaseSecond();
    await second;
    executor.execute(refused);
    expect(failures, 'both settled: refusals speak again').toHaveLength(1);
  });

  it('keeps the body\'s error when the rollback itself throws', () => {
    const { executor } = world();
    const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(executor, 'rollbackTo').mockImplementation(() => { throw new Error('rollback fault'); });
    expect(() => executor.transaction({ source: { source: ProvSource.AiWrite } }, () => {
      executor.execute(mountain(2, 2));
      throw new Error('body fault');
    })).toThrow('body fault');
    expect(logged).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ message: 'rollback fault' }));
    expect(executor.getAuthorship().currentSource().source).toBe(ProvSource.Human);
    vi.restoreAllMocks();
  });

  it('nests: an inner group commits inside the outer, and an outer throw takes both back', () => {
    const { state, executor, source } = world();
    const seen: ProvSource[] = [];
    executor.transaction({ source: { source: ProvSource.Procedural } }, (outer) => {
      executor.execute(mountain(2, 2));
      executor.transaction({ source: { source: ProvSource.AiWrite } }, (inner) => {
        expect([outer.size, inner.size]).toEqual([1, 0]);
        executor.execute(mountain(4, 4));
        seen.push(source());
        inner.commit();
      });
      seen.push(source());
      expect(executor.historyDepth()).toBe(2);
      outer.commit();
    });
    expect(seen).toEqual([ProvSource.AiWrite, ProvSource.Procedural]);
    expect(executor.historyDepth()).toBe(1);

    expect(() => executor.transaction({}, () => {
      executor.execute(mountain(6, 6));
      executor.transaction({}, (inner) => { executor.execute(mountain(8, 8)); inner.commit(); });
      throw new Error('outer fault');
    })).toThrow('outer fault');
    expect(state.cells[6]![6]!.terrain).toBeNull();
    expect(state.cells[8]![8]!.terrain).toBeNull();
    expect(state.cells[4]![4]!.terrain).not.toBeNull();
    expect(executor.historyDepth()).toBe(1);
    expect(source()).toBe(ProvSource.Human);
  });
});
