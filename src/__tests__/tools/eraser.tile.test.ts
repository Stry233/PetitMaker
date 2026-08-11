import { describe, it, expect } from 'vitest';
import { EraserTool } from '../../tools/paint/eraser';
import { placeTileCell } from '../../tools/paint/tile-coating';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { TerrainType, type EditorEvents, type MacroCoord } from '../../core/model/types';
import { makeState, setTerrain } from '../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from './_tool-ctx';
import { roadLookup } from '../../state/object-index';

const exec = (state: any) => new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
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
    expect(objectsByCatalog(state, 'road-dirt').length).toBe(1);

    const tileCtx = makeToolCtx(state, e, 1, 1, { contentType: 'tile' });
    const eraser = new EraserTool();
    eraser.onPointerDown(m(5, 5), m(5, 5), tileCtx);
    eraser.onPointerUp(m(5, 5), m(5, 5), tileCtx);

    expect(objectsByCatalog(state, 'road-dirt').length).toBe(0);
    expect(state.cells[5]![5]!.terrain?.type).toBe(TerrainType.Mountain); // terrain untouched
  });
});
