/**
 * The kernel's cell lists name their grid: an object edit reports its anchor on the placement grid
 * and touches no terrain cell, so an undo flashes the object's footprint and nothing half a cell off.
 */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { createExecutor } from '../../../state/executor';
import { createDefaultRegistry } from '../../../rules/index';
import { makeState } from '../../_support/map-state';
import { paintTerrainCommand, placeObjectCommand, trimRoadCommand, trimTerrainCommand } from '../../../core/model/command-build';
import { commandGrid } from '../../../core/model/grid-model';
import { getRoadMaterials } from '../../../state/catalog';
import { resolveHistoryFlash } from '../../../view/shared/overlay/error-flash';
import { TerrainType } from '../../../core/model/types';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';
import type { EditorEvents } from '../../../state/editing/events';

function world() {
  const state = makeState();
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  const events: { name: 'cells-changed' | 'history-applied'; payload: unknown }[] = [];
  bus.on('cells-changed', (payload) => { events.push({ name: 'cells-changed', payload }); });
  bus.on('history-applied', (payload) => { events.push({ name: 'history-applied', payload }); });
  return { state, bus, executor, events };
}

function placeRoad(executor: ReturnType<typeof createExecutor>) {
  const road = getRoadMaterials()[0]!;
  const stroke = executor.beginStroke();
  const result = executor.execute(placeObjectCommand({ id: 'probe', catalogId: road.id, position: { x: 10, y: 10 }, rotation: 0, elevation: 0 }));
  stroke.commit();
  return result;
}

describe('kernel event grids', () => {
  it('flashes only the object footprint when an object placement is undone', () => {
    const { executor, events } = world();
    expect(placeRoad(executor).success).toBe(true);
    events.length = 0;
    executor.undo();
    const applied = events.find((e) => e.name === 'history-applied')!.payload as EditorEvents['history-applied'];
    const flash = resolveHistoryFlash(applied.cells, applied.objects);
    expect(flash.map((set) => set.grid)).toEqual([PLACEMENT_GRID]);
  });

  it('reports an object placement on the placement grid and no terrain cell', () => {
    const { executor, events } = world();
    placeRoad(executor);
    const changed = events.find((e) => e.name === 'cells-changed')!.payload as EditorEvents['cells-changed'];
    expect(changed.cells).toEqual([{ grid: PLACEMENT_GRID, cells: [{ x: 10, y: 10 }] }]);
    expect(executor.getUndoEntries().at(-1)!.before).toEqual([]);
  });

  it('reports a terrain paint and its undo on the terrain grid', () => {
    const { executor, events } = world();
    const stroke = executor.beginStroke();
    executor.execute(paintTerrainCommand([{ x: 4, y: 4 }], TerrainType.Mountain, 1));
    stroke.commit();
    executor.undo();
    const applied = events.find((e) => e.name === 'history-applied')!.payload as EditorEvents['history-applied'];
    expect(applied.cells).toEqual([{ grid: TERRAIN_GRID, cells: [{ x: 4, y: 4 }] }]);
  });

  it('puts a corner trim on the grid of the layer it cuts', () => {
    const corners = ['square', 'square', 'square', 'square'] as const;
    expect(commandGrid(trimTerrainCommand(1, 1, [...corners]))).toBe(TERRAIN_GRID);
    expect(commandGrid(trimRoadCommand({ id: 'r' }, 1, 1, [...corners]))).toBe(PLACEMENT_GRID);
  });
});
