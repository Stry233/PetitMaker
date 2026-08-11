import { describe, it, expect } from 'vitest';
import { buildObjectInstances } from '../../canvas/map3d/build/object-meshes';
import { GROUND_SLAB_Y, LAYER_HEIGHT } from '../../canvas/map3d/core/coords';
import { registerCatalogItem } from '../../state/catalog';
import { ItemCategory, CellZone, TerrainType } from '../../core/model/types';
import type { GridState, MapTemplate, PlacedObject } from '../../core/model/types';

function emptyGrid(w: number, h: number, objects: PlacedObject[]): GridState {
  const template: MapTemplate = {
    id: 't', name: { en: 't' }, width: w, height: h,
    zones: Array.from({ length: h }, () => Array.from({ length: w }, () => CellZone.Grass)),
    plaza: { x: 0, y: 0, width: 0, height: 0, elevation: 0 },
  };
  const cells = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ zone: CellZone.Grass, terrain: null })));
  const map = new Map<string, PlacedObject>();
  for (const o of objects) map.set(o.id, o);
  return { template, cells, objects: map, lockedLayers: new Set() };
}

describe('preview3d/object-meshes', () => {
  it('groups objects under their catalog category archetype', () => {
    registerCatalogItem({ id: 'oak', category: ItemCategory.Tree, name: { en: 'Oak' }, width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point', traits: [] });
    const obj: PlacedObject = { id: 'a', catalogId: 'oak', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    const groups = buildObjectInstances(emptyGrid(8, 8, [obj]));
    expect(groups.get('a:' + ItemCategory.Tree)!.length).toBe(1);
  });

  it('an item with a bespoke 3D model groups under m:<catalogId> at scale 1', () => {
    // building-stall has a model3d in the catalog (a real catalog item).
    const obj: PlacedObject = { id: 's', catalogId: 'building-stall', position: { x: 3, y: 3 }, rotation: 0, elevation: 0 };
    const groups = buildObjectInstances(emptyGrid(8, 8, [obj]));
    const inst = groups.get('m:building-stall')![0]!;
    expect(inst.scaleX).toBe(1); // model is authored at the item's footprint, not scaled
    expect(inst.scaleZ).toBe(1);
  });

  it('off-catalog self-described objects (plaza) use the platform archetype', () => {
    const plaza: PlacedObject = { id: '__plaza__', catalogId: '__plaza__', position: { x: 1, y: 1 }, rotation: 0, elevation: 1, width: 3, height: 2, color: '#e2e8f0', locked: true };
    const groups = buildObjectInstances(emptyGrid(8, 8, [plaza]));
    expect(groups.get('a:platform')!.length).toBe(1);
    const inst = groups.get('a:platform')![0]!;
    expect(inst.scaleX).toBeCloseTo(3);
    expect(inst.scaleZ).toBeCloseTo(2);
    expect(inst.y).toBe(0); // rests on the ground despite elevation: 1
  });

  it('a 90°-rotated 2×1 object orients via rotationY but keeps unrotated scale', () => {
    registerCatalogItem({ id: 'hall', category: ItemCategory.Building, name: { en: 'Hall' }, width: 2, height: 1, loadValue: 0, rotatable: true, placementMode: 'point', traits: [] });
    const obj: PlacedObject = { id: 'b', catalogId: 'hall', position: { x: 0, y: 0 }, rotation: 90, elevation: 0 };
    const inst = buildObjectInstances(emptyGrid(8, 8, [obj])).get('a:' + ItemCategory.Building)![0]!;
    expect(inst.scaleX).toBeCloseTo(2);  // unrotated width
    expect(inst.scaleZ).toBeCloseTo(1);  // unrotated height
    // Yaw = 2D-rotation + π (models front their door on −Z, but 2D fronts rot 0 south).
    expect(inst.rotationY).toBeCloseTo(Math.PI / 2);
  });

  it('a ramp sits at the LOW elevation (n−drop) and spans up one layer, facing the right way', () => {
    registerCatalogItem({ id: 'ramp1', category: ItemCategory.Ramp, name: { en: 'Ramp' }, width: 1, height: 2, loadValue: 0, rotatable: true, placementMode: 'point', traits: [{ type: 'heightDrop', layers: 1 }] });
    const obj: PlacedObject = { id: 'rp', catalogId: 'ramp1', position: { x: 0, y: 0 }, rotation: 0, elevation: 2 };
    const inst = buildObjectInstances(emptyGrid(8, 8, [obj])).get('a:' + ItemCategory.Ramp)![0]!;
    expect(inst.y + inst.scaleY).toBeCloseTo(LAYER_HEIGHT * 2); // high end lands exactly at layer n=2
    expect(inst.y).toBeLessThan(LAYER_HEIGHT * 1);              // low tip tucked just below layer n−1=1 (a road meeting it sits on top)
    expect(inst.y).toBeGreaterThan(LAYER_HEIGHT * 1 - 0.2);     // …only slightly
    expect(inst.rotationY).toBeCloseTo(Math.PI);                // rot 0 → high end faces the −Z (start) side
  });
});

describe('ground-level placement sits on the visible surface', () => {
  it('an elevation-0 object stands on the ground slab, not buried inside it', () => {
    // The land slab tops at GROUND_SLAB_Y; an object based at raw layer 0 sinks a
    // third of a flower into it, and the buried faces depth-fight the slab plane
    // (small models shimmer at viewing distance). Elevated terrain has no slab —
    // its surface IS layerToY(e) — so only layer 0 carries the offset.
    const flora: PlacedObject = {
      id: 'f', catalogId: 'flower-bellflower', position: { x: 3, y: 3 },
      rotation: 0, elevation: 0,
    };
    const groups = buildObjectInstances(emptyGrid(10, 10, [flora]));
    const inst = [...groups.values()].flat()[0]!;
    expect(inst.y).toBeCloseTo(GROUND_SLAB_Y, 6);
  });

  it('an elevated object still sits flush on its terrain top', () => {
    const flora: PlacedObject = {
      id: 'f', catalogId: 'flower-bellflower', position: { x: 3, y: 3 },
      rotation: 0, elevation: 2,
    };
    // The TERRAIN puts it up there. A body that sits on the ground is drawn at the ground, so a
    // fixture that raised only the stored number would be asserting the stale-elevation bug.
    const grid = emptyGrid(10, 10, [flora]);
    grid.cells[3]![3]!.terrain = { type: TerrainType.Mountain, elevation: 2, corners: ['square', 'square', 'square', 'square'] };
    const groups = buildObjectInstances(grid);
    const inst = [...groups.values()].flat()[0]!;
    expect(inst.y).toBeCloseTo(LAYER_HEIGHT * 2, 6);
  });
});
