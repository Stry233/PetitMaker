import { describe, it, expect } from 'vitest';
import { CommandType, TerrainType, type PlaceObjectCommand } from '../../core/model/types';
import { templateLandmarkObjects } from '../../core/model/landmarks';
import { cellOverlapsRect } from '../../core/grid/rect';
import { placementOverlapRule } from '../../rules/placement-overlap';
import { baseSupportRule } from '../../rules/base-support';
import { getCatalogByCategory } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { getObjectIndex, objectAt } from '../../state/object-index';
import { makeState, setTerrain, placeCmd, makeExecutor } from '../_support/map-state';
import { serialize } from '../../io/save/json-codec';
import { deserialize } from '../_support/save-file';
import { clearAllObjects } from '../../tools/generation';
import type { Command } from '../../core/model/types';
import { ANCHOR_LANDMARK } from '../_support/anchor';
import { landmarkAt } from '../_support/planet';
import { ItemCategory } from '../../config/catalog/categories';

// Plaza occupies world x from 76.5 (a half-block edge).
const PLAZA = landmarkAt(76.5, 58.5);

function stateWithPlaza(w = 120, h = 120) {
  const s = makeState(w, h);
  s.template.landmarks = [{ ...PLAZA }];
  const p = (templateLandmarkObjects(s.template)[0] ?? null);
  if (p) s.objects.set(p.id, p);
  return s;
}

const place = (catalogId: string, x: number, y: number): PlaceObjectCommand =>
  placeCmd({ id: 't', catalogId, position: { x, y }, rotation: 0, elevation: 0 });

