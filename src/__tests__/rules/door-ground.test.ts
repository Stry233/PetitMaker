import { describe, expect, it } from 'vitest';
import { TerrainType, ROTATIONS, type GridState, type PlacedObject, type Rotation } from '../../core/model/types';
import { CellZone } from '../../core/game/zones';
import { DOOR } from '../../core/game/profile';
import { getCell } from '../../core/model/grid-model';
import { createGridState } from '../../core/model/template';
import { getMapTemplate } from '../../config/maps/index';
import { createDefaultRegistry, createPlanetRegistry } from '../../rules/index';
import { doorGroundRule } from '../../rules/door-ground';
import { getCatalogItem } from '../../state/catalog';
import { createExecutor } from '../../state/executor';
import { doorGroundRect, doorOf, hasGate, objectRect } from '../../state/object-geometry';
import { terrainCellsUnder } from '../../core/grid/footprint';
import { defaultConfig } from '../../tools/generation/recipe';
import { generateWith } from '../_support/generation';
import { eraseCmd, makeExecutor, makeState, paintCmd, placeCmd, setTerrain, setZone } from '../_support/map-state';
import { serialize } from '../../io/save/json-codec';
import { deserialize } from '../_support/save-file';

const CABIN = 'building-forest-cabin';
const AT = { x: 12, y: 12 };

const cabin = (rotation: Rotation, elevation = 1, at = AT): PlacedObject =>
  ({ id: `cabin-${rotation}`, catalogId: CABIN, position: { ...at }, rotation, elevation });

/** A 32 x 32 plateau at layer 1. */
function plateau(): GridState {
  const state = makeState(32, 32);
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) setTerrain(state, x, y, TerrainType.Mountain, 1);
  return state;
}

/** How far out from the door side of `house`'s footprint the near edge of a cell lies, for a cell
 *  covering [x + shift, x + shift + 1) on the object grid: shift -0.5 for a terrain cell, 0 for a
 *  placement cell. Negative behind the door side. */
function outFrom(house: PlacedObject, x: number, y: number, shift: number): number {
  const r = objectRect(house);
  const { facing } = doorOf(r, house.rotation);
  if (facing.y > 0) return y + shift - (r.y + r.h);
  if (facing.y < 0) return r.y - (y + shift + 1);
  if (facing.x > 0) return x + shift - (r.x + r.w);
  return r.x - (x + shift + 1);
}

/** Runs `apply` on every cell of the 32 x 32 map whose near edge lies `edge` or more cells out from
 *  the door side (terrain cells, or placement cells with `zones`), and checks one lies exactly there. */
function beyond(house: PlacedObject, edge: number, apply: (x: number, y: number) => void, zones = false): void {
  let at = 0;
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const out = outFrom(house, x, y, zones ? 0 : -0.5);
      if (out === edge) at++;
      if (out >= edge) apply(x, y);
    }
  }
  expect(at, `a cell edge lies ${edge} cells out`).toBeGreaterThan(0);
}

const cliff = (state: GridState) => (x: number, y: number) => { getCell(state.cells, x, y)!.terrain = null; };
const rise = (state: GridState) => (x: number, y: number) => setTerrain(state, x, y, TerrainType.Mountain, 2);
const water = (state: GridState) => (x: number, y: number) => setTerrain(state, x, y, TerrainType.Water, 1);
const sea = (state: GridState) => (x: number, y: number) => setZone(state, x, y, CellZone.Void);

const refusals = (state: GridState, house: PlacedObject, registry = createDefaultRegistry()): string[] =>
  registry.validatePreCommand(placeCmd(house), state).map((e) => e.ruleId);

