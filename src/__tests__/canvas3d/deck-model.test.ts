/**
 * The landmark's deck parts are catalog data drawn through the instance path, so they follow the
 * landmark through every edit rather than standing where the map first put it.
 */
import { describe, expect, it } from 'vitest';
import { buildObjectInstances, deckInstance, objectSlotIds, objectSlotInstances, slotOwner } from '../../canvas/map3d/build/object-meshes';
import { InstanceSlots } from '../../canvas/map3d/build/instance-slots';
import { buildModel, deckGeometry } from '../../canvas/map3d/models/build-model';
import { LAYER_HEIGHT, cellCornerWorld, platformTopY } from '../../canvas/map3d/core/coords';
import { landmarkItem } from '../../state/catalog';
import { landmarkObject } from '../../core/model/grid-model';
import { turnedPlaza } from '../../core/model/planet';
import { PLANET_PROFILE } from '../../core/model/game-profile';
import { CellZone, type GridState, type MapTemplate, type PlacedObject } from '../../core/model/types';

function grid(objects: PlacedObject[]): GridState {
  const w = 80, h = 80;
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: w, height: h,
    zones: Array.from({ length: h }, () => Array.from({ length: w }, () => CellZone.Grass)),
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  const cells = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ zone: CellZone.Grass, terrain: null })));
  return { template, cells, objects: new Map(objects.map((o) => [o.id, o])), lockedLayers: new Set() };
}

const { width, height, elevation } = PLANET_PROFILE.landmark;
const plaza = landmarkObject({ x: 20.5, y: 10.5, width, height, elevation }, false);

describe('the landmark deck', () => {
  it('is authored at the landmark footprint and stands on the deck top at the footprint centre', () => {
    expect(landmarkItem().deckModel3d?.footprint).toEqual([width, height]);
    const state = grid([plaza]);
    const deck = deckInstance(state, plaza)!;
    const corner = cellCornerWorld(plaza.position.x, plaza.position.y, 80, 80);
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
    const before = deckInstance(grid([plaza]), plaza)!.inst;
    const after = deckInstance(grid([moved]), moved)!.inst;
    expect(after.x - before.x).toBeCloseTo(30 - 20.5);
    expect(after.z - before.z).toBeCloseTo(12 - 10.5);

    const turned = turnedPlaza(plaza);
    const deck = deckInstance(grid([turned]), turned)!.inst;
    expect([deck.scaleX, deck.scaleZ]).toEqual([1, 1]);
    expect(deck.rotationY).toBeCloseTo(-Math.PI / 2);
    expect([deck.x, deck.z]).toEqual([before.x, before.z]);
  });

  it('draws nothing for an object without deck parts', () => {
    const tree: PlacedObject = { id: 'a', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    expect(deckInstance(grid([tree]), tree)).toBeNull();
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
    expect(box.max.y).toBeCloseTo(landmarkItem().deckModel3d!.heightInLayers! * LAYER_HEIGHT);
    expect(geo.getAttribute('position').count / 3).toBeLessThan(16_000);
    expect(geo.getAttribute('color')).toBeDefined();
    expect(deckGeometry(landmarkItem().id)).toBe(geo);
    expect(buildModel(landmarkItem().deckModel3d!).getAttribute('position').count).toBe(geo.getAttribute('position').count);
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
    const turned = turnedPlaza(plaza);
    const edited = grid([turned]);
    // objects-changed: the old object leaves, the edited one arrives.
    mirror.remove(plaza.id);
    mirror.add(edited, turned);
    expect(mirror.slots.count(`d:${landmarkItem().id}`)).toBe(1);
    expect(mirror.insts.get(deckId)).toEqual({ slotId: deckId, ...deckInstance(edited, turned) });
    mirror.reset(edited);
    expect(mirror.insts.get(deckId)).toEqual({ slotId: deckId, ...deckInstance(edited, turned) });
    mirror.remove(turned.id);
    expect(mirror.slots.slotOf(deckId)).toBeNull();
    expect(mirror.slots.count(`d:${landmarkItem().id}`)).toBe(0);
  });
});
