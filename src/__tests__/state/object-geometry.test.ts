import { describe, it, expect } from 'vitest';
import { hasHalfStep, coveredCells, snapAnchor, buildObjectOccupancy } from '../../state/object-geometry';
import { getAllItems, getCatalogItem } from '../../state/catalog';
import { ItemCategory, type CatalogItem } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

const HALF_STEP_CATEGORIES = [ItemCategory.Bridge, ItemCategory.Ramp];

describe('hasHalfStep', () => {
  it('is true for every bridge and ramp catalog item', () => {
    const offenders = getAllItems().filter(
      (i) => HALF_STEP_CATEGORIES.includes(i.category) && !hasHalfStep(i),
    );
    expect(offenders.map((i) => i.id)).toEqual([]);
  });

  it('is false for a plain item with no halfStep trait', () => {
    expect(hasHalfStep(getCatalogItem('tree-apple')!)).toBe(false);
  });
});

describe('coveredCells', () => {
  it('expands a half-integer origin to every partially covered cell', () => {
    expect(coveredCells(7.5, 2)).toEqual([7, 8, 9]);
  });

  it('matches the plain integer span for a whole-integer origin', () => {
    expect(coveredCells(7, 2)).toEqual([7, 8]);
  });

  it('handles size 1 at a half origin', () => {
    expect(coveredCells(7.5, 1)).toEqual([7, 8]);
  });
});

describe('snapAnchor', () => {
  const halfStepItem: CatalogItem = {
    id: 'test-half', category: ItemCategory.Ramp, name: { en: 'Test Half' },
    width: 2, height: 4, loadValue: 0, rotatable: false, placementMode: 'point',
    traits: [{ type: 'halfStep' }],
  };
  const plainItem: CatalogItem = {
    id: 'test-plain', category: ItemCategory.Tree, name: { en: 'Test Plain' },
    width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
    traits: [],
  };

  it('snaps a halfStep item to the nearest half cell', () => {
    expect(snapAnchor(halfStepItem, 7.3, 5.1)).toEqual({ x: 7.5, y: 5 });
    expect(snapAnchor(halfStepItem, 7.7, 5.4)).toEqual({ x: 7.5, y: 5.5 });
  });

  it('snaps a plain item to the whole-cell grid', () => {
    expect(snapAnchor(plainItem, 7.3, 5.6)).toEqual({ x: 7, y: 6 });
  });
});

describe('buildObjectOccupancy: a half anchor aligns exactly with the terrain grid', () => {
  it('occupies exactly the terrain cells under a half-anchored footprint, none beyond it', () => {
    const state = makeState();
    state.objects.set('slab', {
      // Self-described footprint (width/height) — occupancy reads the rect, not any trait.
      id: 'slab', catalogId: 'road-dirt',
      position: { x: 7.5, y: 5 }, width: 2, height: 1, rotation: 0, elevation: 0,
    });
    const occ = buildObjectOccupancy(state);
    expect(occ.has('8,5')).toBe(true);
    expect(occ.has('9,5')).toBe(true);
    expect(occ.has('7,5')).toBe(false); // half-anchor lines up on the terrain boundary — no bleed
    expect(occ.has('10,5')).toBe(false);
  });
});
