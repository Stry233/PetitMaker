/**
 * A flagged object in 3D wears the selection's ground shadow and the move origin's body outline, in
 * the loss red; the outline is drawn over the scene, as the shadow is under a landmark's model, so
 * an object there still shows. The outline fades in only where motion is allowed.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { OverlayLayer3D } from '../../../../../view/map3d/layers/overlay-layer';
import { setReducedMotion } from '../../../../../platform/channels/motion-state';
import { FLAG_MARK, GHOST_LOSS } from '../../../../../view/shared/viewport/view-constants';
import type { PlacedObject } from '../../../../../core/model/types';
import { makeState } from '../../../../_support/map-state';

const cabin: PlacedObject = { id: 'cabin', catalogId: 'building-fluorite-cabin', position: { x: 6, y: 8 }, rotation: 0, elevation: 0 };

function overlay(now = () => 0) {
  const state = makeState(24, 24);
  state.objects.set(cabin.id, cabin);
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 100);
  camera.position.set(15, 15, 15);
  camera.lookAt(0, 0, 0);
  return new OverlayLayer3D({ state: () => state, requestRender: () => {}, camera, viewport: () => ({ width: 800, height: 600 }), nowMs: now });
}

const red = new THREE.Color().setHex(GHOST_LOSS).convertSRGBToLinear().getHex();
const meshes = (o: OverlayLayer3D) => o.group.children.filter((c): c is THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial> => c instanceof THREE.Mesh);

afterEach(() => setReducedMotion(false));

describe('a flagged object in 3D', () => {
  it('is outlined solid in the loss red over its body, drawn over the scene, and shadowed on its footprint, seated in it', () => {
    setReducedMotion(true);
    const o = overlay();
    o.showFlaggedObjects([cabin]);
    o.flush();
    const outline = o.group.getObjectByName('flagged-cabin') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(outline.material.color.getHex()).toBe(red);
    expect(outline.material.depthTest).toBe(false);
    expect(outline.material.opacity).toBe(1);
    expect(outline.geometry.getAttribute('position').count).toBeGreaterThan(0);
    const shadow = meshes(o).find((m) => m !== outline && m.material.opacity === FLAG_MARK.wash)!;
    // Nothing stands over it, so the ground and its own body hide its shadow as they hide the ground.
    expect(shadow.material.depthTest).toBe(true);
    expect(shadow.material.color.getHex()).toBe(red);
    expect(shadow.renderOrder).toBeLessThan(outline.renderOrder);
    const edge = o.group.children.find((c): c is THREE.LineSegments => c instanceof THREE.LineSegments)!;
    expect(edge.geometry.getAttribute('position').count).toBeGreaterThan(0);

    o.showFlaggedObjects(null);
    o.flush();
    expect(o.group.getObjectByName('flagged-cabin')).toBeUndefined();
    expect(o.group.children.some((c) => c instanceof THREE.LineSegments)).toBe(false);
    o.dispose();
  });

  it('fades its outline in where motion is allowed, and keeps the frame loop running while it does', () => {
    let now = 0;
    const o = overlay(() => now);
    o.showFlaggedObjects([cabin]);
    o.flush();
    const outline = o.group.getObjectByName('flagged-cabin') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>;
    expect(outline.material.opacity).toBe(0);
    now = 80;
    expect(o.tick()).toBe(true);
    expect(outline.material.opacity).toBeGreaterThan(0);
    now = 1000;
    o.tick();
    expect(outline.material.opacity).toBe(1);
    expect(o.tick()).toBe(false);
    o.dispose();
  });
});
