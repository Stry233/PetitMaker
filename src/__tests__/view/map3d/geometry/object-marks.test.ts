/**
 * An object's 3D marks sit on its visible geometry: a coating's ground mark, flag and outline lie on
 * the one face the road mesher draws for it, on flat ground and on raised layers alike; a solid's
 * ground mark drapes on the terrain each part of its footprint rests on, a ramp's on both tiers; a
 * bridge's lies on the plane its landings stand on, not on the water under it; and a body outline
 * leaves out what the ground hides. The selection shadow and the hand repair's flag both read them.
 */
import { afterEach, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CommandType, TerrainType, type GridState, type PlacedObject } from '../../../../core/model/types';
import { makeExecutor, makeState, setTerrain } from '../../../_support/map-state';
import { getMapTemplate } from '../../../../config/maps';
import { createGridState } from '../../../../core/model/template';
import { templateAnchor } from '../../../../core/model/landmarks';
import { objectElevation, objectRect } from '../../../../state/object-geometry';
import { bridgeDeckY, cellCornerWorld, surfaceY } from '../../../../view/map3d/geometry/coords';
import { DECAL_LIFT } from '../../../../view/map3d/geometry/overlay-decals';
import { surfaceHeightAt } from '../../../../view/map3d/geometry/pick';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';
import { objectInstance } from '../../../../view/map3d/geometry/object-meshes';
import { groupModelGeometry } from '../../../../view/map3d/models/build-model';
import { clipTrianglesAbove } from '../../../../view/map3d/geometry/move-silhouette';
import { bodyFloorY, flatBodyTriangles, flatOutline, footprintMark } from '../../../../view/map3d/geometry/object-marks';
import { OverlayLayer3D } from '../../../../view/map3d/layers/overlay-layer';
import { setReducedMotion } from '../../../../platform/channels/motion-state';
import { PLACEMENT_GRID } from '../../../../core/game/profile';

const ROAD = 'path-cobblestone';
/** A drape's own lift over the surface plus a box's over the cell washes. */
const LIFTED = 2 * DECAL_LIFT;

/** A 40 x 40 map: a layer-2 block with a layer-4 block on it, a layer-1 terrace for a ramp and a
 *  water channel for a bridge, each object placed through the executor so its traits seat it. */
function scene() {
  const s = makeState(40, 40);
  const fill = ([x0, y0, x1, y1]: [number, number, number, number], type: TerrainType, e: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTerrain(s, x, y, type, e);
  };
  fill([6, 6, 20, 20], TerrainType.Mountain, 2);
  fill([10, 10, 15, 15], TerrainType.Mountain, 4);
  fill([30, 32, 38, 37], TerrainType.Mountain, 1);
  fill([26, 4, 29, 20], TerrainType.Water, 0);
  const ex = makeExecutor(s);
  let n = 0;
  const place = (catalogId: string, x: number, y: number): PlacedObject => {
    const id = `o${n++}`;
    const r = ex.execute({ type: CommandType.PlaceObject, object: { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 } });
    if (!r.success) throw new Error(`${catalogId} at ${x},${y}: ${JSON.stringify(r.errors)}`);
    return s.objects.get(id)!;
  };
  return {
    s,
    roads: { flat: place(ROAD, 2, 24), layer2: place(ROAD, 7, 8), layer4: place(ROAD, 11, 12), terrace: place(ROAD, 34, 34) },
    tree: place('tree-apple', 8, 16),
    ramp: place('ramp-teak-stair', 34, 31),
    bridge: place('bridge-plank', 26, 12),
  };
}

/** Every vertex height of a flat position list. */
const heights = (positions: ArrayLike<number>): number[] => Array.from(positions).filter((_, i) => i % 3 === 1);

/** The heights the road mesher draws `road`'s face at: the vertices over its footprint. */
function roadFaceY(state: GridState, road: PlacedObject): number[] {
  const r = objectRect(road);
  const a = cellCornerWorld(r.x, r.y, state.template.width, state.template.height, PLACEMENT_GRID);
  const ys: number[] = [];
  for (const part of buildRoadTrimMeshes(state)) {
    const p = part.mesh.positions;
    for (let i = 0; i < p.length; i += 3) {
      if (p[i]! >= a.x - 1e-6 && p[i]! <= a.x + r.w + 1e-6 && p[i + 2]! >= a.z - 1e-6 && p[i + 2]! <= a.z + r.h + 1e-6) ys.push(p[i + 1]!);
    }
  }
  return ys;
}

afterEach(() => setReducedMotion(false));

