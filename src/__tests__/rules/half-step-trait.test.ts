/**
 * The half-step span items (issue #4) at the TRAIT level: the trait itself, the
 * covered-cell expansion in V-PLACE-TRAIT's flat/noFloat sweeps, and the off-grid
 * guard. Detection (bridge-span / heightDrop walking the half grid) belongs to
 * `half-step-detection.test.ts` — these fixtures carry `halfStep` paired with
 * `noFloat`/no other trait, never `waterSpan`/`heightDrop`, so the trait is
 * exercised in isolation.
 */
import { describe, it, expect } from 'vitest';
import { traitPlacementRule } from '../../rules/placement';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { objectBlocksTerrainRule } from '../../rules/object-blocks-terrain';
import { CommandType, ItemCategory, TerrainType } from '../../core/model/types';
import type { PlaceObjectCommand, PaintTerrainCommand } from '../../core/model/types';
import { makeState, setTerrain, placeCmd } from './_helpers';
import { registerCatalogItem } from '../../state/catalog';

registerCatalogItem({
  id: 'hs-pier', category: ItemCategory.Facility, name: { en: 'HalfStep Pier' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }, { type: 'noFloat' }],
});
registerCatalogItem({
  id: 'hs-slab', category: ItemCategory.Facility, name: { en: 'HalfStep Slab' },
  width: 2, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

function place(id: string, x: number, y: number): PlaceObjectCommand {
  return placeCmd({ id: 'test', catalogId: id, position: { x, y }, rotation: 0, elevation: 0 });
}

describe('V-PLACE-TRAIT: off-grid guard', () => {
  it('refuses a fractional position on an item without the halfStep trait', () => {
    const state = makeState();
    const errors = traitPlacementRule.validate(place('tree-apple', 5.5, 5), state);
    expect(errors.some((e) => e.message === 'error.placement_off_grid')).toBe(true);
  });

  it('refuses a fractional Y even when X is whole', () => {
    const state = makeState();
    const errors = traitPlacementRule.validate(place('tree-apple', 5, 5.5), state);
    expect(errors.some((e) => e.message === 'error.placement_off_grid')).toBe(true);
  });

  it('does not gate a whole-integer position at all (regression)', () => {
    const state = makeState();
    const errors = traitPlacementRule.validate(place('tree-apple', 5, 5), state);
    expect(errors.some((e) => e.message === 'error.placement_off_grid')).toBe(false);
  });

  it('lets a halfStep item reach its own trait validation at a fractional position', () => {
    const state = makeState();
    for (const x of [7, 8, 9]) setTerrain(state, x, 5, TerrainType.Mountain, 1);
    const errors = traitPlacementRule.validate(place('hs-pier', 7.5, 5), state);
    expect(errors).toHaveLength(0);
  });
});

describe('unknown catalog item (no item to check the trait of)', () => {
  it('returns empty rather than gating a fractional position', () => {
    const state = makeState();
    expect(traitPlacementRule.validate(place('nonexistent', 5.5, 5), state)).toHaveLength(0);
  });
});

describe('noFloat sweep over covered cells (half-integer anchor)', () => {
  it('rejects exactly the covered cells with no support, including the half-covered ends', () => {
    const state = makeState();
    // hs-pier (width 2) at x=7.5 covers macro cells 7, 8, 9 (floor/ceil expansion).
    // Support only cell 8 — 7 and 9 must both be reported as offenders.
    setTerrain(state, 8, 5, TerrainType.Mountain, 1);
    const errors = traitPlacementRule.validate(place('hs-pier', 7.5, 5), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 7, y: 5 }, { x: 9, y: 5 }]);
  });

  it('passes when every covered cell has support', () => {
    const state = makeState();
    for (const x of [7, 8, 9]) setTerrain(state, x, 5, TerrainType.Mountain, 1);
    expect(traitPlacementRule.validate(place('hs-pier', 7.5, 5), state)).toHaveLength(0);
  });

  it('integer-anchor noFloat is unchanged (regression)', () => {
    const state = makeState();
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    const errors = traitPlacementRule.validate(place('hs-pier', 5, 5), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.cells).toEqual([{ x: 6, y: 5 }]);
  });
});

describe('V-PLACE-OVERLAP: float-rect intersection at a half offset', () => {
  it('refuses an object touching the edge of a half-offset footprint', () => {
    const state = makeState();
    state.objects.set('slab', { id: 'slab', catalogId: 'hs-slab', position: { x: 7.5, y: 5 }, rotation: 0, elevation: 0 });
    // hs-slab covers world [7.5, 9.5) x [5, 6) — a tree at (9,5) overlaps it.
    expect(placementOverlapRule.validate(place('tree-apple', 9, 5), state).length).toBeGreaterThan(0);
  });

  it('allows an object one cell further away', () => {
    const state = makeState();
    state.objects.set('slab', { id: 'slab', catalogId: 'hs-slab', position: { x: 7.5, y: 5 }, rotation: 0, elevation: 0 });
    expect(placementOverlapRule.validate(place('tree-apple', 10, 5), state)).toHaveLength(0);
  });
});

describe('V-PLACE-BLOCK: terrain paint under a half-anchored deck', () => {
  function paint(x: number, y: number): PaintTerrainCommand {
    return { type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y }], terrainType: TerrainType.Mountain, elevation: 1 };
  }

  it('blocks paint on the two cells the half-anchored deck actually covers, none beyond', () => {
    const state = makeState();
    state.objects.set('slab', { id: 'slab', catalogId: 'hs-slab', position: { x: 7.5, y: 5 }, rotation: 0, elevation: 0 });
    // A half anchor lines up exactly with the terrain grid: hs-slab (width 2) at x=7.5
    // covers terrain cells 8 and 9 only — no bleed onto 7 or 10 (contrast the integer
    // case, where the same footprint would extend the block by one cell).
    expect(objectBlocksTerrainRule.validate(paint(8, 5), state).length).toBeGreaterThan(0);
    expect(objectBlocksTerrainRule.validate(paint(9, 5), state).length).toBeGreaterThan(0);
    expect(objectBlocksTerrainRule.validate(paint(7, 5), state)).toHaveLength(0);
    expect(objectBlocksTerrainRule.validate(paint(10, 5), state)).toHaveLength(0);
  });
});
