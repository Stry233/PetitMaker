import { describe, it, expect } from 'vitest';
import { buildRoadTrimMesh } from '../../canvas/map3d/build/terrain-geometry';
import { buildObjectInstances } from '../../canvas/map3d/build/object-meshes';
import { surfaceY } from '../../canvas/map3d/core/coords';
import { type GridState, TerrainType } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

// A road whose edge-cut gave it non-square corners can't ride the shared full-square instance geometry, so
// its trimmed top face is meshed separately — a 1:1 port of 2D drawRoadShape. Untrimmed roads stay instanced.
const addRoad = (s: any, id: string, corners?: any, rotation = 0) =>
  s.objects.set(id, { id, catalogId: 'road-dirt', position: { x: 5, y: 5 }, rotation, elevation: 0, corners });
const instanceCount = (s: GridState) => [...buildObjectInstances(s).values()].reduce((n, l) => n + l.length, 0);
const xCentroid = (m: { positions: number[] }) => { let sx = 0, n = 0; for (let i = 0; i < m.positions.length; i += 3) { sx += m.positions[i]!; n++; } return sx / n; };

describe('preview3d: road edge-cut renders in 3D', () => {
  it('a trimmed road is meshed and excluded from instancing (so it is not double-drawn as a full square)', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r1', ['square', 'square', 'square', 'fan']); // BR fan (canonical round state)
    expect(buildRoadTrimMesh(s).positions.length, 'trimmed road meshed').toBeGreaterThan(0);
    expect(instanceCount(s), 'excluded from the instanced decals').toBe(0);
  });

  it('an untrimmed road has NO custom mesh and stays instanced', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r2'); // no corners
    expect(buildRoadTrimMesh(s).positions.length).toBe(0);
    expect(instanceCount(s)).toBe(1);
    const s2 = makeState(20, 20) as GridState;
    addRoad(s2, 'r3', ['square', 'square', 'square', 'square']); // all-square = untrimmed
    expect(buildRoadTrimMesh(s2).positions.length).toBe(0);
    expect(instanceCount(s2)).toBe(1);
  });

  it('the cut DIRECTION follows the connection side (a 1:1 port of 2D drawRoadShape)', () => {
    // A wedge road: connSide is left at rotation 0 (filled mass on the LEFT) and right at rotation 180
    // (filled on the RIGHT). The 3D shape must flip with it, like the 2D txPt transform — the regression
    // for the cut rendering in the WRONG direction.
    const wedge = (rot: number) => { const s = makeState(20, 20) as GridState; addRoad(s, 'w', ['square', 'fan', 'square', 'fan'], rot); return buildRoadTrimMesh(s); };
    const left = wedge(0), right = wedge(180);
    expect(left.positions.length).toBeGreaterThan(0);
    expect(right.positions.length).toBeGreaterThan(0);
    expect(xCentroid(left), 'cut flips with the connection side').toBeLessThan(xCentroid(right));
  });

  it('the trim mesh matches the instanced decal: top at surfaceY + lift + slab, walls down to the lift base', () => {
    // The instanced road is a 0.05-thick box lifted 0.05 above the VISIBLE surface
    // (surfaceY — the ground slab top at layer 0, not layerToY). The trimmed tile
    // must occupy the same vertical band or it reads as a disconnected step, and
    // it needs side walls so its edges have the same thickness as its neighbours.
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r4', ['square', 'square', 'square', 'fan']);
    const m = buildRoadTrimMesh(s);
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      expect(m.positions[i]!).toBeGreaterThanOrEqual(-5 - 1e-6);
      expect(m.positions[i]!).toBeLessThanOrEqual(-4 + 1e-6);
      minY = Math.min(minY, m.positions[i + 1]!);
      maxY = Math.max(maxY, m.positions[i + 1]!);
      expect(m.positions[i + 2]!).toBeGreaterThanOrEqual(-5 - 1e-6);
      expect(m.positions[i + 2]!).toBeLessThanOrEqual(-4 + 1e-6);
    }
    expect(maxY, 'top face at the instanced road top (ground slab 0.08 + lift 0.05 + slab 0.05)').toBeCloseTo(surfaceY(0) + 0.1, 5);
    expect(minY, 'side walls reach down to the lift base, giving the tile thickness').toBeCloseTo(surfaceY(0) + 0.05, 5);
  });

  it('a road with an UNRECOGNISED corner state falls back to the instanced full square (never vanishes)', () => {
    // Only the five canonical road-cut states have trim polygons. Anything else
    // (e.g. a crafted save) must still draw SOMETHING — the plain decal — rather
    // than leaving a hole in the paved path.
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'rX', ['fan', 'square', 'square', 'square']); // not a canonical state
    expect(buildRoadTrimMesh(s).positions.length, 'no trim shape for it').toBe(0);
    expect(instanceCount(s), 'still drawn as the plain instanced decal').toBe(1);
  });

  it('an ELEVATED trimmed road rides its terrain surface like its instanced neighbours', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r5', ['square', 'square', 'square', 'fan']);
    // Raised by the TERRAIN under it: a road takes the surface's height, so moving the stored
    // number alone would pin the stale-elevation bug rather than the rendering.
    (s.objects.get('r5') as { elevation: number }).elevation = 3;
    const at = s.objects.get('r5')!.position;
    s.cells[at.y]![at.x]!.terrain = { type: TerrainType.Mountain, elevation: 3, corners: ['square', 'square', 'square', 'square'] };
    const m = buildRoadTrimMesh(s);
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]!);
    expect(maxY).toBeCloseTo(surfaceY(3) + 0.1, 5);
  });
});
