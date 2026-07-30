import { describe, it, expect } from 'vitest';
import { archetypeGeometry, ARCHETYPE_KEYS } from '../../canvas/map3d/build/object-archetypes';
import { ItemCategory } from '../../core/model/types';

describe('preview3d/object-archetypes', () => {
  it('builds a non-empty geometry for every archetype key', () => {
    for (const key of ARCHETYPE_KEYS) {
      const g = archetypeGeometry(key);
      expect(g.getAttribute('position').count).toBeGreaterThan(0);
    }
  });

  it('caches: the same key returns the identical geometry instance', () => {
    expect(archetypeGeometry(ItemCategory.Tree)).toBe(archetypeGeometry(ItemCategory.Tree));
  });

  it('archetypes sit on the ground (min y ≈ 0) and stay within the unit cell footprint', () => {
    for (const key of ARCHETYPE_KEYS) {
      const g = archetypeGeometry(key);
      g.computeBoundingBox();
      const bb = g.boundingBox!;
      expect(bb.min.y).toBeGreaterThanOrEqual(-0.001);
      expect(bb.max.x).toBeLessThanOrEqual(0.6);
      expect(bb.min.x).toBeGreaterThanOrEqual(-0.6);
    }
  });
});
