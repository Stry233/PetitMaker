import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { makeState, makeExecutor } from '../../_support/map-state';
import { createPlanetRegistry } from '../../../rules/index';

describe('ground-carrying terrain commands', () => {
  it('write the zone and undo restores it', () => {
    const state = makeState(8, 8);
    state.cells[3]![3]!.zone = CellZone.Void;
    const ex = makeExecutor(state, createPlanetRegistry());
    const r = ex.execute({ type: CommandType.PaintTerrain, cells: [{ x: 3, y: 3 }], terrainType: TerrainType.Mountain, elevation: 0, ground: CellZone.Grass });
    expect(r.success).toBe(true);
    expect(state.cells[3]![3]!.zone).toBe(CellZone.Grass);
    expect(state.cells[3]![3]!.terrain).toBeNull();
    ex.undo();
    expect(state.cells[3]![3]!.zone).toBe(CellZone.Void);
  });
  it('erase with ground turns bare ground into sea', () => {
    const state = makeState(8, 8);
    const ex = makeExecutor(state, createPlanetRegistry());
    ex.execute({ type: CommandType.EraseTerrain, cells: [{ x: 2, y: 2 }], ground: CellZone.Void });
    expect(state.cells[2]![2]!.zone).toBe(CellZone.Void);
  });
});
