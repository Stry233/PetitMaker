import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import {
  CommandType, TerrainType, ItemCategory,
  type EditorEvents, type PlaceObjectCommand,
} from '../../core/model/types';
import { createPlazaObject, cellOverlapsRect } from '../../core/model/grid-model';
import { PLAZA_ID } from '../../core/model/constants';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { baseSupportRule } from '../../rules/base-support';
import { getCatalogByCategory } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { getObjectIndex, objectAt, roadLookup } from '../../state/object-index';
import { makeState, setTerrain, placeCmd } from './_helpers';
import { serialize, deserialize } from '../../io/json-codec';
import { clearAllObjects } from '../../tools/generation/terrain-generator';
import type { Command } from '../../core/model/types';

// Plaza occupies world x ∈ [76.5, 96.5] (a half-block edge).
const PLAZA = { x: 76.5, y: 58.5, width: 20, height: 27, elevation: 1 };

function stateWithPlaza(w = 120, h = 120) {
  const s = makeState(w, h);
  s.template.plaza = { ...PLAZA };
  const p = createPlazaObject(s.template);
  if (p) s.objects.set(p.id, p);
  return s;
}

const place = (catalogId: string, x: number, y: number): PlaceObjectCommand =>
  placeCmd({ id: 't', catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('Central plaza as an immutable object', () => {
  it('createPlazaObject builds a locked, fractional, sized object (null when no plaza)', () => {
    const s = makeState();
    s.template.plaza = { ...PLAZA };
    const p = createPlazaObject(s.template)!;
    expect(p.id).toBe(PLAZA_ID);
    expect(p.catalogId).toBe(PLAZA_ID);
    expect(p.position).toEqual({ x: 76.5, y: 58.5 });
    expect(p.width).toBe(20);
    expect(p.height).toBe(27);
    expect(p.elevation).toBe(1);
    expect(p.locked).toBe(true);

    expect(createPlazaObject(makeState().template)).toBeNull(); // default template has no plaza
  });

  it('is not in any placement list, but IS click-selectable (locked governs modification, not hit-testing)', () => {
    const s = stateWithPlaza();
    expect(getCatalogByCategory(ItemCategory.Facility).some(i => i.id === PLAZA_ID)).toBe(false);
    expect(objectAt(getObjectIndex(s), { x: 80, y: 70 })?.id).toBe(PLAZA_ID); // inside the plaza → hit, same as any object
  });

  it('blocks object placement overlapping the plaza; allows adjacent', () => {
    const s = stateWithPlaza();
    expect(placementOverlapRule.validate(place('building-stall', 77, 70), s).length).toBeGreaterThan(0);
    expect(placementOverlapRule.validate(place('building-stall', 75, 70), s)).toHaveLength(0); // [75,76] vs [76.5,..]
  });

  it('blocks terrain paint overlapping the plaza; allows adjacent (half-block edge)', () => {
    const s = stateWithPlaza();
    const e = new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));
    const paint = (x: number) => e.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x, y: 70 }], terrainType: TerrainType.Mountain, elevation: 1 });
    expect(paint(77).success).toBe(false); // overlaps
    expect(paint(76).success).toBe(true);  // touches edge only
  });

  it('blocks a gamma fillet (patchOnly TrimCorners that materialises terrain) over the plaza', () => {
    const s = stateWithPlaza();
    const e = new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));
    const trim = (x: number) => e.execute({
      type: CommandType.TrimCorners, timestamp: 0, x, y: 70, layer: 'terrain',
      beforeCorners: undefined, afterCorners: ['fan', 'square', 'square', 'square'],
      patchOnly: true, terrainType: TerrainType.Mountain, elevation: 2, patchBase: 0,
    });
    expect(trim(77).success).toBe(false); // the fillet would materialise terrain over the plaza
    expect(trim(76).success).toBe(true);  // touches the half-block edge only → allowed
  });

  it('a terrainBase object provides 3x3 structural support at its elevation', () => {
    const noBase = makeState(20, 20);
    setTerrain(noBase, 5, 5, TerrainType.Mountain, 4);
    expect(baseSupportRule.validate(noBase).length).toBeGreaterThan(0); // grass-only → no base

    const withBase = makeState(20, 20);
    setTerrain(withBase, 5, 5, TerrainType.Mountain, 4);
    withBase.objects.set(PLAZA_ID, {
      id: PLAZA_ID, catalogId: PLAZA_ID, position: { x: 3.5, y: 3.5 }, width: 4, height: 4,
      rotation: 0, elevation: 1, locked: true,
    });
    expect(baseSupportRule.validate(withBase)).toHaveLength(0); // terrainBase covers the 3x3 at elev 1
  });

  it('V-LOCK-02 rejects RemoveObject of the locked plaza; clearAllObjects keeps it and the ban holds', () => {
    const s = stateWithPlaza();
    const e = new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));
    // direct RemoveObject of the plaza is rejected
    const rm: Command = { type: CommandType.RemoveObject, timestamp: 0, objectId: PLAZA_ID, removedObject: s.objects.get(PLAZA_ID)! };
    expect(e.execute(rm).success).toBe(false);
    expect(s.objects.has(PLAZA_ID)).toBe(true);
    // bulk clear leaves the plaza in place
    clearAllObjects(s, (c) => e.execute(c));
    expect(s.objects.has(PLAZA_ID)).toBe(true);
    // and building on a plaza cell is still rejected after the clear
    expect(e.execute(place('building-stall', 80, 70)).success).toBe(false);
  });

  it('serialize omits the plaza; deserialize re-adds it from the template', () => {
    const s = stateWithPlaza();
    const json = serialize(s);
    expect(JSON.parse(json).objects.some((o: { id: string }) => o.id === PLAZA_ID)).toBe(false);
    const loaded = deserialize(json, s.template);
    expect(loaded.objects.get(PLAZA_ID)?.locked).toBe(true);
  });

  it('objectRect uses the plaza fractional rect, catalog size for normal objects', () => {
    const plaza = createPlazaObject({ ...makeState().template, plaza: { ...PLAZA } })!;
    expect(objectRect(plaza)).toEqual({ x: 76.5, y: 58.5, w: 20, h: 27 });
    // a cell that only touches the plaza edge does not overlap; the next one does
    expect(cellOverlapsRect(objectRect(plaza), 76, 70, -0.5)).toBe(false);
    expect(cellOverlapsRect(objectRect(plaza), 77, 70, -0.5)).toBe(true);
  });
});
