import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../rules';
import { CommandType, TerrainType, type GridState, type PlaceObjectCommand } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

/**
 * Ramp (heightDrop) robustness audit: the support sweep must validate the REAL
 * surface — not just elevation numbers. Water at the right elevation is not
 * support; Γ fillets are cosmetic; corner trims on full blocks are cosmetic.
 */
describe('ramp policy robustness', () => {
  // 10x10 mountain plateau elev 1 at (5..14); south cliff edge at y=14.
  function plateau(): GridState {
    const state = makeState(20, 20);
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    return state;
  }
  function placeRamp(x: number, y: number): PlaceObjectCommand {
    return {
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0, elevation: 0 },
      loadValue: 80,
    };
  }

  it('baseline: clean south cliff accepts and snaps the ramp', () => {
    const state = plateau();
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state)).toHaveLength(0);
    expect(cmd.object.rotation).toBe(0);
  });

  it('rejects a ramp whose low run is WATER at the matching elevation', () => {
    const state = plateau();
    // ground-level water inside the would-be low run (deck rows y15..18, x8..10 incl. bleed)
    setTerrain(state, 8, 16, TerrainType.Water, 0);
    setTerrain(state, 9, 16, TerrainType.Water, 0);
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state).length).toBeGreaterThan(0);
  });

  it('rejects a ramp whose HIGH side is water (pool rim is not a cliff)', () => {
    const state = plateau();
    // the clicked cliff cells are water at elev 1 (pool edge), not mountain
    setTerrain(state, 8, 14, TerrainType.Water, 1);
    setTerrain(state, 9, 14, TerrainType.Water, 1);
    setTerrain(state, 10, 14, TerrainType.Water, 1);
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state).length).toBeGreaterThan(0);
  });

  it('rejects a ramp whose cliff is only a Γ fillet (no real drop)', () => {
    const state = makeState(20, 20);
    // bare ground + a lone tier-1 fillet pretending to be a cliff edge
    setTerrain(state, 8, 14, TerrainType.Mountain, 1);
    state.cells[14]![8]!.terrain!.patchOnly = true;
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state).length).toBeGreaterThan(0);
  });

  it('accepts a ramp when a low-run cell is a fillet over the CORRECT base', () => {
    const state = makeState(20, 20);
    // elev-2 plateau (rows 5..14) over an elev-1 shelf (rows 15..19)
    for (let y = 5; y <= 14; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let y = 15; y <= 19; y++) for (let x = 5; x <= 14; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    // one low-run cell carries a tier-2 fillet over its real tier-1 base — cosmetic
    setTerrain(state, 9, 16, TerrainType.Mountain, 2);
    state.cells[16]![9]!.terrain!.patchOnly = true;
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state)).toHaveLength(0);
  });

  it('accepts a ramp on a TRIMMED (cut-corner) cliff lip — trims are cosmetic by design', () => {
    const state = plateau();
    // generation auto-trims cliffs, then places ramps on them — pin that behavior
    state.cells[14]![8]!.terrain!.corners = ['square', 'square', 'fan', 'fan'];
    const cmd = placeRamp(8, 14);
    expect(createDefaultRegistry().validatePreCommand(cmd, state)).toHaveLength(0);
  });
});
