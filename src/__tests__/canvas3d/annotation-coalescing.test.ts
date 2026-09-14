import { expect, it, vi } from 'vitest';
import { ThreeScene } from '../../canvas/map3d/scene/scene';

it('coalesces annotation changes until the next visible frame or capture', () => {
  const state = {};
  const scene = {
    pendingAnnotations: null,
    annotationsTerrainDirty: false,
    annotations3d: { update: vi.fn(), refresh: vi.fn() },
    meshState: () => state,
    requestRender: vi.fn(),
  };
  const opts = { draft: null, selection: [], tagLabel: () => 'label' };
  for (let i = 0; i < 100; i++) ThreeScene.prototype.setAnnotations.call(scene as never, null, opts);
  expect(scene.annotations3d.update).not.toHaveBeenCalled();
  scene.annotationsTerrainDirty = true;
  const flush = (ThreeScene.prototype as unknown as { flushAnnotations(): void }).flushAnnotations;
  flush.call(scene);
  expect(scene.annotations3d.update).toHaveBeenCalledOnce();
  expect(scene.annotations3d.update).toHaveBeenCalledWith(state, null, opts);
  expect(scene.annotations3d.refresh).not.toHaveBeenCalled();
  flush.call(scene);
  expect(scene.annotations3d.update).toHaveBeenCalledOnce();
  scene.annotationsTerrainDirty = true;
  flush.call(scene);
  expect(scene.annotations3d.refresh).toHaveBeenCalledOnce();
  expect(scene.annotations3d.refresh).toHaveBeenCalledWith(state);
});