describe('where an object\'s 3D marks sit', () => {
  it('a coating\'s ground mark, flag outline and body face lie on the face the road mesher draws, on every layer', () => {
    const { s, roads } = scene();
    for (const [name, road] of Object.entries(roads)) {
      const face = roadFaceY(s, road);
      expect(face.length, name).toBeGreaterThan(0);
      const y = face[0]!;
      expect(face.every((v) => Math.abs(v - y) < 1e-9), name).toBe(true);
      // The face itself stands on its layer, which the saved elevation does not say.
      expect(y, name).toBeGreaterThan(surfaceY(objectElevation(s, road)));
      expect(y - surfaceY(objectElevation(s, road)), name).toBeLessThan(DECAL_LIFT);
      for (const v of heights(footprintMark(s, road).positions)) expect(v, name).toBeCloseTo(y, 9);
      for (const v of heights(flatBodyTriangles(s, road))) expect(v, name).toBeCloseTo(y, 9);
      for (const p of flatOutline(s, road)) expect(p[1], name).toBeCloseTo(y, 9);
    }
    expect(objectElevation(s, roads.layer4)).toBe(4);
    expect(roads.layer4.elevation).toBe(0);
  });

  it('a solid\'s ground mark drapes on the terrain under it, a ramp\'s on each tier its footprint rests on', () => {
    const { s, tree, ramp } = scene();
    for (const obj of [tree, ramp]) {
      const p = footprintMark(s, obj).positions;
      for (let i = 0; i < p.length; i += 3) {
        // A piece's vertex on a tier edge belongs to its own piece; read the ground just inside it.
        const ground = [surfaceHeightAt(s, p[i]! + 1e-3, p[i + 2]! + 1e-3), surfaceHeightAt(s, p[i]! - 1e-3, p[i + 2]! - 1e-3),
          surfaceHeightAt(s, p[i]! + 1e-3, p[i + 2]! - 1e-3), surfaceHeightAt(s, p[i]! - 1e-3, p[i + 2]! + 1e-3)];
        expect(ground.some((g) => Math.abs(g + LIFTED - p[i + 1]!) < 1e-6), obj.catalogId).toBe(true);
      }
    }
    for (const v of heights(footprintMark(s, tree).positions)) expect(v).toBeCloseTo(surfaceY(2) + LIFTED, 6);
  });

  it('a bridge\'s ground mark lies on its landing plane, where its body stands, not on the water', () => {
    const { s, bridge } = scene();
    const deck = bridgeDeckY(objectElevation(s, bridge));
    expect(objectInstance(s, bridge)!.inst.y).toBe(deck);
    for (const v of heights(footprintMark(s, bridge).positions)) expect(v).toBe(deck);
    expect(bodyFloorY(s, bridge)).toBeLessThan(deck);
  });

  it('a body outline leaves out what the ground hides: a ramp\'s sunk foot', () => {
    const { s, ramp } = scene();
    const { groupKey, inst } = objectInstance(s, ramp)!;
    const geo = groupModelGeometry(groupKey, 'full')!.toNonIndexed();
    geo.applyMatrix4(new THREE.Matrix4().compose(
      new THREE.Vector3(inst.x, inst.y, inst.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), inst.rotationY),
      new THREE.Vector3(inst.scaleX, inst.scaleY, inst.scaleZ),
    ));
    const floor = bodyFloorY(s, ramp);
    const raw = heights(geo.getAttribute('position').array);
    expect(Math.min(...raw)).toBeLessThan(floor);
    const kept = heights(clipTrianglesAbove(geo.getAttribute('position').array, floor));
    expect(kept.length).toBeGreaterThan(0);
    expect(Math.min(...kept)).toBeGreaterThanOrEqual(floor - 1e-9);
  });

  it('the selection shadow and the flag of a raised road lie on its face; a flag is seated unless a landmark stands over it', () => {
    setReducedMotion(true);
    const { s, roads } = scene();
    const face = roadFaceY(s, roads.layer4)[0]!;
    const o = new OverlayLayer3D({ state: () => s, requestRender: () => {} });
    const meshYs = () => o.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name === '')
      .flatMap((m) => heights(m.geometry.getAttribute('position').array));
    o.showObjectSelection(roads.layer4.id);
    o.flush();
    expect(meshYs().length).toBeGreaterThan(0);
    for (const v of meshYs()) expect(v).toBeCloseTo(face, 5);
    o.clearSelection();
    o.showFlaggedObjects([roads.layer4]);
    o.flush();
    const flagParts = o.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name === '');
    expect(flagParts.length).toBe(2);
    for (const v of meshYs()) expect(v).toBeCloseTo(face, 5);
    expect(flagParts.every((m) => (m.material as THREE.Material).depthTest)).toBe(true);
    o.dispose();

    // A road under the plaza: drawn over the scene, which the plaza's model may stand over.
    const hexia = createGridState(getMapTemplate('hexia'));
    const a = templateAnchor(hexia.template)!;
    const under: PlacedObject = { id: 'under', catalogId: ROAD, position: { x: Math.floor(a.x) + 2, y: Math.floor(a.y) + 2 }, rotation: 0, elevation: 0 };
    hexia.objects.set(under.id, under);
    const h = new OverlayLayer3D({ state: () => hexia, requestRender: () => {} });
    h.showFlaggedObjects([under]);
    h.flush();
    const parts = h.group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && c.name === '');
    expect(parts.length).toBe(2);
    expect(parts.every((m) => !(m.material as THREE.Material).depthTest)).toBe(true);
    h.dispose();
  });
});
