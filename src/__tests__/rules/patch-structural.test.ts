/**
 * A Γ patch is a cosmetic fillet: it renders at a high tier but holds no mass
 * of its own (its real support is patchBase). The floating rule and the
 * waterfall cap test must read that STRUCTURAL height — a mass-less fillet
 * must neither support a paint one tier up nor cap a waterfall.
 */
import { describe, it, expect } from 'vitest';
import { mountainFloatingRule } from '../../rules/floating-block';
import { waterfallFacesAt } from '../../core/model/waterfall-geometry';
import { CommandType, TerrainType } from '../../core/model/types';
import type { Corners, PaintTerrainCommand } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

const FAN: Corners = ['fan', 'square', 'square', 'square'];

function paint(x: number, y: number, elevation: number): PaintTerrainCommand {
  return {
    type: CommandType.PaintTerrain, timestamp: 0,
    cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation,
  };
}

describe('floating rule reads structural height, not the cosmetic tier', () => {
  it('rejects painting one tier above a from-empty fillet (its support is bare ground)', () => {
    const state = makeState(10, 10);
    state.cells[5]![5]!.terrain = {
      type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 0, corners: FAN,
    };
    const errors = mountainFloatingRule.validate(paint(5, 5, 3), state);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('accepts painting one tier above a fillet whose real base reaches the tier below', () => {
    const state = makeState(10, 10);
    state.cells[5]![5]!.terrain = {
      type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 2, corners: FAN,
    };
    expect(mountainFloatingRule.validate(paint(5, 5, 3), state)).toHaveLength(0);
  });
});

describe('waterfall caps must be real mass at the water tier', () => {
  function elevatedStrip(state: ReturnType<typeof makeState>) {
    // Water at (5,5) elev 2 over a supporting column, dropping north; the west
    // cap is real. The EAST cap is the variable under test.
    setTerrain(state, 5, 5, TerrainType.Water, 2);
    setTerrain(state, 4, 5, TerrainType.Mountain, 2); // real west cap
  }

  it('a real mountain at the water tier caps the face', () => {
    const state = makeState(10, 10);
    elevatedStrip(state);
    setTerrain(state, 6, 5, TerrainType.Mountain, 2); // real east cap
    const faces = waterfallFacesAt(state, 5, 5);
    expect(faces.some((f) => f.flowDirection === 'north')).toBe(true);
  });

  it('a mass-less fillet at the water tier does NOT cap the face', () => {
    const state = makeState(10, 10);
    elevatedStrip(state);
    state.cells[5]![6]!.terrain = {
      type: TerrainType.Mountain, elevation: 2, patchOnly: true, patchBase: 0, corners: FAN,
    };
    expect(waterfallFacesAt(state, 5, 5)).toHaveLength(0);
  });

  it('a fillet over a real base AT the water tier still caps (the base is the cap)', () => {
    const state = makeState(10, 10);
    elevatedStrip(state);
    state.cells[5]![6]!.terrain = {
      type: TerrainType.Mountain, elevation: 3, patchOnly: true, patchBase: 2, corners: FAN,
    };
    const faces = waterfallFacesAt(state, 5, 5);
    expect(faces.some((f) => f.flowDirection === 'north')).toBe(true);
  });
});
