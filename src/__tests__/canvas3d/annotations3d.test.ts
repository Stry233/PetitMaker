/**
 * The plan-notes layer in 3D, headless: every note kind builds its draped geometry, billboards
 * stand as sprites, the eye hides the group, and a refresh re-drapes the same ask over ground
 * that moved — heights are baked into the vertices, so this is what keeps a note on a hill that
 * just grew under it.
 */
import '../canvas/_pixi-env';
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Annotations3D } from '../../canvas/map3d/scene/annotations3d';
import { makeState, setTerrain } from '../rules/_helpers';
import { TerrainType } from '../../core/model/types';
import type { AnnotationsState } from '../../core/model/annotations';

const data = (): AnnotationsState => ({
  items: [
    { kind: 'zone', id: 'z1', cells: [{ x: 2, y: 2 }, { x: 3, y: 2 }], color: '#FF8A7A', name: '住宅区', num: 1 },
    { kind: 'text', id: 't1', x: 5, y: 5, text: '广场', style: 'chip', size: 'm', color: '#FFB347' },
    { kind: 'route', id: 'r1', points: [{ x: 1, y: 6 }, { x: 4, y: 6 }, { x: 6, y: 3 }], color: '#2FBF9B', dashed: true },
  ],
  visible: true,
  locked: false,
});

const kinds = (a: Annotations3D) => a.group.children.map((o) => o.type).sort();

describe('Annotations3D', () => {
  it('builds every part as a MESH: WebGL draws a THREE.Line at one pixel whatever is asked', () => {
    const a = new Annotations3D();
    a.update(makeState(12, 12), data(), { draft: null });
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
    const a = new Annotations3D();
    a.update(makeState(12, 12), { ...data(), visible: false }, { draft: null });
    expect(a.group.visible).toBe(false);
    expect(a.group.children).toHaveLength(0);
    a.dispose();
  });

  it('refresh re-drapes the last ask over new heights', () => {
    const a = new Annotations3D();
    const state = makeState(12, 12);
    const d: AnnotationsState = { items: [data().items[2]!], visible: true, locked: false };
    a.update(state, d, { draft: null });
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
    const a = new Annotations3D();
    const state = makeState(12, 12);
    a.update(state, data(), { draft: null });
    a.update(state, data(), { draft: null });
    const sprite = a.group.children.find((o): o is THREE.Sprite => o.type === 'Sprite')!;
    expect(sprite.geometry.getAttribute('position')).toBeTruthy();
    a.dispose();
  });

  it('a selected note wears its mark: more meshes stand than for the same note unselected', () => {
    const a = new Annotations3D();
    const state = makeState(12, 12);
    a.update(state, data(), { draft: null });
    const bare = a.group.children.length;
    a.update(state, data(), { draft: null, selection: ['z1', 't1', 'r1'] });
    expect(a.group.children.length).toBeGreaterThan(bare);
    a.dispose();
  });
});
