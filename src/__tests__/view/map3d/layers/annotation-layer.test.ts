// @vitest-environment jsdom
/**
 * The plan-notes layer in 3D, headless: every note kind builds its draped geometry, billboards
 * stand as sprites, the eye hides the group, and a refresh re-drapes the same ask over ground
 * that moved — heights are baked into the vertices, so this is what keeps a note on a hill that
 * just grew under it.
 */
import '../../../_support/pixi-env';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { AnnotationLayer3D } from '../../../../view/map3d/layers/annotation-layer';
import { makeState, setTerrain } from '../../../_support/map-state';
import { TerrainType } from '../../../../core/model/types';
import type { AnnotationsState } from '../../../../core/model/annotations';

const data = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }], color: '#FF8A7A', tag: 'homes', num: 1 },
    { kind: 'chip', id: 't1', x: 5, y: 5, tag: 'plaza', size: 'm', color: '#FFB347' },
    { kind: 'route', id: 'r1', points: [{ x: 1, y: 6 }, { x: 4, y: 6 }, { x: 6, y: 3 }], color: '#2FBF9B', dashed: true },
  ],
  visible: true,
  locked: false,
});

const kinds = (a: AnnotationLayer3D) => a.group.children.map((o) => o.type).sort();
const OPTS = { draft: null, tagLabel: (tag: string) => tag };

describe('AnnotationLayer3D', () => {
  it('builds every part as a MESH: WebGL draws a THREE.Line at one pixel whatever is asked', () => {
    const a = new AnnotationLayer3D();
    a.update(makeState(12, 12), data(), OPTS);
    const t = kinds(a);
    expect(t).toContain('Sprite');
    // Zone wash + outline ribbon, route halo + ribbon + head: drawn widths, no hairlines.
    expect(t.filter((k) => k === 'Mesh').length).toBeGreaterThanOrEqual(5);
    expect(t).not.toContain('Line');
    expect(t).not.toContain('LineSegments');
    expect(a.group.visible).toBe(true);
    a.dispose();
  });

  it('the eye hides the group whole', () => {
    const a = new AnnotationLayer3D();
    a.update(makeState(12, 12), { ...data(), visible: false }, OPTS);
    expect(a.group.visible).toBe(false);
    expect(a.group.children).toHaveLength(0);
    a.dispose();
  });

  it('refresh re-drapes the last ask over new heights', () => {
    const a = new AnnotationLayer3D();
    const state = makeState(12, 12);
    const d: AnnotationsState = { items: [data().items[2]!], visible: true, locked: false };
    a.update(state, d, OPTS);
    const ribbon = a.group.children.find((o): o is THREE.Mesh => o.type === 'Mesh')!;
    const before = (ribbon.geometry.getAttribute('position') as THREE.BufferAttribute).getY(0);
    for (let x = 0; x <= 6; x++) for (let y = 2; y <= 7; y++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    a.refresh(state);
    const after = a.group.children.find((o): o is THREE.Mesh => o.type === 'Mesh')!;
    const lifted = (after.geometry.getAttribute('position') as THREE.BufferAttribute).getY(0);
    expect(lifted).toBeGreaterThan(before);
    a.dispose();
  });

  it('rebuilding does not dispose the sprites\' shared quad', () => {
    const a = new AnnotationLayer3D();
    const state = makeState(12, 12);
    a.update(state, data(), OPTS);
    a.update(state, data(), OPTS);
    const sprite = a.group.children.find((o): o is THREE.Sprite => o.type === 'Sprite')!;
    expect(sprite.geometry.getAttribute('position')).toBeTruthy();
    a.dispose();
  });

  it('a selected note wears its mark: more meshes stand than for the same note unselected', () => {
    const a = new AnnotationLayer3D();
    const state = makeState(12, 12);
    a.update(state, data(), OPTS);
    const bare = a.group.children.length;
    a.update(state, data(), { ...OPTS, selectionIds: ['z1', 't1', 'r1'] });
    expect(a.group.children.length).toBeGreaterThan(bare);
    a.dispose();
  });
});

it('renders dimensions with ribbons and a map-plane number and disposes their geometry', () => {
  const layer = new AnnotationLayer3D();
  layer.update(makeState(100, 100), { items: [{ kind: 'measure', id: 'm', color: '#FFB347', points: [{ x: 1, y: 4 }, { x: 84, y: 4 }] }], visible: true, locked: false }, OPTS);
  expect(kinds(layer).filter(kind => kind === 'Sprite')).toHaveLength(0);
  const meshes = layer.group.children.filter((node): node is THREE.Mesh => node.type === 'Mesh');
  // Guides and lines each as the annotation line over its halo, and the number.
  expect(meshes).toHaveLength(5);
  const label = meshes.find(mesh => mesh.geometry.type === 'PlaneGeometry')!;
  const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(label.quaternion);
  expect(normal.y).toBeCloseTo(1);
  expect(normal.z).toBeCloseTo(0);
  for (const mesh of meshes) expect((mesh.material as THREE.Material).depthTest).toBe(true);
  for (const mesh of meshes) expect(Array.from(mesh.geometry.getAttribute('position').array).every(Number.isFinite)).toBe(true);
  let disposed = 0;
  for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => { disposed++; });
  layer.dispose();
  expect(disposed).toBe(meshes.length);
});

