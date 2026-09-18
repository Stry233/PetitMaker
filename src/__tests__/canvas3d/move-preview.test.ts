import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { Overlay3D } from '../../canvas/map3d/scene/overlay3d';
import { setReducedMotion } from '../../canvas/map2d/motion-state';
import { MoveOrigins3D } from '../../canvas/map3d/scene/move-origins';
import { ThreeScene } from '../../canvas/map3d/scene/scene';
import { InstanceSlots } from '../../canvas/map3d/build/instance-slots';
import { objectInstance } from '../../canvas/map3d/build/object-meshes';
import type { PlacedObject } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

const original: PlacedObject = { id: 'cabin', catalogId: 'building-fluorite-cabin', position: { x: 6, y: 8 }, rotation: 0, elevation: 0 };
const destination: PlacedObject = { ...original, position: { x: 10.5, y: 9 }, rotation: 90, elevation: 1 };
function fixture() {
  const state = makeState(24, 24);
  state.objects.set(original.id, original);
  return state;
}

beforeEach(() => setReducedMotion(true));
afterEach(() => setReducedMotion(false));

describe('3D object move preview', () => {
  it('keeps the original model outlined in white dashes and reuses it across pointer samples', () => {
    const state = fixture();
    const group = new THREE.Group();
    const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
    camera.position.set(15, 15, 15);
    camera.lookAt(0, 0, 0);
    const origins = new MoveOrigins3D(group, camera);
    origins.show(state, [original.id]);
    const line = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(line.material.color.getHex()).toBe(0xffffff);
    expect(line.material.depthWrite).toBe(false);
    expect(line.geometry.getAttribute('position').count).toBeGreaterThan(0);
    const fill = line.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(fill.geometry.getAttribute('position').count).toBeGreaterThan(0);
    expect(fill.material.opacity).toBeCloseTo(.14);
    const positions = Array.from(line.geometry.getAttribute('position').array);
    origins.show(state, [original.id]);
    expect(group.children).toEqual([line]);
    expect(Array.from(line.geometry.getAttribute('position').array)).toEqual(positions);
    camera.position.set(-15, 15, 15);
    camera.lookAt(0, 0, 0);
    origins.update();
    expect(Array.from(line.geometry.getAttribute('position').array)).not.toEqual(positions);
    const disposed = vi.spyOn(line.geometry, 'dispose');
    const fillDisposed = vi.spyOn(fill.geometry, 'dispose');
    const materialDisposed = vi.spyOn(fill.material, 'dispose');
    origins.clear();
    expect(group.children).toHaveLength(0);
    expect(disposed).toHaveBeenCalledOnce();
    expect(fillDisposed).toHaveBeenCalledOnce();
    expect(materialDisposed).toHaveBeenCalledOnce();
    origins.dispose();
  });

  it('fades both ways, reverses an interrupted fade, and settles immediately with reduced motion', () => {
    setReducedMotion(false);
    let now = 0;
    const group = new THREE.Group();
    const origins = new MoveOrigins3D(group, undefined, undefined, () => now);
    const state = fixture();
    origins.show(state, [original.id]);
    const mesh = group.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    const fill = mesh.children[0] as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(mesh.material.opacity).toBe(0);
    expect(fill.material.opacity).toBe(0);
    now = 80;
    expect(origins.tick()).toBe(true);
    expect(mesh.material.opacity).toBeCloseTo(.475);
    expect(fill.material.opacity).toBeCloseTo(.07);
    now = 160;
    expect(origins.tick()).toBe(false);
    expect(mesh.material.opacity).toBeCloseTo(.95);
    origins.clear();
    expect(group.children).toContain(mesh);
    now = 240;
    origins.tick();
    expect(mesh.material.opacity).toBeCloseTo(.475);
    expect(fill.material.opacity).toBeCloseTo(.07);
    origins.show(state, [original.id]);
    expect(group.children).toEqual([mesh]);
    expect(mesh.material.opacity).toBeCloseTo(.475);
    expect(fill.material.opacity).toBeCloseTo(.07);
    now = 320;
    origins.tick();
    expect(mesh.material.opacity).toBeCloseTo(.7125);
    origins.clear();
    setReducedMotion(true);
    expect(origins.tick()).toBe(false);
    expect(group.children).toHaveLength(0);
    origins.dispose();
  });

  it('replaces tinted placement ghosts during movement and restores the scene on clear', () => {
    const state = fixture();
    const move = vi.fn();
    const overlay = new Overlay3D(() => state, () => {}, undefined, undefined, move);
    overlay.showPlacementGhost(original.catalogId, 10, 9, 0, true, 0);
    const body = overlay.group.children.find(child => child.children.length > 0)!;
    overlay.showObjectMove([destination], true);
    expect(body.visible).toBe(false);
    expect(move).toHaveBeenLastCalledWith([destination]);
    expect(overlay.group.getObjectByName('move-origin-cabin')).toBeDefined();
    expect(state.objects.get(original.id)).toBe(original);
    overlay.clearGhost();
    expect(move).toHaveBeenLastCalledWith([]);
    expect(overlay.group.getObjectByName('move-origin-cabin')).toBeUndefined();
    overlay.dispose();
  });

  it('moves only the rendered instance and restores the latest committed position', () => {
    const state = fixture();
    const resolved = objectInstance(state, original)!;
    const slots = new InstanceSlots();
    slots.add(original.id, resolved.groupKey);
    const mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial(), 1);
    const group = { mesh, instances: [resolved.inst], isModel: true };
    const scene = Object.assign(Object.create(ThreeScene.prototype), {
      liveState: state, slots, groups: new Map([[resolved.groupKey, group]]),
      movePreviewIds: new Set(), hiddenLayers: new Set(), plops: new Map(), spins: new Map(),
      renderer: { shadowMap: { needsUpdate: false } }, requestRender: vi.fn(),
    }) as { previewObjectMove(objects: readonly PlacedObject[]): void };
    scene.previewObjectMove([destination]);
    const matrix = new THREE.Matrix4();
    mesh.getMatrixAt(0, matrix);
    const expected = objectInstance(state, destination)!.inst;
    expect(matrix.elements[12]).toBeCloseTo(expected.x);
    expect(matrix.elements[13]).toBeCloseTo(expected.y);
    expect(matrix.elements[14]).toBeCloseTo(expected.z);
    expect(state.objects.get(original.id)).toBe(original);
    expect(group.instances[0]).toBe(resolved.inst);
    scene.previewObjectMove([]);
    mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(resolved.inst.x);
    state.objects.set(original.id, destination);
    scene.previewObjectMove([destination]);
    scene.previewObjectMove([]);
    mesh.getMatrixAt(0, matrix);
    expect(matrix.elements[12]).toBeCloseTo(expected.x);
    mesh.geometry.dispose();
    (mesh.material as THREE.Material).dispose();
    mesh.dispose();
  });
});
