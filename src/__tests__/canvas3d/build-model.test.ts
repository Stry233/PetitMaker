import { describe, it, expect } from 'vitest';
import { buildModel, modelGeometry } from '../../canvas/map3d/models/build-model';
import { modeledIds } from '../../canvas/map3d/models/registry';
import type { ModelSpec } from '../../core/model/model-spec';

describe('preview3d/models/build-model', () => {
  it('builds a merged, ground-resting, vertex-coloured geometry from a spec', () => {
    const spec: ModelSpec = {
      parts: [
        { shape: 'box', size: [0.6, 0.5, 0.6], pos: [0, 0, 0], color: '#cccccc' },
        { shape: 'prism', size: [0.7, 0.3, 0.7], pos: [0, 0.5, 0], color: '#cc4433' },
      ],
    };
    const g = buildModel(spec);
    expect(g.getAttribute('position').count).toBeGreaterThan(0);
    expect(g.getAttribute('color')).toBeTruthy();          // colours baked in
    g.computeBoundingBox();
    expect(g.boundingBox!.min.y).toBeCloseTo(0);            // rests on the ground
    expect(g.boundingBox!.max.y).toBeCloseTo(0.8);          // 0.5 walls + 0.3 roof
  });

  it('resolves + caches the geometry for a catalog item that has a model', () => {
    const a = modelGeometry('building-stall');
    expect(a).not.toBeNull();
    expect(modelGeometry('building-stall')).toBe(a);        // cached identity
    expect(modelGeometry('totally-unmodeled-id')).toBeNull();
  });

  it('every catalog model3d spec builds into a non-empty, grounded geometry', () => {
    const ids = modeledIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const g = modelGeometry(id);
      expect(g, id).not.toBeNull();
      expect(g!.getAttribute('position').count, id).toBeGreaterThan(0);
      expect(g!.getAttribute('color'), id).toBeTruthy();
      g!.computeBoundingBox();
      expect(g!.boundingBox!.min.y, id).toBeCloseTo(0); // rests on the ground
    }
  });
});
