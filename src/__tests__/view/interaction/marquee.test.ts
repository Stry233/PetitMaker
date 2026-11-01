/**
 * Pure geometry for the Ctrl+drag rubber band: normalising the drag into a macro
 * rect, and collecting the objects it covers.
 */
import { describe, it, expect } from 'vitest';
import { macroRect, objectsInBand } from '../../../view/interaction/marquee';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { type GridState, type PlacedObject } from '../../../core/model/types';
import { makeState } from '../../_support/map-state';

function withObject(id: string, pos: { x: number; y: number }, w: number, h: number): GridState {
  const gs = makeState(20, 20);
  const obj: PlacedObject = {
    id, catalogId: 'building-cabin', position: pos, width: w, height: h,
    rotation: 0, elevation: 0,
  };
  gs.objects.set(id, obj);
  bumpObjectsVersion(gs, { added: [obj] });
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

  it('returns nothing for an empty patch of ground', () => {
    const gs = withObject('house', { x: 4, y: 4 }, 3, 3);
    expect(objectsInBand(gs, { x: 10, y: 10, w: 2, h: 2 })).toEqual([]);
  });
});
