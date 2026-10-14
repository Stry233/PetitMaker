// @vitest-environment jsdom
/** `MapRenderer3D` over a stand-in renderer that draws nothing; the scene's own bookkeeping (terrain and object meshes, event wiring, teardown) is real. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { EventBus } from '../../../../core/commands/event-bus';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import { TerrainType, type PlacedObject } from '../../../../core/model/types';
import { type EditorEvents } from '../../../../state/editing/events';
import { makeState, setTerrain } from '../../../_support/map-state';
import { stubCanvasContext } from '../../../_support/canvas-context';
import { anyContext } from '../../../_support/three-stand-in';
import { cellSet } from '../../../../core/grid/grids';
import { TERRAIN_GRID } from '../../../../core/game/profile';

vi.mock('three', async (importOriginal) =>
  (await import('../../../_support/three-stand-in')).withStandInRenderer(await importOriginal()));

afterEach(() => { vi.restoreAllMocks(); });

async function scene() {
  stubCanvasContext(anyContext());
  const { MapRenderer3D } = await import('../../../../view/map3d/scene/map-renderer');
  const state = makeState(20, 20);
  for (let x = 4; x < 8; x++) setTerrain(state, x, 6, TerrainType.Mountain, 2);
  const tree: PlacedObject = { id: 'tree', catalogId: 'tree-apple', position: { x: 12, y: 12 }, rotation: 0, elevation: 0 };
  state.objects.set(tree.id, tree);
  bumpObjectsVersion(state, { added: [tree] });
  const bus = new EventBus<EditorEvents>();
  const container = document.createElement('div');
  const three = new MapRenderer3D(container, state, bus);
  return { three, state, bus, container, tree };
}

describe('the 3D scene over a stand-in renderer', () => {
  it('mounts its canvas and builds the map it was given', async () => {
    const { three, container, tree } = await scene();
    expect(container.querySelector('canvas')).not.toBeNull();
    const box = three.objectBoundingBox(tree.id);
    expect(box).toBeInstanceOf(THREE.Box3);
    expect(box!.isEmpty()).toBe(false);
    three.destroy();
  });

  it('mirrors objects added and removed while it runs', async () => {
    const { three, bus, state, tree } = await scene();
    three.resume();
    const flower: PlacedObject = { id: 'flower', catalogId: 'flower-protea', position: { x: 3, y: 15 }, rotation: 0, elevation: 0 };
    state.objects.set(flower.id, flower);
    bus.emit('objects-changed', { added: [flower] });
    expect(three.objectBoundingBox(flower.id)).not.toBeNull();
    state.objects.delete(tree.id);
    bus.emit('objects-changed', { removed: [tree.id] });
    expect(three.objectBoundingBox(tree.id)).toBeNull();
    three.destroy();
  });

  it('a paused scene catches up with the map once on resume', async () => {
    const { three, bus, state, tree } = await scene();
    three.pause();
    state.objects.delete(tree.id);
    bus.emit('objects-changed', { removed: [tree.id] });
    three.resume();
    expect(three.objectBoundingBox(tree.id)).toBeNull();
    three.destroy();
  });

  it('dispose takes its canvas away and stops listening to the map', async () => {
    const { three, bus, container, state } = await scene();
    three.destroy();
    expect(container.querySelector('canvas')).toBeNull();
    const ghost: PlacedObject = { id: 'late', catalogId: 'tree-apple', position: { x: 2, y: 2 }, rotation: 0, elevation: 0 };
    state.objects.set(ghost.id, ghost);
    expect(() => {
      bus.emit('objects-changed', { added: [ghost] });
      bus.emit('cells-changed', { cells: [cellSet(TERRAIN_GRID, [{ x: 4, y: 6 }])] });
    }).not.toThrow();
    expect(three.objectBoundingBox(ghost.id)).toBeNull();
  });

  it('disposing a second scene leaves the shared model geometry the first still draws with', async () => {
    const { modelGeometry } = await import('../../../../view/map3d/models/build-model');
    const { archetypeGeometry } = await import('../../../../view/map3d/models/object-archetypes');
    const live = await scene();
    const model = modelGeometry('tree-apple')!;
    const archetype = archetypeGeometry('platform');
    const freed = vi.fn();
    model.addEventListener('dispose', freed);
    archetype.addEventListener('dispose', freed);
    const still = await scene();
    still.three.destroy();
    expect(freed).not.toHaveBeenCalled();
    expect(modelGeometry('tree-apple')).toBe(model);
    expect(archetypeGeometry('platform')).toBe(archetype);
    live.three.destroy();
    expect(freed).toHaveBeenCalledTimes(2);
  });
});
