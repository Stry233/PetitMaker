/** Ramp placement through the `heightDrop` trait: the snap picks the rotation from the edge it is
 *  placed on, and the lower run must stand on clear, level ground. */
import { describe, it, expect } from 'vitest';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type GridState, type PlaceObjectCommand } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

describe('V-PLACE-TRAIT heightDrop: a ramp on each edge of a mountain block', () => {
  // Mountain block at elev 1: x=[5,14], y=[5,14]  (10x10 block)
  // Ground surrounds it. Ramp (2x2, heightDrop 1) placed at each edge.
  function makeRampState(): GridState {
    const state = makeState(20, 20);
    for (let y = 5; y <= 14; y++)
      for (let x = 5; x <= 14; x++)
        setTerrain(state, x, y, TerrainType.Mountain, 1);
    return state;
  }

  function placeRamp(x: number, y: number): PlaceObjectCommand {
    return {
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0 as const, elevation: 0 },
    };
  }

  it('rot=0 (south): click on bottom mountain edge, ramp extends down', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (8, 14) — neighbor (8, 15) is ground
    // rot=0 includes high cell: position stays at highY=14
    const cmd = placeRamp(8, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(0);
    expect(cmd.object.position.y).toBe(14);
  });

  it('rot=180 (north): click on top mountain edge, ramp extends up', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (8, 5) — neighbor (8, 4) is ground
    const cmd = placeRamp(8, 5);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(180);
  });

  it('rot=90 (east): click on right mountain edge, ramp extends right', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (14, 8) — neighbor (15, 8) is ground
    const cmd = placeRamp(14, 8);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(90);
  });

  it('rot=270 (west): click on left mountain edge, ramp extends left', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // Click on mountain at (5, 8) — neighbor (4, 8) is ground
    const cmd = placeRamp(5, 8);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors).toHaveLength(0);
    expect(cmd.object.rotation).toBe(270);
  });

  it('rejects ramp at corner (perpendicular extends off mountain)', () => {
    const state = makeRampState();
    const registry = createDefaultRegistry();
    // rot=0 includes high cell: ramp at (14,14) has high cell at y=14, x=14,15.
    // x=15 is ground — micro-block check reaches x=16 (off mountain) → rejects.
    const cmd = placeRamp(14, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('rejects ramp where low terrain has mixed elevation', () => {
    const state = makeRampState();
    setTerrain(state, 8, 16, TerrainType.Mountain, 1);
    const registry = createDefaultRegistry();
    const cmd = placeRamp(8, 14);
    const errors = registry.validatePreCommand(cmd, state);
    expect(errors.length).toBeGreaterThan(0);
  });

  // A mountain intruding on the LOW footprint from the trailing (bottom / down-right) edge is what
  // a validator sweeping the -HALF_TILE bleed on ONE axis only misses, accepting an illegal ramp.
  // The low run and its trailing bleed must all be clear.
  it('rejects ramp when a mountain intrudes on the trailing/bottom edge of the low run (no leak)', () => {
    const state = makeRampState();         // 10x10 elev-1 block [5,14]; south ramp at (8,14) spans y=14..15
    setTerrain(state, 8, 16, TerrainType.Mountain, 1); // the trailing bleed row that must be swept
    const cmd = placeRamp(8, 14);
    const errors = createDefaultRegistry().validatePreCommand(cmd, state);
    expect(errors.length, 'a mountain at the ramp foot must block it').toBeGreaterThan(0);
  });
});

describe('V-PLACE-TRAIT heightDrop: a ramp between two tiers', () => {
  // A two-tier plateau: a `depth`-deep tier-1 ring around a 6x6 tier-2 core, ground beyond.
  function twoTier(depth: number): { state: GridState; c0: number; c1: number; mid: number } {
    const state = makeState(40, 40);
    const ringLo = 5, core0 = ringLo + depth, core1 = core0 + 5, ringHi = core1 + depth;
    for (let y = ringLo; y <= ringHi; y++) for (let x = ringLo; x <= ringHi; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = core0; y <= core1; y++) for (let x = core0; x <= core1; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    return { state, c0: core0, c1: core1, mid: (core0 + core1) >> 1 };
  }
  function legal(state: GridState, x: number, y: number): boolean {
    const cmd: PlaceObjectCommand = {
      type: CommandType.PlaceObject, timestamp: 0,
      object: { id: 'r1', catalogId: 'ramp-park-steps', position: { x, y }, rotation: 0 as const, elevation: 0 },
    };
    return createDefaultRegistry().validatePreCommand(cmd, state).length === 0;
  }

  it('a 2->1 ramp validates on a wide shelf from ALL FOUR edges of the inner block', () => {
    const { state, c0, c1, mid } = twoTier(2); // Two rows provide the 1.5-cell lower support.
    expect(legal(state, mid, c1), 'south').toBe(true);
    expect(legal(state, c1, mid), 'east').toBe(true);
    expect(legal(state, mid, c0), 'north').toBe(true);
    expect(legal(state, c0, mid), 'west').toBe(true);
  });

  it('a too-narrow shelf rejects CONSISTENTLY in all 4 directions (no N/W vs S/E asymmetry)', () => {
    const { state, c0, c1, mid } = twoTier(1); // One row cannot provide the 1.5-cell lower support.
    expect(legal(state, mid, c1), 'south').toBe(false);
    expect(legal(state, c1, mid), 'east').toBe(false);
    expect(legal(state, mid, c0), 'north').toBe(false);
    expect(legal(state, c0, mid), 'west').toBe(false);
  });
});
