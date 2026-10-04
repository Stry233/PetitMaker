import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { PlacedObject, Rotation } from '../../core/model/types';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { getCatalogItem } from '../../state/catalog';
import { InstanceSlots } from '../../canvas/map3d/build/instance-slots';
import { objectInstance } from '../../canvas/map3d/build/object-meshes';
import { cellCornerWorld } from '../../canvas/map3d/core/coords';
import { modelGeometry } from '../../canvas/map3d/models/build-model';
import { ThreeScene } from '../../canvas/map3d/scene/scene';
import { makeState } from '../rules/_helpers';

function fixture(catalogId: string, rotation: Rotation) {
  const state = makeState(24, 24);
  const obj: PlacedObject = { id: 'selected', catalogId, position: { x: 6.5, y: 8 }, rotation, elevation: 0 };
  state.objects.set(obj.id, obj);
  const resolved = objectInstance(state, obj)!;
  const slots = new InstanceSlots();
  slots.add(obj.id, resolved.groupKey);
  const geo = modelGeometry(catalogId)!;
  const scene = Object.assign(Object.create(ThreeScene.prototype), {
    liveState: state, slots, groups: new Map([[resolved.groupKey, { geo, instances: [resolved.inst] }]]),
  }) as ThreeScene;
  return { state, obj, scene, geo, inst: resolved.inst };
}

describe('3D object selection bounds', () => {
  it.each([0, 90, 180, 270] as const)('keeps the full house exclusion footprint at %s degrees', (rotation) => {
    const { state, obj, scene, geo } = fixture('building-myhouse', rotation);
    const bounds = scene.objectBoundingBox(obj.id)!;
    const corner = cellCornerWorld(obj.position.x, obj.position.y, state.template.width, state.template.height);
    const item = getCatalogItem('building-myhouse')!;
    const [width, depth] = rotation % 180 === 0 ? [item.width, item.height] : [item.height, item.width];
    expect([bounds.min.x, bounds.min.z]).toEqual([corner.x, corner.z]);
    expect([bounds.max.x, bounds.max.z]).toEqual([corner.x + width!, corner.z + depth!]);
    expect(geo.boundingBox!.max.x - geo.boundingBox!.min.x).toBeLessThan(5);
    expect(geo.boundingBox!.max.z - geo.boundingBox!.min.z).toBeLessThan(4);
  });

  it.each([0, 90, 180, 270] as const)('includes the pavilion side clearance at %s degrees', (rotation) => {
    const { state, obj, scene, geo, inst } = fixture('facility-pavilion', rotation);
    const box = scene.objectBoundingBox(obj.id)!;
    const corner = cellCornerWorld(obj.position.x, obj.position.y, state.template.width, state.template.height);
    const size = getPlacedObjectSize(obj);
    const item = getCatalogItem('facility-pavilion')!;
    expect([size.w, size.h]).toEqual(rotation % 180 === 0 ? [item.width, item.height] : [item.height, item.width]);
    expect([box.min.x, box.min.z]).toEqual([corner.x, corner.z]);
    expect([box.max.x, box.max.z]).toEqual([corner.x + size.w, corner.z + size.h]);
    expect(box.min.y).toBeCloseTo(inst.y);
    expect(box.max.y - box.min.y).toBeCloseTo(geo.boundingBox!.max.y);

  });

  it('uses the tree footprint even when its canopy extends beyond the occupied cells', () => {
    const { obj, scene, geo } = fixture('tree-apple', 0);
    const size = getPlacedObjectSize(obj);
    const bounds = scene.objectBoundingBox(obj.id)!.getSize(new THREE.Vector3());
    expect(geo.boundingBox!.max.x - geo.boundingBox!.min.x).toBeGreaterThan(size.w);
    expect(bounds.x).toBe(size.w);
    expect(bounds.z).toBe(size.h);
    expect(scene.objectBoundingBox('missing')).toBeNull();
  });
});
