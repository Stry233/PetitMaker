import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.doUnmock('../../canvas/map3d/core/coords');
  vi.resetModules();
});

async function dimensions(layerHeight: number) {
  vi.resetModules();
  vi.doMock('../../canvas/map3d/core/coords', async (importOriginal) => ({
    ...await importOriginal<typeof import('../../canvas/map3d/core/coords')>(),
    LAYER_HEIGHT: layerHeight,
  }));
  const { modeledIds, getSpec } = await import('../../canvas/map3d/models/registry');
  const { modelGeometry, disposeModels } = await import('../../canvas/map3d/models/build-model');
  const { archetypeGeometry, ARCHETYPE_KEYS, disposeArchetypes } = await import('../../canvas/map3d/build/object-archetypes');
  const result = new Map<string, { x: number; y: number; z: number; uniform: boolean; calibrated: boolean }>();
  for (const id of modeledIds()) {
    const spec = getSpec(id)!;
    const bounds = modelGeometry(id)!.boundingBox!;
    result.set(id, { x: bounds.max.x - bounds.min.x, y: bounds.max.y, z: bounds.max.z - bounds.min.z,
      uniform: spec.heightInLayers !== undefined && !spec.fitToFootprint && spec.heightScale !== 'vertical',
      calibrated: spec.heightInLayers !== undefined });
  }
  for (const key of ARCHETYPE_KEYS) {
    const geometry = archetypeGeometry(key);
    geometry.computeBoundingBox();
    const bounds = geometry.boundingBox!;
    result.set(`archetype:${key}`, { x: bounds.max.x - bounds.min.x, y: bounds.max.y - bounds.min.y,
      z: bounds.max.z - bounds.min.z, uniform: false, calibrated: !['ramp', 'platform', 'road'].includes(key) });
  }
  disposeModels();
  disposeArchetypes();
  return result;
}

it('propagates the terrain height to every calibrated catalog model and category fallback exactly once', async () => {
  const original = await dimensions(1.25);
  const adjusted = await dimensions(0.8);
  const ratio = 0.8 / 1.25;
  expect(adjusted.size).toBe(original.size);
  for (const [id, before] of original) {
    const after = adjusted.get(id)!;
    expect(after.y, id).toBeCloseTo(before.y * (before.calibrated ? ratio : 1));
    expect(after.x, id).toBeCloseTo(before.x * (before.uniform ? ratio : 1));
    expect(after.z, id).toBeCloseTo(before.z * (before.uniform ? ratio : 1));
  }
});
