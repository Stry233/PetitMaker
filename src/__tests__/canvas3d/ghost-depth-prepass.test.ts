/**
 * The 3D placement ghost must read as ONE body.
 *
 * A model is merged from parts (a trunk inside a canopy, posts under a deck), so a single
 * translucent pass blends every interior face and the ghost shows its own guts. The fix is a
 * depth-only pre-pass over the same geometry: it writes the silhouette's depth, and the colour pass
 * then fails the depth test everywhere an interior face sits behind the surface. These pin the
 * structure that produces it, plus the two things the drag makes expensive: the validity tint must
 * swap cached materials rather than build them, and a pointer sample must not allocate.
 */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Overlay3D } from '../../canvas/map3d/scene/overlay3d';
import { modelGeometry } from '../../canvas/map3d/models/build-model';
import { hasModel } from '../../canvas/map3d/models/registry';
import type { GridState } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

/** A multi-part model: trunk cylinders standing inside overlapping canopy spheres. */
const TREE = 'tree-apple';

const overlayFor = (gs: GridState) => new Overlay3D(() => gs, () => {});

/** The colour-pass meshes the overlay group holds (the pre-pass rides as their child). */
function bodies(o: Overlay3D): THREE.Mesh[] {
  return o.group.children.filter((c): c is THREE.Mesh => (c as THREE.Mesh).isMesh && c.children.length > 0);
}

function prepassOf(mesh: THREE.Mesh): THREE.Mesh {
  const depth = mesh.children[0] as THREE.Mesh;
  expect(depth?.isMesh).toBe(true);
  return depth;
}

