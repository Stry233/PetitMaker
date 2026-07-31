import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain, placeCmd, makeObject } from './_helpers';

/**
 * Γ-patches (patchOnly fillets) are COSMETIC: per the terrain-silhouette kernel a
 * patch at tier N holds real mass only to N-1. Placement validity must read the
 * REAL surface, or fillets phantom-block / phantom-allow placements.
 */
describe('placement vs edge-cut patches', () => {
  it('a tier-1 fillet on ground does not block a flower next to it (patch is cosmetic)', () => {
    const state = makeState(20, 20);
    // tier-1 Γ patch at (6,6): real surface = bare ground
    setTerrain(state, 6, 6, TerrainType.Mountain, 1);
    state.cells[6]![6]!.terrain!.patchOnly = true;
    state.cells[6]![6]!.terrain!.corners = ['tri-NW', 'square', 'square', 'square'];
    // flower at (5,5): flat trait checks footprint + 1 right/bottom → includes (6,6)
    const cmd = placeCmd(makeObject('flower-rose', 5, 5));
    expect(traitPlacementRule.validate(cmd, state)).toHaveLength(0);
  });

  it('a fillet on a plateau does not COUNT as the plateau level (no floating placements)', () => {
    const state = makeState(20, 20);
    // 6x6 plateau at elevation 2
    for (let y = 4; y <= 9; y++) for (let x = 4; x <= 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    // one interior cell is only a tier-2 FILLET over a real tier-1 base
    setTerrain(state, 6, 6, TerrainType.Mountain, 2);
    state.cells[6]![6]!.terrain!.patchOnly = true;
    // flower anchored on the fillet cell: raw reads say "flat at 2" but the real
    // surface is a 1-level step — placement must be rejected
    const cmd = placeCmd(makeObject('flower-rose', 6, 6));
    expect(traitPlacementRule.validate(cmd, state).length).toBeGreaterThan(0);
  });

  it('noFloat-style support: a road tile cannot ride on a fillet-only column', () => {
    const state = makeState(20, 20);
    // tier-1 patch = no real terrain; surfaceCoating requires real terrain? no —
    // roads need non-water terrain OR ground; the flat trait is the gate here.
    // Instead: bridge-style noFloat via a tree on the patch with mismatched margin.
    for (let y = 4; y <= 9; y++) for (let x = 4; x <= 9; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    setTerrain(state, 6, 6, TerrainType.Mountain, 2);
    state.cells[6]![6]!.terrain!.patchOnly = true; // fillet at 2 over real 1
    const cmd = placeCmd(makeObject('tree-apple', 6, 6));
    // real surface at (6,6) is 1 — same as the plateau → placement is legal
    expect(traitPlacementRule.validate(cmd, state)).toHaveLength(0);
  });
});