describe('Central plaza as an immutable object', () => {
  it('templateLandmarkObjects builds a locked, fractional, sized object (null when no plaza)', () => {
    const s = makeState();
    s.template.landmarks = [{ ...PLAZA }];
    const p = (templateLandmarkObjects(s.template)[0] ?? null)!;
    expect(p.id).toBe(ANCHOR_LANDMARK.id);
    expect(p.catalogId).toBe(ANCHOR_LANDMARK.id);
    expect(p.position).toEqual({ x: PLAZA.x, y: PLAZA.y });
    expect(p.width).toBe(ANCHOR_LANDMARK.width);
    expect(p.height).toBe(ANCHOR_LANDMARK.height);
    expect(p.elevation).toBe(0);
    expect(p.locked).toBe(true);

    expect((templateLandmarkObjects(makeState().template)[0] ?? null)).toBeNull(); // default template has no plaza
  });

  it('is not in any placement list, but IS click-selectable (locked governs modification, not hit-testing)', () => {
    const s = stateWithPlaza();
    expect(getCatalogByCategory(ItemCategory.Facility).some(i => i.id === ANCHOR_LANDMARK.id)).toBe(false);
    expect(objectAt(getObjectIndex(s), { x: 80, y: 70 })?.id).toBe(ANCHOR_LANDMARK.id); // inside the plaza → hit, same as any object
  });

  it('blocks object placement overlapping the plaza; allows adjacent', () => {
    const s = stateWithPlaza();
    expect(placementOverlapRule.validate(place('building-stall', 77, 70), s).length).toBeGreaterThan(0);
    expect(placementOverlapRule.validate(place('building-stall', 75, 70), s)).toHaveLength(0); // [75,76] vs [76.5,..]
  });

  it('blocks terrain paint overlapping the plaza; allows adjacent on both half-block edges', () => {
    const s = stateWithPlaza();
    const e = makeExecutor(s);
    const right = PLAZA.x + PLAZA.width;
    const paint = (x: number, type = TerrainType.Mountain) => e.execute(
      { type: CommandType.PaintTerrain, cells: [{ x, y: 70 }], terrainType: type, elevation: 1 },
    );
    expect(paint(77).success).toBe(false); // overlaps the left edge
    expect(paint(right - 0.5).success).toBe(false); // overlaps the right edge
    expect(paint(76).success).toBe(true);  // touches the left edge only
    expect(paint(right + 0.5, TerrainType.Water).success).toBe(true); // touches the right edge only
  });

  it('blocks a gamma fillet (patchOnly TrimCorners that materialises terrain) over the plaza', () => {
    const s = stateWithPlaza();
    const e = makeExecutor(s);
    const trim = (x: number) => e.execute({
      type: CommandType.TrimCorners, x, y: 70, layer: 'terrain',
      afterCorners: ['fan', 'square', 'square', 'square'],
      patchOnly: true, terrainType: TerrainType.Mountain, elevation: 2, patchBase: 0,
    });
    expect(trim(77).success).toBe(false); // the fillet would materialise terrain over the plaza
    expect(trim(76).success).toBe(true);  // touches the half-block edge only → allowed
  });

  it('a terrainBase object provides 3x3 structural support at the layer of the ground it stands on', () => {
    // A whole-cell plaza over [4, 8) stands on a layer-1 mountain on cells 5 to 7 and on its anchor
    // cell (4, 4); column 8 lies half under it and holds no terrain. A layer-4 block at (9, 6) has the
    // rest of its window at layer 1.
    const build = (withBase: boolean) => {
      const s = makeState(20, 20);
      for (let y = 4; y <= 8; y++) for (let x = 9; x <= 10; x++) setTerrain(s, x, y, TerrainType.Mountain, 1);
      setTerrain(s, 9, 6, TerrainType.Mountain, 4);
      if (!withBase) return s;
      for (let y = 5; y <= 7; y++) for (let x = 5; x <= 7; x++) setTerrain(s, x, y, TerrainType.Mountain, 1);
      setTerrain(s, 4, 4, TerrainType.Mountain, 1);
      s.objects.set(ANCHOR_LANDMARK.id, {
        id: ANCHOR_LANDMARK.id, catalogId: ANCHOR_LANDMARK.id, position: { x: 4, y: 4 }, width: 4, height: 4,
        rotation: 0, elevation: 0, locked: true,
      });
      return s;
    };
    expect(baseSupportRule.validate(build(false)).length).toBeGreaterThan(0);
    expect(baseSupportRule.validate(build(true))).toHaveLength(0);
  });

  it('V-LOCK-02 rejects RemoveObject of the locked plaza; clearAllObjects keeps it and the ban holds', () => {
    const s = stateWithPlaza();
    const e = makeExecutor(s);
    // direct RemoveObject of the plaza is rejected
    const rm: Command = { type: CommandType.RemoveObject, objectId: ANCHOR_LANDMARK.id};
    expect(e.execute(rm).success).toBe(false);
    expect(s.objects.has(ANCHOR_LANDMARK.id)).toBe(true);
    // bulk clear leaves the plaza in place
    clearAllObjects({ state: s, execute: (c) => e.execute(c) });
    expect(s.objects.has(ANCHOR_LANDMARK.id)).toBe(true);
    // and building on a plaza cell is still rejected after the clear
    expect(e.execute(place('building-stall', 80, 70)).success).toBe(false);
  });

  it('serialize omits the plaza; deserialize re-adds it from the template', () => {
    const s = stateWithPlaza();
    const json = serialize(s);
    expect(JSON.parse(json).objects.some((o: { id: string }) => o.id === ANCHOR_LANDMARK.id)).toBe(false);
    const loaded = deserialize(json, s.template);
    expect(loaded.objects.get(ANCHOR_LANDMARK.id)?.locked).toBe(true);
  });

  it('objectRect uses the plaza fractional rect, catalog size for normal objects', () => {
    const plaza = (templateLandmarkObjects({ ...makeState().template, landmarks: [{ ...PLAZA }]})[0] ?? null)!;
    expect(objectRect(plaza)).toEqual({ x: PLAZA.x, y: PLAZA.y, w: PLAZA.width, h: PLAZA.height });
    // a cell that only touches the plaza edge does not overlap; the next one does
    expect(cellOverlapsRect(objectRect(plaza), 76, 70, 'terrain')).toBe(false);
    expect(cellOverlapsRect(objectRect(plaza), 77, 70, 'terrain')).toBe(true);
  });
});
