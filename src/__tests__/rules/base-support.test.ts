import { describe, it, expect } from 'vitest';
import { baseSupportRule } from '../../rules/base-support';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain } from './_helpers';

describe('V-MTN-03: 3x3 Base Support', () => {
  it('allows layers 1-3 (ground provides 3x3 base)', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('rejects layer 4 without 3x3 base', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
    setTerrain(state, 4, 4, TerrainType.Mountain, 4);
    const errors = baseSupportRule.validate(state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some(e => e.cells.some(c => c.x === 4 && c.y === 4))).toBe(true);
  });

  it('allows single layer 4 block centered on 3x3 layer 1 base', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('allows tower to layer 6 with proper 3x3 base', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
    setTerrain(state, 5, 5, TerrainType.Mountain, 6);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('rejects narrow pillar at layer 4 (no 3x3 base)', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state).length).toBeGreaterThan(0);
  });

  it('rejects when water cell breaks the 3x3 base', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Water, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state).length).toBeGreaterThan(0);
  });

  it('layer 7 passes with 3x3 base at layer 4 (which has 5x5 at layer 1)', () => {
    const state = makeState();
    // 5x5 at elevation 1 to support the 3x3 at elevation 4
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    // 3x3 at elevation 4 on top
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 4);
    // Single tower at elevation 7
    setTerrain(state, 5, 5, TerrainType.Mountain, 7);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('rejects 3x3 block at layer 4 with no lower base', () => {
    const state = makeState();
    // 3x3 at elevation 4 only — no support below
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 4);
    const errors = baseSupportRule.validate(state);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('reports violations when shared base is removed', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    setTerrain(state, 5, 4, TerrainType.Mountain, 4);
    state.cells[4]![4]!.terrain = null;
    expect(baseSupportRule.validate(state).some(e => e.cells.some(c => c.x === 5 && c.y === 4))).toBe(true);
  });

  it('reports no violations for an empty map', () => {
    expect(baseSupportRule.validate(makeState())).toHaveLength(0);
  });

  it('rejects layer 4 at map edge with no full 3x3 base', () => {
    const state = makeState();
    setTerrain(state, 0, 0, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state).length).toBeGreaterThan(0);
  });

  // Regression: on complex (heavily edge-cut) maps a Γ patch/fillet provides STRUCTURAL support via
  // its patchBase. The rule must read the structural surface (realSurface/structuralTop), not raw
  // elevation, and must NOT exclude patchOnly cells — otherwise it false-flags legal terrain and,
  // being post-stroke + whole-grid, reverts every subsequent stroke. (Repro'd from a real map.)
  it('counts a Γ-patch base cell as structural support (no false 3x3 violation)', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
    // one base neighbour is a Γ fillet (cosmetic elev 4) sitting on a real elevation-3 block
    state.cells[4]![4]!.terrain = { type: TerrainType.Mountain, elevation: 4, patchOnly: true, patchBase: 3 };
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('does not require a 3x3 base for a cosmetic fillet whose structural top is below 4', () => {
    // A lone Γ fillet at cosmetic elevation 4 but structural base 3 is structurally a layer-3 block
    // (exempt). It must not be treated as a layer-4 mountain that needs a 3x3 base.
    const state = makeState();
    state.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 4, patchOnly: true, patchBase: 3 };
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });
});
