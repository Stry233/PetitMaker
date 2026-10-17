// @vitest-environment jsdom
/** The 3D note ghost: built on the frame's flush, faded in through the registry motion (at once
 *  under reduced motion), and taken down at once by clearGhost. */
import '../../../../_support/pixi-env';
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OverlayNoteGhost3D } from '../../../../../view/map3d/layers/overlay/note-ghost';
import type { OverlayHost3D } from '../../../../../view/map3d/layers/overlay/host';
import { setReducedMotion } from '../../../../../platform/channels/motion-state';
import { animConfig } from '../../../../../view/shared/motion/anim-config';
import { NOTE_GHOST_ALPHA } from '../../../../../view/shared/overlay/ghost-geometry';
import type { RouteNote } from '../../../../../core/model/annotations';
import { makeState } from '../../../../_support/map-state';

const ROUTE: RouteNote = { kind: 'route', id: 'g', points: [{ x: 2, y: 2 }, { x: 8.5, y: 2 }], color: '#2FBF9B', dashed: false };

function fixture() {
  const state = makeState(16, 16);
  let now = 0;
  const host = { group: new THREE.Group(), state: () => state, requestRender: () => {}, nowMs: () => now } as unknown as OverlayHost3D;
  return { ghost: new OverlayNoteGhost3D(host), advance: (ms: number) => { now += ms; } };
}

/** The opacity a ghost part draws at over the opacity its note would. */
function strength(ghost: OverlayNoteGhost3D): number {
  const mesh = ghost.notes.group.children.find((o) => (o as THREE.Mesh).isMesh) as THREE.Mesh;
  const mat = mesh.material as THREE.Material;
  return mat.opacity / (mat.userData.opacity as number);
}

afterEach(() => setReducedMotion(false));

describe('the 3D note ghost', () => {
  it('drapes the note on the next flush and fades in over the registry motion', () => {
    const { ghost, advance } = fixture();
    ghost.show(ROUTE, '');
    expect(ghost.notes.group.children).toHaveLength(0);
    ghost.flush();
    expect(ghost.notes.group.children.length).toBeGreaterThan(0);
    expect(strength(ghost)).toBe(0);
    expect(ghost.tick()).toBe(true);
    advance(animConfig.noteGhost.fadeInMs);
    expect(ghost.tick()).toBe(false);
    expect(strength(ghost)).toBeCloseTo(NOTE_GHOST_ALPHA);
    ghost.show({ ...ROUTE, points: [{ x: 2, y: 2 }, { x: 9, y: 2 }] }, '');
    ghost.flush();
    expect(ghost.tick()).toBe(false);
    expect(strength(ghost)).toBeCloseTo(NOTE_GHOST_ALPHA);
  });

  it('lands at its strength at once under reduced motion', () => {
    setReducedMotion(true);
    const { ghost } = fixture();
    ghost.show(ROUTE, '');
    ghost.flush();
    expect(ghost.tick()).toBe(false);
    expect(strength(ghost)).toBeCloseTo(NOTE_GHOST_ALPHA);
  });

  it('goes at once on clear', () => {
    const { ghost } = fixture();
    ghost.show(ROUTE, '');
    ghost.flush();
    ghost.clear();
    ghost.flush();
    expect(ghost.notes.group.children).toHaveLength(0);
    expect(ghost.tick()).toBe(false);
  });
});
