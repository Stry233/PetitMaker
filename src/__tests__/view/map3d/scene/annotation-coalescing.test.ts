import { expect, it, vi } from 'vitest';
import { MapRenderer3D } from '../../../../view/map3d/scene/map-renderer';

it('coalesces annotation changes until the next visible frame or capture', () => {
  const state = {};
  const scene = {
    pendingAnnotations: null,
    annotationsTerrainDirty: null as Set<string> | 'all' | null,
    annotationLayer: { update: vi.fn(), refresh: vi.fn() },
    meshState: () => state,
    requestRender: vi.fn(),
  };
  const opts = { draft: null, selectionIds: [], tagLabel: () => 'label' };
  for (let i = 0; i < 100; i++) MapRenderer3D.prototype.setAnnotations.call(scene as never, null, opts);
  expect(scene.annotationLayer.update).not.toHaveBeenCalled();
  scene.annotationsTerrainDirty = 'all';
  const flush = (MapRenderer3D.prototype as unknown as { flushAnnotations(): void }).flushAnnotations;
  flush.call(scene);
  expect(scene.annotationLayer.update).toHaveBeenCalledOnce();
  expect(scene.annotationLayer.update).toHaveBeenCalledWith(state, null, opts);
  expect(scene.annotationLayer.refresh).not.toHaveBeenCalled();
  flush.call(scene);
  expect(scene.annotationLayer.update).toHaveBeenCalledOnce();
  scene.annotationsTerrainDirty = new Set(['0,0']);
  flush.call(scene);
  expect(scene.annotationLayer.refresh).toHaveBeenCalledOnce();
  expect(scene.annotationLayer.refresh, 'only the remeshed chunks re-drape').toHaveBeenCalledWith(state, new Set(['0,0']));
  scene.annotationsTerrainDirty = 'all';
  flush.call(scene);
  expect(scene.annotationLayer.refresh, 'a rebake re-drapes everything').toHaveBeenLastCalledWith(state, undefined);
});