describe('3D placement ghost: depth pre-pass', () => {
  it('the model this pins really is multi-part', () => {
    expect(hasModel(TREE)).toBe(true);
    // Parts are merged into one geometry, which is exactly why per-part opacity had nothing to
    // occlude it: the whole body is a single translucent draw.
    expect(modelGeometry(TREE)!.getAttribute('position').count).toBeGreaterThan(100);
  });

  it('draws the body as a depth-only pass plus a translucent colour pass over ONE geometry', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);

    const [mesh] = bodies(o);
    expect(mesh).toBeDefined();
    const depth = prepassOf(mesh!);
    expect(depth.geometry).toBe(mesh!.geometry); // one geometry, so the two passes cannot disagree

    const colorMat = mesh!.material as THREE.MeshBasicMaterial;
    expect(colorMat.transparent).toBe(true);
    expect(colorMat.depthTest).toBe(true);     // the pre-pass is only useful if the colour pass reads it
    expect(colorMat.depthWrite).toBe(false);

    const depthMat = depth.material as THREE.MeshBasicMaterial;
    expect(depthMat.colorWrite).toBe(false);
    expect(depthMat.depthWrite).toBe(true);
    expect(depthMat.depthTest).toBe(true);
    // Transparent, so renderOrder (not the opaque queue's z sort) fixes when it runs.
    expect(depthMat.transparent).toBe(true);
  });

  it('orders the pre-pass before the colour pass and BOTH after the cell decals', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    o.showGhost([{ x: 6, y: 6 }], 0x59c85f, false);
    o.flush();
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);

    const [mesh] = bodies(o);
    const depth = prepassOf(mesh!);
    expect(depth.renderOrder).toBeLessThan(mesh!.renderOrder);
    // The wash a wide canopy hangs over must survive: the pre-pass runs after every decal, so its
    // depth can never punch the footprint out.
    const decals = o.group.children.filter((c) => (c as THREE.Mesh).isMesh && c.children.length === 0);
    expect(decals.length).toBeGreaterThan(0);
    for (const d of decals) expect(d.renderOrder).toBeLessThan(depth.renderOrder);
  });

  it('swaps cached materials on a validity flip instead of building them', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);
    const mesh = bodies(o)[0]!;
    const green = mesh.material as THREE.MeshBasicMaterial;
    const depthMat = prepassOf(mesh).material;

    o.showPlacementGhost(TREE, 7, 6, 0, false, 0);
    const red = mesh.material as THREE.MeshBasicMaterial;
    expect(red).not.toBe(green);
    expect(red.color.getHex()).not.toBe(green.color.getHex());

    o.showPlacementGhost(TREE, 8, 6, 0, true, 0);
    expect(mesh.material).toBe(green);   // the SAME instance, not an equal one
    o.showPlacementGhost(TREE, 9, 6, 0, false, 0);
    expect(mesh.material).toBe(red);
    expect(prepassOf(mesh).material).toBe(depthMat); // colourless: one material for both tints
  });

  it('reuses meshes across pointer samples — a drag allocates nothing', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);
    const mesh = bodies(o)[0]!;
    const depth = prepassOf(mesh);
    for (let i = 0; i < 20; i++) o.showPlacementGhost(TREE, 6 + i, 6, 0, i % 2 === 0, 0);
    expect(bodies(o)).toEqual([mesh]);
    expect(prepassOf(mesh)).toBe(depth);
  });

  it('gives every member of a group drag ghost its own pre-pass, and pools them', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    const member = (i: number) => ({ catalogId: TREE, x: 4 + i * 2, y: 4, rotation: 0, elevation: 0 });

    o.showGroupPlacementGhost([member(0), member(1), member(2)], true);
    const three = bodies(o);
    expect(three.length).toBe(3);
    for (const m of three) {
      const d = prepassOf(m);
      expect(d.geometry).toBe(m.geometry);
      expect((d.material as THREE.MeshBasicMaterial).colorWrite).toBe(false);
      expect(d.renderOrder).toBeLessThan(m.renderOrder);
    }

    o.showGroupPlacementGhost([member(0), member(1)], false);
    const two = bodies(o);
    expect(two.length).toBe(2);
    expect(two).toEqual(three.slice(0, 2)); // shrinking pops, it does not rebuild
  });

  it('leaves renderOrder 1 and 2 to the ghost: every other overlay object stays at 0', () => {
    // A Group's renderOrder becomes the shared groupOrder of its subtree, so its children sort by
    // their OWN number alone. Anything else claiming 1 or more would draw after the pre-pass and be
    // depth-clipped by it wherever the ghost stands, with nothing to say so.
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    const cells = [{ x: 6, y: 6 }, { x: 7, y: 6 }];
    o.showGhost(cells, 0x59c85f, true);
    o.flush();
    o.showSelection(8, 8, 2, 2);
    o.showHover(10, 10);
    o.showBand({ x: 2, y: 2, w: 4, h: 4 });
    o.showBuildableRegion(cells, true);
    o.showRoute(cells);
    o.flashCommit(cells);
    o.flashErrors([{ ruleId: 'V-TEST', message: 'x', cells, severity: 'error' }], true);
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);
    o.showGroupPlacementGhost([
      { catalogId: TREE, x: 12, y: 6, rotation: 0, elevation: 0 },
      { catalogId: TREE, x: 14, y: 6, rotation: 0, elevation: 0 },
    ], true);

    const ghosts = bodies(o);
    expect(ghosts.length).toBe(3);              // the hover ghost plus both group members
    const claimed = new Set<THREE.Object3D>(ghosts.flatMap((m) => [m, prepassOf(m)]));
    const drawn: THREE.Object3D[] = [];
    o.group.traverse((c) => { if ((c as THREE.Mesh).material) drawn.push(c); });
    expect(drawn.length).toBeGreaterThan(claimed.size); // the other features really are in the scene

    for (const obj of drawn) {
      if (claimed.has(obj)) continue;
      expect(obj.renderOrder, obj.type).toBe(0);
    }
  });

  it('hiding the body hides its pre-pass with it', () => {
    const gs = makeState(24, 24) as GridState;
    const o = overlayFor(gs);
    o.showPlacementGhost(TREE, 6, 6, 0, true, 0);
    const mesh = bodies(o)[0]!;
    // The pre-pass is a CHILD, so three.js skips it the moment the body goes invisible — no second
    // visibility flag to forget.
    expect(prepassOf(mesh).parent).toBe(mesh);
    o.clearGhost();
    expect(mesh.visible).toBe(false);
  });
});
