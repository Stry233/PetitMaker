import { describe, it, expect } from 'vitest';
import { EraserTool } from '../../../../tools/pointer/paint/eraser';
import { placeTileCell } from '../../../../tools/pointer/paint/tile-coating';
import { TerrainType, type MacroCoord } from '../../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { makeToolCtx, objectsByCatalog } from '../../../_support/tool-ctx';
import { cell, point } from '../../../_support/grid';

const exec = (state: any) => makeExecutor(state);
const m = (x: number, y: number): MacroCoord => ({ x, y });

describe('EraserTool: tile surface', () => {
  it('removes a tile under the brush and leaves terrain', () => {
    const state = makeState(10, 10);
    // flat trait checks pos+1 in both axes — set all 4 cells to same elevation
    setTerrain(state, 5, 5, TerrainType.Mountain, 2);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2);
    setTerrain(state, 5, 6, TerrainType.Mountain, 2);
    setTerrain(state, 6, 6, TerrainType.Mountain, 2);
    const e = exec(state);
    placeTileCell(m(5, 5), makeToolCtx(state, e), new Set());
    expect(objectsByCatalog(state, 'path-overgrown-dirt').length).toBe(1);

    const tileCtx = makeToolCtx(state, e, 1, 1, { contentType: 'road' });
    const eraser = new EraserTool();
    eraser.onPointerDown(cell(m(5, 5)), point(m(5, 5)), tileCtx);
    eraser.onPointerUp(cell(m(5, 5)), point(m(5, 5)), tileCtx);

    expect(objectsByCatalog(state, 'path-overgrown-dirt').length).toBe(0);
    expect(state.cells[5]![5]!.terrain?.type).toBe(TerrainType.Mountain); // terrain untouched
  });
});
