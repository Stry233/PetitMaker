/**
 * Every field of a map cell survives each copy and wire it crosses: the clone, the scratch grid,
 * the worker wire, the fingerprint, the save token and the share codec. `FULL_TERRAIN` must name
 * every `TerrainCell` field, so a new field fails to compile here until each path is checked.
 */
import { describe, expect, it } from 'vitest';
import { TerrainType, type MacroCell, type TerrainCell } from '../../../core/model/types';
import { CellZone } from '../../../core/game/zones';
import { cloneCell, cloneTerrain, sameTerrain, scratchGrid } from '../../../core/model/grid-model';
import { decodeCells, encodeCells } from '../../../core/model/grid-wire';
import { mapFingerprint } from '../../../core/model/fingerprint';
import { parseTerrain, terrainToken } from '../../../io/save/terrain-token';
import { parseToken, tokenOf } from '../../../io/share/codec/grid-io';
import { makeState } from '../../_support/map-state';

const FULL_TERRAIN = {
  type: TerrainType.Mountain, elevation: 3, corners: ['fan', 'square', 'tri-NE', 'empty'], patchOnly: true, patchBase: 2,
} satisfies Required<TerrainCell>;
const FULL_CELL = { zone: CellZone.Boundary, under: CellZone.Beach, terrain: FULL_TERRAIN } satisfies Required<MacroCell>;

/** One cell differing from `FULL_CELL` in each field. */
const VARIANTS: Record<string, MacroCell> = {
  zone: { ...FULL_CELL, zone: CellZone.Void },
  under: { zone: FULL_CELL.zone, terrain: FULL_TERRAIN },
  type: { ...FULL_CELL, terrain: { ...FULL_TERRAIN, type: TerrainType.Water } },
  elevation: { ...FULL_CELL, terrain: { ...FULL_TERRAIN, elevation: 4 } },
  corners: { ...FULL_CELL, terrain: { ...FULL_TERRAIN, corners: ['square', 'square', 'tri-NE', 'empty'] } },
  patchOnly: { ...FULL_CELL, terrain: { ...FULL_TERRAIN, patchOnly: false } },
  patchBase: { ...FULL_CELL, terrain: { ...FULL_TERRAIN, patchBase: 1 } },
};

const withCell = (cell: MacroCell) => {
  const state = makeState(4, 4);
  state.cells[1]![2] = structuredClone(cell);
  return state;
};

describe('a map cell crossing every copy and wire', () => {
  it('clones every field and shares no corner array', () => {
    const copy = cloneCell(FULL_CELL);
    expect(copy).toEqual(FULL_CELL);
    expect(copy.terrain!.corners).not.toBe(FULL_TERRAIN.corners);
    expect(cloneTerrain(FULL_TERRAIN)).toEqual(FULL_TERRAIN);
  });

  it('copies every field into a scratch grid', () => {
    const state = withCell(FULL_CELL);
    const scratch = scratchGrid(state, [{ x: 2, y: 1 }]);
    expect(scratch.cells[1]![2]).toEqual(FULL_CELL);
    expect(scratch.cells[1]![2]!.terrain!.corners).not.toBe(state.cells[1]![2]!.terrain!.corners);
  });

  it('carries every field but the session-only ground under a rim across the worker wire', () => {
    const back = decodeCells(encodeCells([[FULL_CELL]], 1, 1))[0]?.[0];
    const { under: _under, ...rest } = FULL_CELL;
    expect(back).toEqual(rest);
  });

  it('reads every field into the fingerprint', () => {
    const base = mapFingerprint(withCell(FULL_CELL));
    for (const [field, cell] of Object.entries(VARIANTS)) {
      expect(mapFingerprint(withCell(cell)), field).not.toBe(base);
    }
  });

  it('tells two terrains apart by every terrain field', () => {
    for (const field of ['type', 'elevation', 'corners', 'patchOnly', 'patchBase']) {
      expect(sameTerrain(FULL_TERRAIN, VARIANTS[field]!.terrain, { patchOnly: 'exact' }), field).toBe(false);
    }
  });

  it('round-trips a patch cell through the save token and the share codec', () => {
    const token = terrainToken(FULL_TERRAIN);
    expect(parseTerrain(token)).toEqual(FULL_TERRAIN);
    expect(tokenOf(parseToken(token))).toBe(token);
  });
});
