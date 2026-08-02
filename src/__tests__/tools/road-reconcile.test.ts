import { describe, it, expect } from 'vitest';
import { reconcileRoadsAfterMountainPaint } from '../../tools/paint/road-reconcile';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents, type Command, type PlacedObject } from '../../core/model/types';
import type { ToolContext } from '../../tools/types';
import { makeState, setTerrain } from '../rules/_helpers';

function makeCtx(state: any, executor: CommandExecutor): ToolContext {
  return {
    gridState: state,
    viewport: null as any,
    overlay: null as any,
    executeCommand: (cmd: Command) => executor.execute(cmd),
    rules: executor.getRegistry(),
    commitStroke: (s: number) => executor.commitStroke(s),
    validateCommand: (cmd: Command) => executor.getRegistry().validatePreCommand(cmd, state),
    undo: () => executor.undo(),
    getUndoStackSize: () => executor.getUndoStackSize(),
    collapseHistory: (s: number) => executor.collapseHistory(s),
    rollbackTo: (w: number) => executor.rollbackTo(w),
    t: (k: string) => k,
    setDisplayLayer: () => {},
    terrainType: TerrainType.Mountain,
    elevation: 1,
    brushSize: 1,
  };
}

function addRoad(state: any, x: number, y: number, elevation = 0): PlacedObject {
  const road: PlacedObject = {
    id: `road-${x}-${y}`, catalogId: 'road-dirt',
    position: { x, y }, rotation: 0, elevation,
  };
  state.objects.set(road.id, road);
  return road;
}

describe('reconcileRoadsAfterMountainPaint', () => {
  it('elevates a road whose 2x2 footprint became uniform mountain n+1', () => {
    const state = makeState(10, 10);
    addRoad(state, 5, 5, 0);
    for (const [cx, cy] of [[5,5],[6,5],[5,6],[6,6]] as [number, number][]) setTerrain(state, cx, cy, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    reconcileRoadsAfterMountainPaint([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }], makeCtx(state, executor));
    const road = [...state.objects.values()].find((o: any) => o.catalogId === 'road-dirt') as PlacedObject | undefined;
    expect(road).toBeDefined();
    expect(road!.elevation).toBe(1);
  });

  it('removes a road whose footprint straddles a cliff edge', () => {
    const state = makeState(10, 10);
    addRoad(state, 5, 5, 0);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    reconcileRoadsAfterMountainPaint([{ x: 6, y: 5 }, { x: 6, y: 6 }], makeCtx(state, executor));
    const road = [...state.objects.values()].find((o: any) => o.catalogId === 'road-dirt');
    expect(road).toBeUndefined();
  });

  it('leaves an unaffected road untouched (no churn)', () => {
    const state = makeState(10, 10);
    const road = addRoad(state, 1, 1, 0);
    setTerrain(state, 8, 8, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    reconcileRoadsAfterMountainPaint([{ x: 8, y: 8 }], makeCtx(state, executor));
    expect(state.objects.get(road.id)).toBeDefined();
    expect(state.objects.get(road.id)!.elevation).toBe(0);
  });

  it('preserves road corners and rotation when elevating', () => {
    const state = makeState(10, 10);
    const road = addRoad(state, 5, 5, 0);
    road.corners = ['square', 'square', 'square', 'fan'];
    for (const [cx, cy] of [[5,5],[6,5],[5,6],[6,6]] as [number, number][]) setTerrain(state, cx, cy, TerrainType.Mountain, 1);
    const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
    reconcileRoadsAfterMountainPaint([{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }], makeCtx(state, executor));
    const elevated = [...state.objects.values()].find((o: any) => o.catalogId === 'road-dirt') as PlacedObject | undefined;
    expect(elevated?.elevation).toBe(1);
    expect(elevated?.corners).toEqual(['square', 'square', 'square', 'fan']);
  });
});
