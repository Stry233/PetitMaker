/**
 * The landmark's deck parts are catalog data drawn through the instance path, so they follow the
 * landmark through every edit rather than standing where the map first put it.
 */
import { describe, expect, it } from 'vitest';
import { buildObjectInstances, objectSlotIds, objectSlotInstances, slotOwner } from '../../../../view/map3d/geometry/object-meshes';
import { InstanceSlots } from '../../../../view/map3d/geometry/instance-slots';
import { buildModel, deckGeometry } from '../../../../view/map3d/models/build-model';
import { getDeckSpec } from '../../../../view/map3d/models/registry';
import { LAYER_HEIGHT, cellCornerWorld, platformTopY } from '../../../../view/map3d/geometry/coords';
import { landmarkItem } from '../../../../state/catalog';
import { planetLandmarkObject, turnedLandmark } from '../../../../core/model/landmarks';
import { footprintTerrain } from '../../../../core/grid/footprint';
import { PLACEMENT_GRID } from '../../../../core/game/profile';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';
import { TerrainType, type GridState, type MapTemplate, type PlacedObject } from '../../../../core/model/types';
import { CellZone } from '../../../../core/game/zones';

/** The slot that stands `obj`'s deck parts, or undefined when it has none. */
function deckSlot(state: GridState, obj: PlacedObject) {
  const [, deckId] = objectSlotIds(obj.id);
  return objectSlotInstances(state, obj).find((slot) => slot.slotId === deckId);
}

function grid(objects: PlacedObject[]): GridState {
  const w = 80, h = 80;
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: w, height: h,
    zones: Array.from({ length: h }, () => Array.from({ length: w }, () => CellZone.Grass)),
    landmarks: [],
  };
  const cells: GridState['cells'] = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ zone: CellZone.Grass, terrain: null })));
  // Each landmark stands on a layer-1 mountain, as on the built-in planets.
  for (const o of objects) {
    const r = footprintTerrain({ x: o.position.x, y: o.position.y, w: o.width ?? 0, h: o.height ?? 0 });
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells[y]![x]!.terrain = { type: TerrainType.Mountain, elevation };
  }
  return { template, cells, objects: new Map(objects.map((o) => [o.id, o])), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

const elevation = 1;
const { width, height } = ANCHOR_LANDMARK;
const plaza = planetLandmarkObject(ANCHOR_LANDMARK, { x: 20.5, y: 10.5 }, 0);

describe('the landmark deck', () => {
  it('is authored at the landmark footprint and stands on the deck top at the footprint centre', () => {
    expect(getDeckSpec(landmarkItem().id)?.footprint).toEqual([width, height]);
    const state = grid([plaza]);
    const deck = deckSlot(state, plaza)!;
    const corner = cellCornerWorld(plaza.position.x, plaza.position.y, 80, 80, PLACEMENT_GRID);
    expect(deck.groupKey).toBe(`d:${landmarkItem().id}`);
    expect(deck.inst).toMatchObject({
      x: corner.x + width / 2, z: corner.z + height / 2, y: platformTopY(elevation),
      rotationY: 0, scaleX: 1, scaleY: 1, scaleZ: 1,
    });
    // The plinth is still the platform body beside it.
    expect(buildObjectInstances(state).get('a:platform')).toHaveLength(1);
  });

  it('follows an edited landmark: a move carries it, a turn turns it about the same centre', () => {
    const moved = { ...plaza, position: { x: 30, y: 12 } };
    const before = deckSlot(grid([plaza]), plaza)!.inst;
    const after = deckSlot(grid([moved]), moved)!.inst;
    expect(after.x - before.x).toBeCloseTo(30 - 20.5);
    expect(after.z - before.z).toBeCloseTo(12 - 10.5);

    const turned = turnedLandmark(plaza);
    const deck = deckSlot(grid([turned]), turned)!.inst;
    expect([deck.scaleX, deck.scaleZ]).toEqual([1, 1]);
    expect(deck.rotationY).toBeCloseTo(-Math.PI / 2);
    expect([deck.x, deck.z]).toEqual([before.x, before.z]);
  });

  it('draws nothing for an object without deck parts', () => {
    const tree: PlacedObject = { id: 'a', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    expect(deckSlot(grid([tree]), tree)).toBeUndefined();
  });

  it('builds the parts from the deck top up, inside the footprint', () => {
    const geo = deckGeometry(landmarkItem().id)!;
    geo.computeBoundingBox();
    const box = geo.boundingBox!;
    expect(box.min.y).toBeCloseTo(0);
    expect(box.min.x).toBeGreaterThan(-width / 2);
    expect(box.min.z).toBeGreaterThan(-height / 2);
    expect(box.max.x).toBeLessThan(width / 2);
    expect(box.max.z).toBeLessThan(height / 2);
    expect(box.max.y).toBeCloseTo(getDeckSpec(landmarkItem().id)!.heightInLayers! * LAYER_HEIGHT);
    expect(geo.getAttribute('position').count / 3).toBeLessThan(16_000);
    expect(geo.getAttribute('color')).toBeDefined();
    expect(deckGeometry(landmarkItem().id)).toBe(geo);
    expect(buildModel(getDeckSpec(landmarkItem().id)!).getAttribute('position').count).toBe(geo.getAttribute('position').count);
  });
});

/** The scene's slot bookkeeping, without a renderer: an object takes every slot `objectSlotInstances`
 *  names, a removal frees every slot `objectSlotIds` names, and a reset rebuilds from the map. */
class SlotMirror {
  slots = new InstanceSlots();
  insts = new Map<string, { groupKey: string; inst: unknown }>();
  add(state: GridState, obj: PlacedObject): void {
    for (const d of objectSlotInstances(state, obj)) { this.slots.add(d.slotId, d.groupKey); this.insts.set(d.slotId, d); }
  }
  remove(id: string): void {
    for (const slotId of objectSlotIds(id)) { this.slots.remove(slotId); this.insts.delete(slotId); }
  }
  reset(state: GridState): void {
    this.slots = new InstanceSlots();
    this.insts.clear();
    for (const obj of state.objects.values()) this.add(state, obj);
  }
}

describe('the deck slot', () => {
  const [, deckId] = objectSlotIds(plaza.id);

  it('is taken beside the body and names its owner for picking', () => {
    const mirror = new SlotMirror();
    mirror.add(grid([plaza]), plaza);
    expect(mirror.slots.slotOf(plaza.id)?.group).toBe('a:platform');
    expect(mirror.slots.slotOf(deckId)?.group).toBe(`d:${landmarkItem().id}`);
    expect(slotOwner(deckId)).toBe(plaza.id);
    expect(slotOwner(plaza.id)).toBe(plaza.id);
  });

  it('follows an edit and a reset', () => {
    const mirror = new SlotMirror();
    mirror.add(grid([plaza]), plaza);
    const turned = turnedLandmark(plaza);
    const edited = grid([turned]);
    // objects-changed: the old object leaves, the edited one arrives.
    mirror.remove(plaza.id);
    mirror.add(edited, turned);
    expect(mirror.slots.count(`d:${landmarkItem().id}`)).toBe(1);
    expect(mirror.insts.get(deckId)).toEqual(deckSlot(edited, turned));
    mirror.reset(edited);
    expect(mirror.insts.get(deckId)).toEqual(deckSlot(edited, turned));
    mirror.remove(turned.id);
    expect(mirror.slots.slotOf(deckId)).toBeNull();
    expect(mirror.slots.count(`d:${landmarkItem().id}`)).toBe(0);
  });
});
