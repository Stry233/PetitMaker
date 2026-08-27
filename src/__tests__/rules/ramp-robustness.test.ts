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

/**
 * The four sides of a plateau accept a ramp the SAME way. Two reads used to break that: the cliff
 * detector read elevations at the anchor point, whose half-cell straddle at a cliff's left/top end
 * includes the ground beside the plateau (min goes low, no cliff found — while the right/bottom
 * end, straddling two plateau cells, worked); and a half hover's tie rounded half-up, which is the
 * cliff row on a south/east cliff but the plateau's interior on a north/west one. A ramp must
 * place flush with EITHER end of a cliff, and hover the same depth onto the plateau whichever way
 * the cliff faces.
 */
describe('ramp placement is symmetric across the four cliff faces', () => {
  // 10x10 plateau at elev 1, cells (7..16) on both axes, inside a 24x24 map.
  function block(): GridState {
    const state = makeState(24, 24);
    for (let y = 7; y <= 16; y++) for (let x = 7; x <= 16; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    return state;
  }
  function tryRamp(x: number, y: number): PlaceObjectCommand & { ok: boolean } {
    const cmd = {
      type: CommandType.PlaceObject as const, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0 as const, elevation: 0 },
      loadValue: 80,
    };
    const ok = createDefaultRegistry().validatePreCommand(cmd, block()).length === 0;
    return { ...cmd, ok };
  }

  it('places flush with the LEFT end of a south cliff, exactly as it does with the right', () => {
    const left = tryRamp(6.5, 16);   // covers columns 7,8: the plateau's first two
    expect(left.ok).toBe(true);
    expect(left.object.rotation).toBe(0);
    expect(left.object.position).toEqual({ x: 6.5, y: 16 });
    const right = tryRamp(14.5, 16); // covers columns 15,16: the last two
    expect(right.ok).toBe(true);
    expect(right.object.position).toEqual({ x: 14.5, y: 16 });
  });

  it('places at the TOP end of an east cliff, exactly as at the bottom', () => {
    const top = tryRamp(16.5, 6.5);  // covers rows 7,8
    expect(top.ok).toBe(true);
    expect(top.object.rotation).toBe(90);
    const bottom = tryRamp(16.5, 14.5);
    expect(bottom.ok).toBe(true);
  });

  it('a half hover reaches the same depth onto the plateau from every side', () => {
    // One whole cell in from the visual cliff line, at each face's own tie coordinate.
    expect(tryRamp(8, 15.5).ok).toBe(true);   // south, rot 0
    expect(tryRamp(8, 7.5).ok).toBe(true);    // north, rot 180: the tie that used to round inward
    expect(tryRamp(15.5, 8).ok).toBe(true);   // east, rot 90
    expect(tryRamp(7.5, 8).ok).toBe(true);    // west, rot 270: same tie, other axis
    expect(tryRamp(8, 7.5).object.rotation).toBe(180);
    expect(tryRamp(7.5, 8).object.rotation).toBe(270);
  });

  it('the four corner placements the report named all stand', () => {
    expect(tryRamp(6.5, 16).object.rotation).toBe(0);    // vertical, bottom-left
    expect(tryRamp(6.5, 6.5).object.rotation).toBe(180); // vertical, top-left
    expect(tryRamp(6, 6.5).object.rotation).toBe(270);   // horizontal, top-left
    expect(tryRamp(16.5, 6.5).object.rotation).toBe(90); // horizontal, top-right
    for (const [x, y] of [[6.5, 16], [6.5, 6.5], [6, 6.5], [16.5, 6.5]] as const) {
      expect(tryRamp(x, y).ok, `anchor (${x}, ${y})`).toBe(true);
    }
  });
});
