/**
 * The per-object instance resolver: incremental add/remove builds ONE object's
 * instance without re-deriving the whole map, so it must agree exactly with
 * the bulk builder's output for the same object.
 */
import { describe, it, expect } from 'vitest';
import { buildObjectInstances, objectInstance } from '../../canvas/map3d/build/object-meshes';
import { type GridState, type PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';
import { getCatalogItem } from '../../state/catalog';

function withObjects(...objs: PlacedObject[]): GridState {
  const s = makeState(30, 30) as GridState;
  for (const o of objs) s.objects.set(o.id, o);
  return s;
}

const place = (id: string, catalogId: string, x: number, y: number, extra: Partial<PlacedObject> = {}): PlacedObject =>
  ({ id, catalogId, position: { x, y }, rotation: 0, elevation: 0, ...extra });

describe('objectInstance', () => {
  it('matches the bulk builder for archetype, model, ramp and trimmed-road cases', () => {
    expect(getCatalogItem('building-myhouse')).toBeTruthy();
    const objs = [
      place('house', 'building-myhouse', 4, 4),
      place('road', 'road-dirt', 10, 10),
      place('trimmed', 'road-dirt', 12, 10, { corners: ['square', 'fan', 'square', 'square'] }),
      place('ramp', 'ramp-green-steps', 8, 14, { elevation: 1, rotation: 90 }),
    ];
    const state = withObjects(...objs);
    const bulk = buildObjectInstances(state);
    const bulkFlat = [...bulk.entries()].flatMap(([k, list]) => list.map((inst) => ({ k, inst })));

    for (const obj of objs) {
      const single = objectInstance(state, obj);
      if (obj.id === 'trimmed') {
        expect(single, 'trimmed roads are meshed, not instanced').toBeNull();
        continue;
      }
      expect(single).not.toBeNull();
      const match = bulkFlat.find((e) => e.k === single!.groupKey && JSON.stringify(e.inst) === JSON.stringify(single!.inst));
      expect(match, `bulk builder contains ${obj.id}'s instance`).toBeTruthy();
    }
    // bulk emits exactly the three instanced objects
    expect(bulkFlat).toHaveLength(3);
  });
});
