import { describe, it, expect } from 'vitest';
import { zoneRestrictionRule } from '../../rules/zone-restriction';
import { CellZone, CommandType, ItemCategory, TerrainType, ObjectCategory } from '../../core/model/types';
import { registerCatalogItem } from '../../state/catalog';
import { makeState, setZone, paintCmd, placeCmd, makeObject } from './_helpers';

function fixture(id: string, width: number, height: number) {
  registerCatalogItem({
    id, category: ItemCategory.Building, name: { en: 'x', zh: 'x' }, emoji: '❓',
    width, height, loadValue: 0, rotatable: false, placementMode: 'point', traits: [],
  });
}

describe('V-ZONE-01: Zone Restriction', () => {
  it('applies to terrain edits + placement, but NOT removal (removing is always allowed)', () => {
    expect(zoneRestrictionRule.appliesTo).toContain(CommandType.PaintTerrain);
    expect(zoneRestrictionRule.appliesTo).toContain(CommandType.EraseTerrain);
    expect(zoneRestrictionRule.appliesTo).toContain(CommandType.PlaceObject);
    expect(zoneRestrictionRule.appliesTo).not.toContain(CommandType.RemoveObject);
  });
  it('allows painting on Grass zone', () => {
    const state = makeState();
    expect(zoneRestrictionRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(0);
  });
  it('rejects painting on Beach zone', () => {
    const state = makeState();
    setZone(state, 5, 5, CellZone.Beach);
    const errors = zoneRestrictionRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.ruleId).toBe('V-ZONE-01');
  });
  it('rejects painting on Void zone', () => {
    const state = makeState();
    setZone(state, 5, 5, CellZone.Void);
    expect(zoneRestrictionRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(1);
  });
  it('rejects PlaceObject on non-Grass zone', () => {
    const state = makeState();
    setZone(state, 5, 5, CellZone.Beach);
    expect(zoneRestrictionRule.validate(placeCmd(makeObject('t1', 5, 5, ObjectCategory.Tree)), state)).toHaveLength(1);
  });
  it('rejects PlaceObject when ANY footprint cell is non-Grass (not just the anchor)', () => {
    fixture('zone-fix-2x2', 2, 2);
    const state = makeState();
    setZone(state, 6, 6, CellZone.Beach); // a covered cell, NOT the (5,5) anchor
    const errors = zoneRestrictionRule.validate(placeCmd(makeObject('zone-fix-2x2', 5, 5, ObjectCategory.Facility)), state);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.cells[0]!.x === 6 && e.cells[0]!.y === 6)).toBe(true);
  });
  it('rejects PlaceObject whose footprint hangs off the map (void = sea)', () => {
    fixture('zone-fix-2x1', 2, 1);
    const state = makeState(10, 10);
    // anchor at the right edge → the 2-wide footprint reaches x=10, off the grid
    const errors = zoneRestrictionRule.validate(placeCmd(makeObject('zone-fix-2x1', 9, 5, ObjectCategory.Facility)), state);
    expect(errors.length).toBeGreaterThan(0);
  });
  // (Plaza no-build moved to V-PLACE-BLOCK / V-PLACE-OVERLAP — the plaza is an
  // immutable object now, not a zone. See regression-user-bugs "User Bug 5".)
  it('rejects terrain that bleeds onto a non-buildable UP/LEFT neighbour (-HALF render); allows DOWN/RIGHT', () => {
    const paint = (state: ReturnType<typeof makeState>) => zoneRestrictionRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state);
    const up = makeState(); setZone(up, 5, 4, CellZone.Boundary);     // border above → terrain block bleeds up onto it
    expect(paint(up)).toHaveLength(1);
    const left = makeState(); setZone(left, 4, 5, CellZone.Boundary); // border left → bleeds left onto it
    expect(paint(left)).toHaveLength(1);
    const down = makeState(); setZone(down, 5, 6, CellZone.Boundary); // border below → no down-bleed
    expect(paint(down)).toHaveLength(0);
    const right = makeState(); setZone(right, 6, 5, CellZone.Boundary); // border right → no right-bleed
    expect(paint(right)).toHaveLength(0);
    // Erase never bleeds (it removes terrain) → allowed even with a border above.
    expect(zoneRestrictionRule.validate({ type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 5, y: 5 }] }, up)).toHaveLength(0);
  });
  it('reports errors for each invalid cell in a multi-cell command', () => {
    const state = makeState();
    setZone(state, 3, 3, CellZone.Beach);
    setZone(state, 4, 4, CellZone.Beach);
    // (8,8) is far from the beach (its up/left/up-left are all grass) → valid; the two beach cells error.
    expect(zoneRestrictionRule.validate(paintCmd([{ x: 3, y: 3 }, { x: 4, y: 4 }, { x: 8, y: 8 }], TerrainType.Mountain, 1), state)).toHaveLength(2);
  });

  it('rejects painting a grass cell whose UP-LEFT diagonal is non-grass (top-left micro-block bleed)', () => {
    // At a convex beach corner the up + left neighbours are grass but the diagonal is beach; the terrain
    // block's top-left micro-block (rendered -HALF_TILE up-left) lands on that beach → must be rejected.
    const state = makeState();
    setZone(state, 4, 4, CellZone.Beach); // diagonal up-left of (5,5); (5,4) and (4,5) stay grass
    expect(zoneRestrictionRule.validate(paintCmd([{ x: 5, y: 5 }], TerrainType.Mountain, 1), state)).toHaveLength(1);
    // erase does NOT bleed (no -HALF render), so it stays allowed on the same cell
    const erase = { type: CommandType.EraseTerrain, timestamp: 0, cells: [{ x: 5, y: 5 }] } as const;
    expect(zoneRestrictionRule.validate(erase as never, state)).toHaveLength(0);
  });
});
