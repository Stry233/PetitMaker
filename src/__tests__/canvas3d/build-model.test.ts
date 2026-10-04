import { describe, it, expect } from 'vitest';
import { buildModel, modelGeometry } from '../../canvas/map3d/models/build-model';
import { modeledIds, getSpec } from '../../canvas/map3d/models/registry';
import type { ModelSpec } from '../../core/model/model-spec';
import { LAYER_HEIGHT } from '../../canvas/map3d/core/coords';
import { getCatalogItem } from '../../state/catalog';

describe('preview3d/models/build-model', () => {
  it('transforms authored surfaces and calibrates them through the same model path as primitives', () => {
    const g = buildModel({ heightInLayers: 2, parts: [{
      shape: 'mesh', size: [2, 4, 6], pos: [0, 3, 0], rotY: 90, color: '#ffffff',
      mesh: {
        vertices: [[-.5, 0, -.5], [.5, 0, -.5], [0, 0, .5], [0, 1, 0]],
        triangles: [[0, 1, 2], [0, 3, 1], [1, 3, 2], [2, 3, 0]],
      },
    }] });
    expect(g.getAttribute('position').count).toBe(12);
    expect(g.boundingBox!.min.y).toBeCloseTo(0);
    expect(g.boundingBox!.max.y).toBeCloseTo(2 * LAYER_HEIGHT);
    expect(g.boundingBox!.max.x - g.boundingBox!.min.x).toBeCloseTo(3 * LAYER_HEIGHT);
    expect(g.boundingBox!.max.z - g.boundingBox!.min.z).toBeCloseTo(LAYER_HEIGHT);
    const normals = g.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
      expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i))).toBeCloseTo(1);
    }
    g.dispose();
  });

  it('rejects an authored surface without geometry', () => {
    expect(() => buildModel({ parts: [{ shape: 'mesh', size: [1, 1, 1], pos: [0, 0, 0], color: '#ffffff' }] }))
      .toThrow('requires vertices and triangles');
  });

  it('authored catalog surfaces have valid indices and non-degenerate faces', () => {
    for (const id of modeledIds()) {
      for (const part of getSpec(id)!.parts.filter(part => part.shape === 'mesh')) {
        for (const triangle of part.mesh!.triangles) {
          expect(triangle.every(index => Number.isInteger(index) && index >= 0 && index < part.mesh!.vertices.length), id).toBe(true);
        }
        const g = buildModel({ parts: [part] });
        const normals = g.getAttribute('normal');
        for (let i = 0; i < normals.count; i++) {
          expect(Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i)), id).toBeCloseTo(1);
        }
        g.dispose();
      }
    }
  });

  it.each(['leaf', 'petal'] as const)('%s blades have closed, non-degenerate faces on both sides', (shape) => {
    const g = buildModel({ parts: [{ shape, size: [1, 1, 1], pos: [0, 0, 0], color: '#ffffff' }] });
    const normals = g.getAttribute('normal');
    let front = false, back = false;
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      expect(length).toBeCloseTo(1);
      front ||= normals.getZ(i) > 0;
      back ||= normals.getZ(i) < 0;
    }
    expect(front && back).toBe(true);
    expect(g.boundingBox!.max.y).toBeCloseTo(1);
    g.dispose();
  });

  it('calibrates the complete silhouette to terrain layers without distorting its proportions', () => {
    const g = buildModel({
      heightInLayers: 2,
      parts: [{ shape: 'box', size: [4, 2, 3], pos: [0, 5, 0], color: '#ffffff' }],
    });
    const bounds = g.boundingBox!;
    expect(bounds.min.y).toBeCloseTo(0);
    expect(bounds.max.y).toBeCloseTo(2 * LAYER_HEIGHT);
    expect(bounds.max.x - bounds.min.x).toBeCloseTo(4 * LAYER_HEIGHT);
    expect(bounds.max.z - bounds.min.z).toBeCloseTo(3 * LAYER_HEIGHT);
    g.dispose();
  });

  it('keeps a declared bank plane at zero while calibrating the structure beneath it', () => {
    const geometry = buildModel({ groundY: 3, heightInLayers: 2, heightScale: 'vertical',
      parts: [{ shape: 'box', size: [1, 4, 1], pos: [0, 2, 0], color: '#ffffff' }],
    });
    expect(geometry.boundingBox!.min.y).toBeCloseTo(-0.5 * LAYER_HEIGHT);
    expect(geometry.boundingBox!.max.y).toBeCloseTo(1.5 * LAYER_HEIGHT);
    geometry.dispose();
  });

  it('calibrates height while preserving authored span dimensions and horizontal offsets', () => {
    const g = buildModel({
      heightInLayers: 2, heightScale: 'vertical',
      parts: [{ shape: 'box', size: [4, 3, 2], pos: [2, 5, -1], color: '#ffffff' }],
    });
    expect(g.boundingBox!.min.toArray()).toEqual([0, 0, -2]);
    expect(g.boundingBox!.max.x).toBeCloseTo(4);
    expect(g.boundingBox!.max.z).toBeCloseTo(0);
    expect(g.boundingBox!.max.y).toBeCloseTo(2 * LAYER_HEIGHT);
    g.dispose();
  });

  it.each([4, 6, 9])('fills an explicitly fitted %s-cell footprint without changing its terrain-relative height', (width) => {
    const g = buildModel({ fitToFootprint: true, heightInLayers: 3.2,
      parts: [{ shape: 'box', size: [4, 3, 3], pos: [2, 5, -1], color: '#ffffff' }],
    }, { width, height: 4 });
    const bounds = g.boundingBox!;
    expect(bounds.min.toArray()).toEqual([-width / 2, 0, -2]);
    expect(bounds.max.x).toBeCloseTo(width / 2);
    expect(bounds.max.y).toBeCloseTo(3.2 * LAYER_HEIGHT);
    expect(bounds.max.z).toBeCloseTo(2);
    g.dispose();
  });

  it('rejects footprint fitting without a terrain-relative height', () => {
    expect(() => buildModel({ fitToFootprint: true, parts: [] }, { width: 6, height: 4 })).toThrow('terrain-layer height');
  });

  it.each([[6, 5, 4], [8, 3, 3]])('contains a round model in %s by %s cells with side clearance', (width, height, diameter) => {
    const g = buildModel({ fitToFootprint: { mode: 'contain', inset: [1, 0] }, heightInLayers: 3,
      parts: [{ shape: 'cylinder', size: [2, 4, 2], pos: [1, 2, -1], color: '#ffffff', seg: 12 }],
    }, { width, height });
    const bounds = g.boundingBox!;
    expect(bounds.min.toArray()).toEqual([-diameter / 2, 0, -diameter / 2]);
    expect(bounds.max.x).toBeCloseTo(diameter / 2);
    expect(bounds.max.z).toBeCloseTo(diameter / 2);
    expect(bounds.max.y).toBeCloseTo(3 * LAYER_HEIGHT);
    g.dispose();
  });

  it.each([-1, 0, 1] as const)('aligns contained geometry at %s inside the reserved margins', (align) => {
    for (const [width, height] of [[6, 8], [8, 6]] as const) {
      const g = buildModel({ fitToFootprint: { mode: 'contain', inset: [1, 1], align: [align, align] }, heightInLayers: 3,
        parts: [{ shape: 'cylinder', size: [2, 4, 2], pos: [1, 2, -1], color: '#ffffff', seg: 12 }],
      }, { width, height });
      const bounds = g.boundingBox!;
      const offsetX = align * (width - 6) / 2;
      const offsetZ = align * (height - 6) / 2;
      expect(bounds.min.x).toBeCloseTo(-2 + offsetX);
      expect(bounds.max.x).toBeCloseTo(2 + offsetX);
      expect(bounds.min.z).toBeCloseTo(-2 + offsetZ);
      expect(bounds.max.z).toBeCloseTo(2 + offsetZ);
      expect(bounds.min.y).toBeCloseTo(0);
      expect(bounds.max.y).toBeCloseTo(3 * LAYER_HEIGHT);
      g.dispose();
    }
  });

  it('centres the pavilion radius within its footprint and uses the front half-cell for the entrance', () => {
    const item = getCatalogItem('facility-pavilion')!;
    const g = modelGeometry(item.id)!;
    const bounds = g.boundingBox!;
    expect(bounds.min.x).toBeCloseTo(-2);
    expect(bounds.max.x).toBeCloseTo(2);
    expect(bounds.min.z).toBeCloseTo(-item.height / 2);
    expect(bounds.max.z).toBeCloseTo(item.height / 2 - .5);
    const positions = g.getAttribute('position');
    const colors = g.getAttribute('color');
    const baseX: number[] = [], baseZ: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      if (positions.getY(i) > 1e-5) continue;
      if (colors.getX(i) !== colors.getX(0) || colors.getY(i) !== colors.getY(0) || colors.getZ(i) !== colors.getZ(0)) continue;
      baseX.push(positions.getX(i));
      baseZ.push(positions.getZ(i));
    }
    expect(Math.min(...baseX)).toBeCloseTo(-2);
    expect(Math.max(...baseX)).toBeCloseTo(2);
    expect(Math.min(...baseZ)).toBeCloseTo(-2);
    expect(Math.max(...baseZ)).toBeCloseTo(2);
    expect(Math.min(...baseZ) - bounds.min.z).toBeCloseTo(.5);
    const entranceX: number[] = [];
    for (let i = 0; i < positions.count; i++) {
      if (Math.abs(positions.getZ(i) - bounds.min.z) < 1e-5) entranceX.push(positions.getX(i));
    }
    expect(item.width / 2 + Math.min(...entranceX)).toBeCloseTo(1.75);
    expect(item.width / 2 - Math.max(...entranceX)).toBeCloseTo(1.75);
  });

  it('keeps the reference cottages below a mature fruit tree on the same terrain scale', () => {
    const tree = modelGeometry('tree-apple')!.boundingBox!.max.y;
    for (const id of ['building-myhouse', 'building-bamboo-cabin', 'building-boat-cabin']) {
      const height = modelGeometry(id)!.boundingBox!.max.y;
      expect(height / tree, id).toBeGreaterThan(0.65);
      expect(height / tree, id).toBeLessThan(1);
    }
  });

  it('leaves the game clearances around Yunguo’s five-cell house', () => {
    const item = getCatalogItem('building-bamboo-cabin')!;
    expect([item.width, item.height]).toEqual([5, 5]);
    const bounds = modelGeometry(item.id)!.boundingBox!;
    expect(item.width / 2 + bounds.min.x).toBeCloseTo(.5, 2);
    expect(item.width / 2 - bounds.max.x).toBeCloseTo(.5, 2);
    expect(item.height / 2 - bounds.max.z).toBeCloseTo(1, 2);
    const front = item.height / 2 + bounds.min.z;
    expect(front).toBeGreaterThan(.5);
    expect(front).toBeLessThan(1);
  });

  it('preserves house proportions independently of placement exclusion dimensions', () => {
    const houses = modeledIds().filter(id => id.startsWith('building-') && id !== 'building-stall');
    for (const id of houses) {
      const spec = getSpec(id)!;
      const item = getCatalogItem(id)!;
      expect(spec.fitToFootprint, id).toBeUndefined();
      expect(spec.heightScale, id).not.toBe('vertical');
      const raw = buildModel({ parts: spec.parts });
      const geometry = modelGeometry(id)!;
      const enlarged = buildModel(spec, { width: item.width + 4, height: item.height + 2 });
      const before = raw.boundingBox!, after = geometry.boundingBox!;
      const scale = after.max.y / before.max.y;
      for (const axis of ['x', 'z'] as const) {
        expect(after.min[axis], id).toBeCloseTo(before.min[axis] * scale);
        expect(after.max[axis], id).toBeCloseTo(before.max[axis] * scale);
      }
      expect(enlarged.boundingBox!.min.toArray(), id).toEqual(after.min.toArray());
      expect(enlarged.boundingBox!.max.toArray(), id).toEqual(after.max.toArray());
      raw.dispose();
      enlarged.dispose();
    }
  });

  it('leaves reserved space beside the stage-three player house while retaining its broad hipped roof', () => {
    const item = getCatalogItem('building-myhouse')!;
    const bounds = modelGeometry(item.id)!.boundingBox!;
    expect(bounds.min.x + item.width / 2).toBeGreaterThan(1);
    expect(item.width / 2 - bounds.max.x).toBeGreaterThan(1);
    expect(bounds.min.z + item.height / 2).toBeGreaterThan(0);
    expect(item.height / 2 - bounds.max.z).toBeGreaterThan(0);
    const frontAspect = (bounds.max.x - bounds.min.x) / bounds.max.y;
    expect(frontAspect).toBeGreaterThan(1.35);
    expect(frontAspect).toBeLessThan(1.6);
  });

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

  it('every catalog model3d spec builds into non-empty geometry aligned to its support plane', () => {
    const ids = modeledIds();
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const g = modelGeometry(id);
      expect(g, id).not.toBeNull();
      expect(g!.getAttribute('position').count, id).toBeGreaterThan(0);
      expect(g!.getAttribute('color'), id).toBeTruthy();
      expect([...g!.getAttribute('position').array].every(Number.isFinite), id).toBe(true);
      expect(getSpec(id)!.parts.every(part => part.size.every(value => value > 0)), id).toBe(true);
      expect(g!.getAttribute('position').count / 3, id).toBeLessThanOrEqual(3200);
      g!.computeBoundingBox();
      if (getSpec(id)!.groundY === undefined) expect(g!.boundingBox!.min.y, id).toBeCloseTo(0);
      else expect(g!.boundingBox!.min.y, id).toBeLessThanOrEqual(0);
      const heightInLayers = getSpec(id)!.heightInLayers;
      if (getCatalogItem(id)!.category !== 'ramp') expect(heightInLayers, id).toBeGreaterThan(0);
      if (getSpec(id)!.fitToFootprint) {
        const item = getCatalogItem(id)!;
        expect(heightInLayers, id).toBeGreaterThan(0);
        if (getSpec(id)!.fitToFootprint === true) {
          expect(g!.boundingBox!.max.x - g!.boundingBox!.min.x, id).toBeCloseTo(item.width);
          expect(g!.boundingBox!.max.z - g!.boundingBox!.min.z, id).toBeCloseTo(item.height);
        } else {
          expect(g!.boundingBox!.max.x - g!.boundingBox!.min.x, id).toBeLessThanOrEqual(item.width);
          expect(g!.boundingBox!.max.z - g!.boundingBox!.min.z, id).toBeLessThanOrEqual(item.height);
        }
      }
      if (heightInLayers !== undefined) {
        expect(heightInLayers, id).toBeGreaterThan(0);
        expect(g!.boundingBox!.max.y - g!.boundingBox!.min.y, id).toBeCloseTo(heightInLayers * LAYER_HEIGHT);
        if (id.startsWith('flower-') || id.startsWith('tree-')) {
          expect(g!.getAttribute('position').count / 3, id).toBeLessThanOrEqual(2200);
        }
      }
    }
  });
});
