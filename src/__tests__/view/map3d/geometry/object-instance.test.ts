/**
 * The per-object instance resolver: the 3D view places each object through it as the object is
 * added, so it alone decides which group draws an object and where.
 */
import { describe, it, expect } from 'vitest';
import { objectInstance } from '../../../../view/map3d/geometry/object-meshes';
import { type GridState, type PlacedObject } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { getCatalogItem } from '../../../../state/catalog';
import { planetLandmarkObject } from '../../../../core/model/landmarks';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';

function withObjects(...objs: PlacedObject[]): GridState {
  const s = makeState(30, 30) as GridState;
  for (const o of objs) s.objects.set(o.id, o);
  return s;
}

const place = (id: string, catalogId: string, x: number, y: number, extra: Partial<PlacedObject> = {}): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0, ...extra });

describe('objectInstance', () => {
  it('instances a house and a ramp in their groups and leaves every road to the road mesh', () => {
    expect(getCatalogItem('building-myhouse')).toBeTruthy();
    const objs = [
      place('house', 'building-myhouse', 4, 4),
      place('road', 'path-overgrown-dirt', 10, 10),
      place('trimmed', 'path-overgrown-dirt', 12, 10, { corners: ['square', 'fan', 'square', 'square'] }),
      place('ramp', 'ramp-green-steps', 8, 14, { elevation: 1, rotation: 90 }),
    ];
    const state = withObjects(...objs);
    for (const obj of objs) {
      const single = objectInstance(state, obj);
      if (obj.id === 'trimmed' || obj.id === 'road') {
        expect(single, 'every road is meshed, not instanced').toBeNull();
        continue;
      }
      expect(single, obj.id).not.toBeNull();
      expect(single!.groupKey, obj.id).toMatch(/^[am]:/);
      expect(Object.values(single!.inst).filter((v) => typeof v === 'number').every(Number.isFinite), obj.id).toBe(true);
    }
  });

  it.each([0, 90, 180, 270] as const)('fills the turned plaza footprint exactly at %s degrees', (rotation) => {
    const plaza = planetLandmarkObject(ANCHOR_LANDMARK, { x: 1, y: 1 }, rotation);
    const inst = objectInstance(withObjects(plaza), plaza)!.inst;
    const cos = Math.abs(Math.cos(inst.rotationY)), sin = Math.abs(Math.sin(inst.rotationY));
    const across = rotation === 90 || rotation === 270;
    expect(cos * inst.scaleX + sin * inst.scaleZ).toBeCloseTo(across ? ANCHOR_LANDMARK.height : ANCHOR_LANDMARK.width);
    expect(sin * inst.scaleX + cos * inst.scaleZ).toBeCloseTo(across ? ANCHOR_LANDMARK.width : ANCHOR_LANDMARK.height);
  });
});
