import { describe, it, expect, vi } from 'vitest';
import { applyTrim } from '../../../../core/domain/edge-cut/trim-apply';
import { applyCommand } from '../../../../core/commands/command-apply';
import { EventBus } from '../../../../core/commands/event-bus';
import type { KernelEvents } from '../../../../core/commands/events';
import { materialisePatchCommand, trimRoadCommand, trimTerrainCommand } from '../../../../core/model/command-build';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { makeState, setTerrain } from '../../../_support/map-state';

const road = (): PlacedObject => ({ id: 'r', catalogId: 'path-overgrown-dirt', position: { x: 3, y: 3 }, rotation: 0, elevation: 0 });

describe('applyTrim', () => {
  it('recuts terrain, and gives bare ground a None cell to carry its corners', () => {
    const state = makeState(8, 8);
    setTerrain(state, 2, 2, TerrainType.Mountain, 1);
    applyTrim(trimTerrainCommand(2, 2, ['fan', 'square', 'square', 'square']), state, () => {});
    expect(state.cells[2]![2]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 1, corners: ['fan', 'square', 'square', 'square'] });
    applyTrim(trimTerrainCommand(5, 5, ['fan', 'square', 'square', 'square']), state, () => {});
    expect(state.cells[5]![5]!.terrain?.type).toBe(TerrainType.None);
    applyTrim(trimTerrainCommand(5, 5, ['square', 'square', 'square', 'square']), state, () => {});
    expect(state.cells[5]![5]!.terrain).toBeNull();
  });

  it('lays a patch over whatever stood on the cell, with no base it was not given', () => {
    const state = makeState(8, 8);
    applyTrim(materialisePatchCommand(4, 4, ['empty', 'fan', 'empty', 'empty'], { terrainType: TerrainType.Mountain, elevation: 2, patchBase: 0 }), state, () => {});
    expect(state.cells[4]![4]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 2, patchOnly: true, corners: ['empty', 'fan', 'empty', 'empty'], patchBase: 0 });
  });

  it('recuts and turns a road in place, and deletes it when every corner is cut away', () => {
    const state = makeState(8, 8);
    state.objects.set('r', road());
    const changes = vi.fn();
    applyTrim(trimRoadCommand({ id: 'r' }, 3, 3, ['fan', 'square', 'square', 'square'], 90), state, changes);
    expect(state.objects.get('r')).toMatchObject({ corners: ['fan', 'square', 'square', 'square'], rotation: 90 });
    applyTrim(trimRoadCommand({ id: 'r' }, 3, 3, ['empty', 'empty', 'empty', 'empty']), state, changes);
    expect(state.objects.has('r')).toBe(false);
    expect(changes.mock.calls.map(([c]) => Object.keys(c as object))).toEqual([['removed', 'added'], ['removed']]);
  });

  it('is what the kernel hands a trim to', () => {
    const state = makeState(8, 8);
    const trims = vi.fn();
    const cmd = trimTerrainCommand(1, 1, ['fan', 'square', 'square', 'square']);
    applyCommand(cmd, state, new EventBus<KernelEvents>(), trims);
    expect(trims).toHaveBeenCalledWith(cmd, state, expect.any(Function));
    expect(state.cells[1]![1]!.terrain).toBeNull();
  });
});
