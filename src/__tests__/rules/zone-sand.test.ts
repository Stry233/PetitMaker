import { describe, expect, it } from 'vitest';
import { ROTATIONS, type GridState, type PlacedObject, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { getRotatedSize } from '../../core/grid/footprint';
import { groundZonesOf } from '../../core/model/traits';
import { ItemCategory } from '../../config/catalog/categories';
import { __setCatalogItem, getCatalogItem, getKnownItems } from '../../state/catalog';
import { hasGate } from '../../state/object-geometry';
import { zoneRestrictionRule } from '../../rules/zone-restriction';
import { createPlanetRegistry } from '../../rules/index';
import { makeState, placeCmd, setZone } from '../_support/map-state';

/** A 30 x 30 map, grass above row 15 and beach from row 15 down. */
function shore(): GridState {
  const state = makeState(30, 30);
  for (let y = 15; y < 30; y++) for (let x = 0; x < 30; x++) setZone(state, x, y, CellZone.Beach);
  return state;
}

const at = (catalogId: string, x: number, y: number, rotation: Rotation = 0): PlacedObject =>
  ({ id: 'probe', catalogId, position: { x, y }, rotation, elevation: 0 });

/** Where a `catalogId` footprint turned by `rotation` lies wholly on grass, wholly on sand, and
 *  across the boundary at row 15. */
function spots(catalogId: string, rotation: Rotation) {
  const { h } = getRotatedSize(getCatalogItem(catalogId)!, rotation);
  return { grass: { x: 4, y: 2 }, sand: { x: 4, y: 20 }, across: { x: 4, y: 15 - Math.ceil(h / 2) } };
}

const verdict = (state: GridState, obj: PlacedObject): string[] =>
  [...new Set(zoneRestrictionRule.validate(placeCmd(obj), state).map((e) => e.message))];

const SAND_ITEMS = ['building-forest-cabin', 'building-myhouse', 'facility-shop', 'facility-pavilion'];

describe('V-ZONE-01: the ground zones an item stands on', () => {
  it('lets every house and the two facilities stand on sand, and nothing else', () => {
    const onSand = getKnownItems().filter((i) => groundZonesOf(i).onSand).map((i) => i.id).sort();
    const houses = getKnownItems().filter((i) => hasGate(i)).map((i) => i.id);
    expect(onSand).toEqual([...houses, 'facility-pavilion', 'facility-shop'].sort());
    expect(getKnownItems().filter((i) => groundZonesOf(i).acrossBoundary)).toEqual([]);
  });

  const cases = ROTATIONS.flatMap((rotation) => SAND_ITEMS.map((id) => ({ id, rotation })));
  it.each(cases)('$id at $rotation degrees stands wholly on grass or wholly on sand, never across', ({ id, rotation }) => {
    const state = shore();
    const s = spots(id, rotation);
    expect(verdict(state, at(id, s.grass.x, s.grass.y, rotation))).toEqual([]);
    expect(verdict(state, at(id, s.sand.x, s.sand.y, rotation))).toEqual([]);
    expect(verdict(state, at(id, s.across.x, s.across.y, rotation))).toEqual(['error.across_zone_boundary']);
  });

  // Every other placeable item is a single cell, so it can only stand on one ground or the other;
  // a grass-only footprint across the boundary is the combinations case below.
  const others = ROTATIONS.flatMap((rotation) => ['building-stall', 'tree-apple', 'flower-rose'].map((id) => ({ id, rotation })));
  it.each(others)('$id at $rotation degrees stays on grass', ({ id, rotation }) => {
    const state = shore();
    const s = spots(id, rotation);
    expect(verdict(state, at(id, s.grass.x, s.grass.y, rotation))).toEqual([]);
    expect(verdict(state, at(id, s.sand.x, s.sand.y, rotation))).toEqual(['error.zone_restricted']);
  });

  it('refuses the sea and the rim to a house that may stand on sand', () => {
    const state = shore();
    for (let x = 0; x < 30; x++) setZone(state, x, 25, CellZone.Void);
    expect(verdict(state, at('building-forest-cabin', 4, 23))).toEqual(['error.zone_restricted']);
    for (let x = 0; x < 30; x++) setZone(state, x, 25, CellZone.Boundary);
    expect(verdict(state, at('building-forest-cabin', 4, 23))).toEqual(['error.zone_restricted']);
    // A planet canvas's rim over sand is sand.
    for (let x = 0; x < 30; x++) state.cells[25]![x]!.under = CellZone.Beach;
    expect(verdict(state, at('building-forest-cabin', 4, 23))).toEqual([]);
    expect(createPlanetRegistry().validatePreCommand(placeCmd(at('building-forest-cabin', 4, 20)), state).filter((e) => e.ruleId === 'V-ZONE-01')).toEqual([]);
  });

  // Every combination of the three properties, on each of the three grounds.
  const combos = [false, true].flatMap((onGrass) =>
    [false, true].flatMap((onSand) => [false, true].map((acrossBoundary) => ({ onGrass, onSand, acrossBoundary }))));
  it.each(combos)('onGrass $onGrass, onSand $onSand, acrossBoundary $acrossBoundary', (zones) => {
    const id = `zone-probe-${+zones.onGrass}${+zones.onSand}${+zones.acrossBoundary}`;
    __setCatalogItem({
      id, category: ItemCategory.Facility, name: { en: id }, width: 3, height: 4, loadValue: 0, rotatable: true,
      placementMode: 'point',
      traits: [{ type: 'groundZones', ...zones }],
    });
    const state = shore();
    const s = spots(id, 0);
    expect(verdict(state, at(id, s.grass.x, s.grass.y))).toEqual(zones.onGrass ? [] : ['error.zone_restricted']);
    expect(verdict(state, at(id, s.sand.x, s.sand.y))).toEqual(zones.onSand ? [] : ['error.zone_restricted']);
    const across = !zones.onGrass || !zones.onSand ? ['error.zone_restricted'] : zones.acrossBoundary ? [] : ['error.across_zone_boundary'];
    expect(verdict(state, at(id, s.across.x, s.across.y))).toEqual(across);
  });
});
