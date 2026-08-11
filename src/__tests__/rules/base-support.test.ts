import { describe, it, expect } from 'vitest';
import { baseSupportRule } from '../../rules/base-support';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain, makeExecutor, paintCmd } from './_helpers';

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

  // A river is ONE layer deep and does not float (RULES.md §7), so a water cell at N is a water
  // block at N on riverbed mass at N-1: it supports a base up to N-1, never at N. Treating it as
  // supporting nothing at any depth made water at elevation >= 4 impossible anywhere on the map —
  // its containing rim (mountains at the water's own level) always has the water in its 3x3.
  it('counts the riverbed under a water cell as support below the water surface', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    // the tower at 4 needs a 3x3 at E >= 1; one base cell is a river at 3 (riverbed mass at 2)
    setTerrain(state, 4, 4, TerrainType.Water, 3);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('does not count the water block itself as support at its own level', () => {
    // mountain at 5 needs a 3x3 at E >= 2. Water at 2 holds mass only to 1 → refused;
    // water at 3 holds mass to 2 → allowed. That step is the whole depth semantics.
    const build = (waterElev: number) => {
      const state = makeState();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 2);
      setTerrain(state, 4, 4, TerrainType.Water, waterElev);
      setTerrain(state, 5, 5, TerrainType.Mountain, 5);
      return baseSupportRule.validate(state);
    };
    expect(build(2).length).toBeGreaterThan(0);
    expect(build(3)).toHaveLength(0);
  });

  it('still refuses a mountain sunk more than 3 layers above a river (RULES.md §7 reg. 2)', () => {
    // A river can't sink too much: mass under water at N reaches N-1, so a neighbouring
    // mountain may stand at most N+2 before its 3x3 window (E >= M-3) clears the riverbed.
    const rim = (mountainElev: number) => {
      const state = makeState();
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
      setTerrain(state, 4, 4, TerrainType.Water, 3);
      setTerrain(state, 5, 5, TerrainType.Mountain, mountainElev);
      return baseSupportRule.validate(state);
    };
    expect(rim(5)).toHaveLength(0);          // needs E >= 2, riverbed reaches 2 ✓
    expect(rim(6).length).toBeGreaterThan(0); // needs E >= 3, riverbed reaches only 2 ✗
  });

  it('does not require a 3x3 base for a cosmetic fillet whose structural top is below 4', () => {
    // A lone Γ fillet at cosmetic elevation 4 but structural base 3 is structurally a layer-3 block
    // (exempt). It must not be treated as a layer-4 mountain that needs a 3x3 base.
    const state = makeState();
    state.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 4, patchOnly: true, patchBase: 3 };
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });
});

/**
 * Owner-reported: a river could not be painted above layer 3. The water itself was never the cell
 * the rule flagged — the basin RIM was. A pond's rim stands at the water's own level, so the water
 * sits inside every rim cell's 3x3, and a rim at >= 4 lost its base to a cell that in fact holds
 * riverbed mass one layer down. Driven through the real command path, since the refusal only shows
 * up as a post-stroke revert.
 */
describe('V-MTN-03: an elevated pond survives its own rim (real commands)', () => {
  /** A legal pyramid: a square per layer, each inset 1 from the one below, so every cell's 3x3
   *  window finds full support 3 layers down. Returns the executor with the stroke still open. */
  function terraceTo(state: ReturnType<typeof makeState>, level: number) {
    const ex = makeExecutor(state);
    for (let e = 1; e <= level; e++) {
      const lo = 2 + (e - 1), hi = 27 - (e - 1);
      const cells = [];
      for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) cells.push({ x, y });
      ex.execute(paintCmd(cells, TerrainType.Mountain, e));
    }
    expect(ex.commitStroke(0)).toHaveLength(0);
    return ex;
  }

  for (const level of [4, 5, 6, 7, 8]) {
    it(`paints a contained pond at elevation ${level}`, () => {
      const state = makeState(30, 30);
      const ex = terraceTo(state, level);
      const mark = ex.getUndoStackSize();
      const pond = [{ x: 14, y: 14 }, { x: 15, y: 14 }, { x: 14, y: 15 }, { x: 15, y: 15 }];
      expect(ex.execute(paintCmd(pond, TerrainType.Water, level)).success).toBe(true);
      expect(ex.commitStroke(mark)).toHaveLength(0);
      for (const c of pond) {
        expect(state.cells[c.y]![c.x]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: level });
      }
    });
  }

  it('still reverts a mountain at 5 with no 3x3 base under it', () => {
    const state = makeState(30, 30);
    const ex = makeExecutor(state);
    for (let e = 1; e <= 5; e++) ex.execute(paintCmd([{ x: 14, y: 14 }], TerrainType.Mountain, e));
    expect(ex.commitStroke(0).some(e => e.ruleId === 'V-MTN-03')).toBe(true);
    expect(state.cells[14]![14]!.terrain?.elevation ?? 0).toBeLessThan(4);
  });
});
