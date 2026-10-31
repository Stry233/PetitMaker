import { describe, it, expect } from 'vitest';
import { baseSupportRule } from '../../rules/base-support';
import { TerrainType } from '../../core/model/types';
import { makeState, setTerrain, makeExecutor, paintCmd } from '../_support/map-state';

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

  it('a water cell in the 3x3 window supports like the block it replaced', () => {
    // The game forms waterfalls by converting a mountain block to water, so water at N supports a
    // neighbour's window to N, though nothing may be built on it.
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    setTerrain(state, 4, 4, TerrainType.Water, 1);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('layer 7 passes with 3x3 base at layer 4 (which has 5x5 at layer 1)', () => {
    const state = makeState();
    // The 5x5 at elevation 1 supports the 3x3 at elevation 4.
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 4);
    setTerrain(state, 5, 5, TerrainType.Mountain, 7);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('rejects 3x3 block at layer 4 with no lower base', () => {
    const state = makeState();
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

  // A Γ patch or fillet supports through its `patchBase`, the structural surface the rule reads.
  it('counts a Γ-patch base cell as structural support (no false 3x3 violation)', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
    // One base neighbour is a Γ fillet (cosmetic 4) on a real elevation-3 block.
    state.cells[4]![4]!.terrain = { type: TerrainType.Mountain, elevation: 4, patchOnly: true, patchBase: 3 };
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('counts the riverbed under a water cell as support below the water surface', () => {
    const state = makeState();
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 1);
    // The tower at 4 needs a 3x3 at E >= 1; one base cell is a river at 3.
    setTerrain(state, 4, 4, TerrainType.Water, 3);
    setTerrain(state, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('counts a water cell to its surface, and no further', () => {
    // A mountain at 6 needs a 3x3 at E >= 3: water at 2 is refused, water at 3 allowed.
    const build = (waterElev: number) => {
      const state = makeState();
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++)
          setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 3);
      setTerrain(state, 4, 4, TerrainType.Water, waterElev);
      setTerrain(state, 5, 5, TerrainType.Mountain, 6);
      return baseSupportRule.validate(state);
    };
    expect(build(2).length).toBeGreaterThan(0);
    expect(build(3)).toHaveLength(0);
  });

  it('still refuses a mountain more than 3 layers above a neighbouring river', () => {
    // Water at N lets a neighbouring mountain stand at most N+3. The rest of the window is a full
    // wedding cake, so the water cell is the only thing it can be short of.
    const rim = (mountainElev: number) => {
      const state = makeState();
      for (let e = 1; e <= 4; e++) {
        const r = 5 - e;
        for (let dy = -r; dy <= r; dy++)
          for (let dx = -r; dx <= r; dx++)
            setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, e);
      }
      setTerrain(state, 4, 4, TerrainType.Water, 3);
      setTerrain(state, 5, 5, TerrainType.Mountain, mountainElev);
      return baseSupportRule.validate(state);
    };
    expect(rim(6)).toHaveLength(0);          // needs E >= 3, the water fills to 3 ✓
    expect(rim(7).length).toBeGreaterThan(0); // needs E >= 4, the water stops at 3 ✗
  });

  it('allows a plunge pool at the foot of a tall waterfall', () => {
    // A steep wall to 4 on a tier-1 skirt, a water channel at 4 between caps at 4. Converting the
    // skirt cell at the fall's foot to water is support-neutral, so the caps stay supported.
    const state = makeState();
    for (let y = 2; y <= 8; y++) for (let x = 2; x <= 8; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
    for (let y = 3; y <= 6; y++) for (let x = 3; x <= 6; x++) setTerrain(state, x, y, TerrainType.Mountain, 4);
    setTerrain(state, 5, 6, TerrainType.Water, 4);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
    setTerrain(state, 5, 7, TerrainType.Water, 1);
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });

  it('does not require a 3x3 base for a cosmetic fillet whose structural top is below 4', () => {
    // A Γ fillet at cosmetic 4 on structural base 3 is a layer-3 block, which needs no 3x3 base.
    const state = makeState();
    state.cells[5]![5]!.terrain = { type: TerrainType.Mountain, elevation: 4, patchOnly: true, patchBase: 3 };
    expect(baseSupportRule.validate(state)).toHaveLength(0);
  });
});

/**
 * A pond above layer 3: its rim stands at the water's level, so the water sits in every rim cell's 3x3
 * and has to support it. Driven through real commands, since a refusal shows only as a post-stroke revert.
 */
describe('V-MTN-03: an elevated pond survives its own rim (real commands)', () => {
  /** A legal pyramid: a square per layer, each inset 1 from the one below, so every cell's 3x3
   *  window finds full support 3 layers down. Returns the executor with the stroke still open. */
  function terraceTo(state: ReturnType<typeof makeState>, level: number) {
    const ex = makeExecutor(state);
    const whole = ex.beginStroke();
    for (let e = 1; e <= level; e++) {
      const lo = 2 + (e - 1), hi = 27 - (e - 1);
      const cells = [];
      for (let y = lo; y <= hi; y++) for (let x = lo; x <= hi; x++) cells.push({ x, y });
      ex.execute(paintCmd(cells, TerrainType.Mountain, e));
    }
    expect(whole.commit()).toHaveLength(0);
    return ex;
  }

  for (const level of [4, 5, 6, 7, 8]) {
    it(`paints a contained pond at elevation ${level}`, () => {
      const state = makeState(30, 30);
      const ex = terraceTo(state, level);
      const mark = ex.beginStroke();
      const pond = [{ x: 14, y: 14 }, { x: 15, y: 14 }, { x: 14, y: 15 }, { x: 15, y: 15 }];
      expect(ex.execute(paintCmd(pond, TerrainType.Water, level)).success).toBe(true);
      expect(mark.commit()).toHaveLength(0);
      for (const c of pond) {
        expect(state.cells[c.y]![c.x]!.terrain).toMatchObject({ type: TerrainType.Water, elevation: level });
      }
    });
  }

  it('still reverts a mountain at 5 with no 3x3 base under it', () => {
    const state = makeState(30, 30);
    const ex = makeExecutor(state);
    const whole = ex.beginStroke();
    for (let e = 1; e <= 5; e++) ex.execute(paintCmd([{ x: 14, y: 14 }], TerrainType.Mountain, e));
    expect(whole.commit().some(e => e.ruleId === 'V-MTN-03')).toBe(true);
    expect(state.cells[14]![14]!.terrain?.elevation ?? 0).toBeLessThan(4);
  });
});

describe('V-MTN-03: a 3x3 block is not its own base', () => {
  // The edge cells at layer 4 have no 3x3 base of mountain at elevation >= 1.
  it('rejects 3x3 layer-4 block without proper lower base', () => {
    const state = makeState(10, 10);
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++)
        setTerrain(state, 5 + dx, 5 + dy, TerrainType.Mountain, 4);
    const errors = baseSupportRule.validate(state);
    expect(errors.length).toBeGreaterThan(0);
  });
});