it('picks the visible chip quad and keeps its selection on that quad while the camera moves', () => {
  const layer = new AnnotationLayer3D();
  const state = makeState(20, 20);
  const chip = { kind: 'chip', id: 'tag', x: 10, y: 10, tag: 'homes', size: 'l', color: '#FFB347' } as const;
  const notes: AnnotationsState = { items: [chip], visible: true, locked: false };
  const rect = { left: 80, top: 25, width: 1000, height: 700 };
  const camera = new THREE.PerspectiveCamera(45, rect.width / rect.height, 0.1, 1000);
  layer.update(state, notes, OPTS);
  const original = layer.group.children.find((node): node is THREE.Sprite => node.type === 'Sprite')!;
  for (const [x, y, z] of [[20, 10, 20], [-25, 15, 10], [3, 35, -20]]) {
    camera.position.set(x!, y!, z!); camera.lookAt(original.position); camera.updateMatrixWorld(true);
    layer.group.updateMatrixWorld(true);
    const box = layer.labelBox('tag', camera, rect)!;
    for (const u of [0.15, 0.5, 0.85]) for (const v of [0.2, 0.5, 0.8]) {
      const px = box.x + box.w * u, py = box.y + box.h * v;
      const ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((px - rect.left) / rect.width * 2 - 1, 1 - (py - rect.top) / rect.height * 2), camera);
      expect(ray.intersectObject(original)).toHaveLength(1);
      expect(layer.pickLabel(px, py, camera, rect)).toBe('tag');
    }
    expect(layer.pickLabel(box.x + box.w / 2, box.y + box.h + 5, camera, rect)).toBeNull();
  }
  const before = layer.labelBox('tag', camera, rect);
  layer.update(state, notes, { ...OPTS, selectionIds: ['tag'] });
  expect(layer.group.children.map(node => node.type)).toEqual(['Sprite']);
  const selected = layer.group.children[0] as THREE.Sprite;
  expect(selected.material.map).not.toBe(original.material.map);
  expect(layer.labelBox('tag', camera, rect)).toEqual(before);
  layer.update(state, { ...notes, visible: false }, OPTS);
  expect(layer.labelBox('tag', camera, rect)).toBeNull();
  expect(layer.pickLabel(500, 350, camera, rect)).toBeNull();
  layer.dispose();
});

it('omits a selected zone width and height when dimensions are hidden', () => {
  const layer = new AnnotationLayer3D();
  const state = makeState(20, 20);
  const notes: AnnotationsState = { items: [{ kind: 'zone', id: 'z', color: '#FFB347', cells: [{ x: 2, y: 2 }, { x: 6, y: 4 }], tag: null, num: 0 }], visible: true, locked: false };
  const planes = () => layer.group.children.filter((node): node is THREE.Mesh => node.type === 'Mesh' && (node as THREE.Mesh).geometry.type === 'PlaneGeometry');
  layer.update(state, notes, { ...OPTS, selectionIds: ['z'] });
  expect(planes()).toHaveLength(2);
  layer.update(state, notes, { ...OPTS, selectionIds: ['z'], zoneDimensions: false });
  expect(planes()).toHaveLength(0);
  layer.dispose();
});

it('re-drapes only the notes over a remeshed chunk, into the parts already standing, as a whole rebuild would', () => {
  const state = makeState(48, 48);
  const notes: AnnotationsState = {
    items: [
      { kind: 'zone', id: 'near', cells: [{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 4, y: 4 }], color: '#FF8A7A', tag: 'homes', num: 1 },
      { kind: 'route', id: 'path', points: [{ x: 2, y: 8 }, { x: 9, y: 8 }], color: '#2FBF9B', dashed: true },
      { kind: 'zone', id: 'far', cells: [{ x: 40, y: 40 }, { x: 41, y: 40 }], color: '#FFB347', tag: null, num: 0 },
    ],
    visible: true, locked: false,
  };
  const opts = { ...OPTS, selectionIds: ['path'] };
  const layer = new AnnotationLayer3D();
  layer.update(state, notes, opts);
  const standing = [...layer.group.children];
  const geometries = standing.map((o) => (o as THREE.Mesh).geometry);
  for (let x = 2; x <= 6; x++) for (let y = 2; y <= 9; y++) setTerrain(state, x, y, TerrainType.Mountain, 2);
  layer.refresh(state, new Set(['0,0']));

  const whole = new AnnotationLayer3D();
  whole.update(state, notes, opts);
  const positions = (o: THREE.Object3D) => (o.type === 'Sprite' ? [] : Array.from((o as THREE.Mesh).geometry.getAttribute('position').array));
  expect(layer.group.children, 'the same objects stand, so draw ties keep their order').toEqual(standing);
  expect(layer.group.children.map(positions)).toEqual(whole.group.children.map(positions));
  expect(layer.group.children.map((o) => o.position.toArray())).toEqual(whole.group.children.map((o) => o.position.toArray()));
  const kept = layer.group.children.filter((o, i) => (o as THREE.Mesh).geometry === geometries[i] && o.type !== 'Sprite');
  expect(kept.length, 'the far zone was left alone').toBeGreaterThan(0);
  expect(kept.every((o) => positions(o).every((v, i) => i % 3 !== 0 || v > 10)), 'and only the far zone').toBe(true);
  layer.dispose();
  whole.dispose();
});
