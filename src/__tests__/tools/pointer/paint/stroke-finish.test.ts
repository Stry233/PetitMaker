/** The shared end of a paint stroke: rules back to the mark, the water remedy, the trim folded into the stroke. */
import { describe, it, expect } from 'vitest';
import { finishPaintStroke, type StrokeFinishCtx } from '../../../../tools/pointer/paint/stroke-finish';
import { CommandType, TerrainType, type Command, type GridState, type MacroCoord } from '../../../../core/model/types';
import type { CommandExecutor } from '../../../../core/commands/command-executor';
import { makeExecutor, makeState, setTerrain } from '../../../_support/map-state';
import { roadLookup } from '../../../../state/object-index';

function ctxOf(state: GridState, ex: CommandExecutor): StrokeFinishCtx {
  return {
    state,
    roads: roadLookup(state),
    execute: (cmd) => ex.execute(cmd),
    registry: ex.getRegistry(),
  };
}

const paint = (cells: MacroCoord[], terrainType: TerrainType, elevation: number): Command =>
  ({ type: CommandType.PaintTerrain, cells, terrainType, elevation } as Command);

describe('finishing a paint stroke', () => {
  it('reverts a refused water stroke and names the one layer that would hold it', () => {
    const state = makeState(20, 20);
    for (let y = 4; y <= 8; y++) for (let x = 4; x <= 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    const ex = makeExecutor(state);
    const start = ex.beginStroke();
    ex.execute(paint([{ x: 8, y: 8 }], TerrainType.Water, 2));
    const outcome = finishPaintStroke(ctxOf(state, ex), { stroke: start, terrainCells: [{ x: 8, y: 8 }], water: true, trim: 'off' });
    expect(outcome.violations.length).toBeGreaterThan(0);
    expect(outcome.committed).toBe(false);
    expect(outcome.waterLayer).toBe(3);
    expect(state.cells[8]![8]!.terrain).toEqual({ type: TerrainType.Mountain, elevation: 3 });
  });

  it('folds the trim sweep into the stroke, so one undo takes both back', () => {
    const state = makeState(20, 20);
    const ex = makeExecutor(state);
    const start = ex.beginStroke();
    const cells: MacroCoord[] = [];
    for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) cells.push({ x, y });
    ex.execute(paint(cells, TerrainType.Mountain, 1));
    const outcome = finishPaintStroke(ctxOf(state, ex), { stroke: start, terrainCells: cells, water: false, trim: 'round' });
    expect(outcome.violations).toEqual([]);
    expect(outcome.committed).toBe(true);
    expect(outcome.trimmed.length).toBeGreaterThan(0);
    expect(start.size).toBe(1);
  });
});

describe('the trim sweep and locked layers', () => {
  it.each(['round', 'rect'] as const)('leaves a neighbour standing on a locked layer unreshaped with %s', mode => {
    const state = makeState(10, 10);
    setTerrain(state, 7, 2, TerrainType.Mountain, 3);
    state.lockedLayers.add(2);
    const locked = structuredClone(state.cells[2]![7]!.terrain);
    const ex = makeExecutor(state);
    const start = ex.beginStroke();
    const cells: MacroCoord[] = [{ x: 6, y: 3 }, { x: 5, y: 3 }];
    ex.execute(paint(cells, TerrainType.Water, 0));
    const outcome = finishPaintStroke(ctxOf(state, ex), { stroke: start, terrainCells: cells, water: true, trim: mode });
    expect(outcome.committed).toBe(true);
    expect(state.cells[2]![7]!.terrain).toEqual(locked);
  });

  it('leaves a neighbour standing on a hidden layer unreshaped', () => {
    const state = makeState(10, 10);
    setTerrain(state, 7, 2, TerrainType.Mountain, 3);
    const hidden = structuredClone(state.cells[2]![7]!.terrain);
    const ex = makeExecutor(state);
    const start = ex.beginStroke();
    const cells: MacroCoord[] = [{ x: 6, y: 3 }, { x: 5, y: 3 }];
    ex.execute(paint(cells, TerrainType.Water, 0));
    finishPaintStroke(ctxOf(state, ex), { stroke: start, terrainCells: cells, water: true, trim: 'round', layerVisibility: { 3: false } });
    expect(state.cells[2]![7]!.terrain).toEqual(hidden);
  });
});
