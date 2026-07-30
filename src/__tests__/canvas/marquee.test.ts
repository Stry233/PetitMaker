/**
 * Pure geometry for the Ctrl+drag rubber band: normalising the drag into a macro
 * rect, and collecting the objects it covers through the object index.
 */
import { describe, it, expect, vi } from 'vitest';
import { macroRect, objectsInBand } from '../../canvas/interaction/marquee';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { ObjectCategory, type GridState, type PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

function withObject(id: string, pos: { x: number; y: number }, w: number, h: number): GridState {
  const gs = makeState(20, 20);
  const obj: PlacedObject = {
    id, catalogId: 'building-cabin', position: pos, width: w, height: h,
    rotation: 0, category: ObjectCategory.House, elevation: 0,
  };
  gs.objects.set(id, obj);
  bumpObjectsVersion(gs, { added: [obj] });
  return gs;
}

function withManyObjects(count: number): GridState {
  const gs = makeState(200, 200);
  const objs: PlacedObject[] = [];
  for (let i = 0; i < count; i++) {
    objs.push({
      id: `o${i}`, catalogId: 'tree-apple', position: { x: i % 200, y: Math.floor(i / 200) },
      rotation: 0, category: ObjectCategory.Tree, elevation: 0,
    });
  }
  for (const obj of objs) gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: objs });
  return gs;
}

describe('macroRect', () => {
  it('normalises a band dragged in any direction', () => {
    expect(macroRect({ x: 8, y: 9 }, { x: 3, y: 2 })).toEqual({ x: 3, y: 2, w: 6, h: 8 });
  });

  it('normalises a band dragged the other way (min/max flipped)', () => {
    expect(macroRect({ x: 3, y: 2 }, { x: 8, y: 9 })).toEqual({ x: 3, y: 2, w: 6, h: 8 });
  });

  it('a zero-drag band (a click with no motion) is a single cell', () => {
    expect(macroRect({ x: 5, y: 5 }, { x: 5, y: 5 })).toEqual({ x: 5, y: 5, w: 1, h: 1 });
  });
});

describe('objectsInBand', () => {
  it('takes an object whose footprint INTERSECTS the band, not only one contained by it', () => {
    // Containment makes large buildings nearly unselectable.
    const gs = withObject('house', { x: 4, y: 4 }, 3, 3); // covers 4..6
    expect(objectsInBand(gs, { x: 6, y: 6, w: 2, h: 2 })).toEqual(['house']); // one-cell overlap
    expect(objectsInBand(gs, { x: 7, y: 7, w: 2, h: 2 })).toEqual([]);
  });

  it('asks the object index rather than scanning every object', () => {
    const gs = withManyObjects(2000);
    const spy = vi.spyOn(gs.objects, 'forEach');
    objectsInBand(gs, { x: 0, y: 0, w: 4, h: 4 });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns nothing for an empty patch of ground', () => {
    const gs = withObject('house', { x: 4, y: 4 }, 3, 3);
    expect(objectsInBand(gs, { x: 10, y: 10, w: 2, h: 2 })).toEqual([]);
  });
});