describe('V-PLACE-DOOR', () => {
  it('reads the door at the middle of the gate side, and the strip along that whole side', () => {
    const rect = { x: 12, y: 12, w: 5, h: 4 };
    const d = DOOR.dropDepth;
    expect(doorOf(rect, 0)).toEqual({ gate: { x: 14, y: 15 }, facing: { x: 0, y: 1 } });
    expect(doorGroundRect(rect, 0, d)).toEqual({ x: 12, y: 16, w: 5, h: d });
    const turned = { x: 12, y: 12, w: 4, h: 5 };
    expect(doorGroundRect(turned, 90, d)).toEqual({ x: 12 - d, y: 12, w: d, h: 5 });
    expect(doorGroundRect(rect, 180, d)).toEqual({ x: 12, y: 12 - d, w: 5, h: d });
    expect(doorGroundRect(turned, 270, d)).toEqual({ x: 16, y: 12, w: d, h: 5 });
  });

  // The door side, not the door cell: a drop or a rise at either end of the side counts.
  it.each(ROTATIONS)('at %i degrees, refuses a drop or a rise at the far ends of the door side', (rotation) => {
    const house = cabin(rotation);
    const strip = doorGroundRect(objectRect(house), rotation, DOOR.dropDepth);
    const ends = terrainCellsUnder(strip);
    const door = doorOf(objectRect(house), rotation).gate;
    const corner = ends.find((c) => Math.abs(c.x - door.x) + Math.abs(c.y - door.y) >= 3 && outFrom(house, c.x, c.y, -0.5) === 0.5)!;
    expect(corner, 'a terrain cell on the door side, away from the door').toBeDefined();
    const dropped = plateau();
    getCell(dropped.cells, corner.x, corner.y)!.terrain = null;
    expect(refusals(dropped, house)).toEqual(['V-PLACE-DOOR']);
    const raised = plateau();
    setTerrain(raised, corner.x, corner.y, TerrainType.Mountain, 2);
    expect(refusals(raised, house)).toEqual(['V-PLACE-DOOR']);
  });

  // Terrain cell edges lie on half cells (0.5, 1.5, 2.5 out from a whole-cell footprint) and
  // placement cell edges on whole cells, so each case sits on the nearest edge either grid has.
  const cases: [string, number, 'drop' | 'rise' | null, (s: GridState) => (x: number, y: number) => void, boolean?][] = [
    ['a cliff edge 0.5 cells out', 0.5, 'drop', cliff],
    ['a cliff edge 1.5 cells out', 1.5, null, cliff],
    ['the sea 1 cell out', 1, 'drop', sea, true],
    ['the sea 2 cells out', 2, null, sea, true],
    ['higher ground 1.5 cells out', 1.5, 'rise', rise],
    ['higher ground 2.5 cells out', 2.5, null, rise],
    ['water 1.5 cells out', 1.5, 'rise', water],
    ['water 2.5 cells out', 2.5, null, water],
  ];
  const each = ROTATIONS.flatMap((rotation) => cases.map(([what, edge, fault, shape, zones]) => ({ rotation, what, edge, fault, shape, zones })));

  it.each(each)('at $rotation degrees, $what is $fault', ({ rotation, edge, fault, shape, zones }) => {
    const state = zones ? makeState(32, 32) : plateau();
    const house = cabin(rotation, zones ? 0 : 1);
    beyond(house, edge, shape(state), zones);
    const errors = createDefaultRegistry().validatePreCommand(placeCmd(house), state).filter((e) => e.ruleId === 'V-PLACE-DOOR');
    if (!fault) { expect(errors).toEqual([]); return; }
    const depth = fault === 'drop' ? DOOR.dropDepth : DOOR.riseDepth;
    expect(errors.map((e) => [e.message, e.messageParams])).toEqual([[`error.door_near_${fault}`, { n: depth }]]);
    expect(errors[0]!.rects).toEqual([doorGroundRect(objectRect(house), rotation, depth)]);
  });

  it('refuses a door facing the map edge, and leaves doorless items alone', () => {
    const state = makeState(32, 32);
    expect(refusals(state, cabin(90, 0, { x: 1, y: 12 }))).toEqual(['V-PLACE-DOOR']);
    expect(refusals(state, cabin(90, 0, { x: 2, y: 12 }))).toEqual([]);
    expect(hasGate(getCatalogItem('building-stall')!)).toBe(false);
    expect(refusals(makeState(32, 32), { ...cabin(0, 0), id: 'stall', catalogId: 'building-stall', position: { x: 0, y: 31 } })).toEqual([]);
  });

  it('refuses a terrain edit that breaks a standing door, not one beyond it, and holds a broken door to the same rule', () => {
    const state = plateau();
    const exec = makeExecutor(state);
    expect(exec.execute(placeCmd(cabin(0))).success).toBe(true);
    // The door side is y = 16: terrain row 17 starts 0.5 out, row 18 1.5 out, row 19 2.5 out.
    const ids = (cmd: Parameters<typeof exec.execute>[0]) => exec.execute(cmd).errors.map((e) => e.ruleId);
    expect(ids(eraseCmd([{ x: 14, y: 17 }]))).toEqual(['V-PLACE-DOOR']);
    expect(ids(paintCmd([{ x: 14, y: 18 }], TerrainType.Mountain, 2))).toContain('V-PLACE-DOOR');
    expect(ids(paintCmd([{ x: 14, y: 18 }], TerrainType.Water, 1))).toContain('V-PLACE-DOOR');
    expect(exec.execute(eraseCmd([{ x: 14, y: 18 }])).success).toBe(true);
    expect(exec.execute(paintCmd([{ x: 14, y: 19 }], TerrainType.Mountain, 2)).success).toBe(true);

    // A map saved with a door at a cliff decodes as saved (the load's repair settles it), and an
    // edit near that door is refused while it leaves the doorstep broken.
    const old = plateau();
    old.objects.set('cabin-0', cabin(0));
    beyond(cabin(0), 0.5, cliff(old));
    const restored = deserialize(serialize(old), old.template);
    expect(restored.objects.get('cabin-0')).toEqual(cabin(0));
    expect(refusals(restored, cabin(0))).toContain('V-PLACE-DOOR');
    expect(createDefaultRegistry().validatePreCommand(paintCmd([{ x: 15, y: 18 }], TerrainType.Water, 1), restored).map((e) => e.ruleId)).toEqual(['V-PLACE-DOOR']);
  });

  it('holds in the planet editor: a ground edit may not turn the doorstep to sea', () => {
    const state = makeState(32, 32);
    const exec = makeExecutor(state, createPlanetRegistry());
    expect(exec.execute(placeCmd(cabin(0, 0))).success).toBe(true);
    const toSea = (x: number, y: number) => ({ ...eraseCmd([{ x, y }]), ground: CellZone.Void as const });
    expect(exec.execute(toSea(14, 17)).errors.map((e) => e.ruleId)).toEqual(['V-PLACE-DOOR']);
    expect(exec.execute(toSea(14, 18)).success).toBe(true);
    setZone(state, 20, 21, CellZone.Void);
    expect(refusals(state, cabin(0, 0, { x: 18, y: 16 }), createPlanetRegistry())).toContain('V-PLACE-DOOR');
  });
});

describe('V-PLACE-DOOR in generation', () => {
  it('leaves every generated house a doorstep the rule accepts', () => {
    const state = createGridState(getMapTemplate('tafa'));
    const executor = createExecutor(state, createDefaultRegistry());
    generateWith(state, executor, defaultConfig('designed', { mode: 'mixed', seed: 3, richness: 1 }));
    const houses = [...state.objects.values()].filter((o) => {
      const item = getCatalogItem(o.catalogId);
      return !!item && hasGate(item);
    });
    expect(houses.length).toBeGreaterThan(0);
    for (const o of houses) expect(doorGroundRule.validate(placeCmd(o), state), o.id).toEqual([]);
  }, 120_000);
});
