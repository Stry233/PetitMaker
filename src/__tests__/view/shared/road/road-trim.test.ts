import { roadMaterialSettled } from '../../../../view/shared/road/material';
import { beforeAll, describe, it, expect } from 'vitest';
import { buildRoadTrimMeshes } from '../../../../view/map3d/geometry/road-mesh';
import { buildObjectInstances } from '../../../../view/map3d/geometry/object-meshes';
import { surfaceY } from '../../../../view/map3d/geometry/coords';
import { type GridState, TerrainType } from '../../../../core/model/types';
import { makeState } from '../../../_support/map-state';
import { getCatalogItem } from '../../../../state/catalog';

// Every road is meshed (never instanced): the surface feathers at its boundary, a vertex-colour
// fade no instanced unit box can carry. The geometry is a 1:1 port of the 2D painter's.
const addRoad = (s: any, id: string, corners?: any, rotation = 0) =>
  s.objects.set(id, { id, catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation, elevation: 0, corners });
/** These maps are paved in one material, so the split's single part is the road mesh. */
const buildRoadTrimMesh = (s: GridState) =>
  buildRoadTrimMeshes(s)[0]?.mesh ?? { positions: [] as number[] };
const instanceCount = (s: GridState) => [...buildObjectInstances(s).values()].reduce((n, l) => n + l.length, 0);
const xCentroid = (m: { positions: number[] }) => {
  let sx = 0, n = 0;
  for (let i = 0; i < m.positions.length; i += 3) { sx += m.positions[i]!; n++; }
  return sx / n;
};

describe('preview3d: road edge-cut renders in 3D', () => {
  it('a trimmed road is meshed and excluded from instancing (so it is not double-drawn as a full square)', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r1', ['square', 'square', 'square', 'fan']); // BR fan (canonical round state)
    expect(buildRoadTrimMesh(s).positions.length, 'trimmed road meshed').toBeGreaterThan(0);
    expect(instanceCount(s), 'excluded from the instanced decals').toBe(0);
  });

  it('an untrimmed road is meshed too — its boundary feather needs the mesh', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r2');
    expect(buildRoadTrimMesh(s).positions.length).toBeGreaterThan(0);
    expect(instanceCount(s)).toBe(0);
    const s2 = makeState(20, 20) as GridState;
    addRoad(s2, 'r3', ['square', 'square', 'square', 'square']); // all-square = untrimmed
    expect(buildRoadTrimMesh(s2).positions.length).toBeGreaterThan(0);
    expect(instanceCount(s2)).toBe(0);
  });

  it('the cut DIRECTION follows the connection side (a 1:1 port of 2D drawRoadShape)', () => {
    // A wedge fills the left side at rotation 0 and the right side at rotation 180, as in 2D.
    const wedge = (rot: number) => { const s = makeState(20, 20) as GridState; addRoad(s, 'w', ['square', 'fan', 'square', 'fan'], rot); return buildRoadTrimMesh(s); };
    const left = wedge(0), right = wedge(180);
    expect(left.positions.length).toBeGreaterThan(0);
    expect(right.positions.length).toBeGreaterThan(0);
    expect(xCentroid(left), 'cut flips with the connection side').toBeLessThan(xCentroid(right));
  });

  it('a road is a FLAT decal: one plane a hair above the surface, no thickness of its own', () => {
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
    expect(maxY, 'one flat plane').toBeCloseTo(minY, 6);
    expect(maxY).toBeGreaterThan(surfaceY(0));
    expect(maxY).toBeLessThan(surfaceY(0) + 0.05);
  });

  it('a road with an UNRECOGNISED corner state draws as the full square (never vanishes)', () => {
    // Only the five canonical road-cut states have trim polygons; any other (a crafted save) draws
    // the whole cell.
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'rX', ['fan', 'square', 'square', 'square']);
    expect(buildRoadTrimMesh(s).positions.length, 'meshed as the whole cell').toBeGreaterThan(0);
    expect(instanceCount(s), 'roads are never instanced').toBe(0);
  });

  it('an ELEVATED trimmed road rides its terrain surface like its instanced neighbours', () => {
    const s = makeState(20, 20) as GridState;
    addRoad(s, 'r5', ['square', 'square', 'square', 'fan']);
    // The terrain is raised too, since a road takes the surface's height.
    (s.objects.get('r5') as { elevation: number }).elevation = 3;
    const at = s.objects.get('r5')!.position;
    s.cells[at.y]![at.x]!.terrain = { type: TerrainType.Mountain, elevation: 3, corners: ['square', 'square', 'square', 'square'] };
    const m = buildRoadTrimMesh(s);
    let maxY = -Infinity;
    for (let i = 1; i < m.positions.length; i += 3) maxY = Math.max(maxY, m.positions[i]!);
    expect(maxY).toBeGreaterThan(surfaceY(3));
    expect(maxY).toBeLessThan(surfaceY(3) + 0.05);
  });
});

/**
 * A texture is per mesh, so each material gets its own mesh. UVs are cell units off the map corner,
 * the 2D fill's anchor, so separate surfaces of one material share a pattern phase.
 */
describe('preview3d: road decals split per material and carry tile UVs', () => {
  beforeAll(() => roadMaterialSettled());
  const paved = (s: any, id: string, catalogId: string, x: number, y: number) =>
    s.objects.set(id, { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 });

  it('keeps each procedural finish separate', () => {
    const s = makeState(20, 20) as GridState;
    paved(s, 'd', 'path-overgrown-dirt', 2, 2);
    paved(s, 'c', 'path-cobblestone', 5, 2);
    const parts = buildRoadTrimMeshes(s);
    expect([...new Set(parts.map(p => p.material))].sort()).toEqual(['path-cobblestone', 'path-overgrown-dirt']);
    const dirt = parts.find((p) => p.material === 'path-overgrown-dirt')!;
    expect(dirt.icon).toBeUndefined();
    expect(dirt.pattern).toBe(getCatalogItem(dirt.material)!.roadMaterial!.edge.pattern);
    expect(parts.find((p) => p.material === 'path-cobblestone')!.pattern).toBe(getCatalogItem('path-cobblestone')!.roadMaterial!.edge.pattern);
    for (const p of parts) expect(p.mesh.positions.length).toBeGreaterThan(0);
  });

  it('emits one UV per vertex, phased on the world grid (one cell = one repeat)', () => {
    const s = makeState(20, 20) as GridState;
    paved(s, 'c1', 'path-cobblestone', 3, 4);
    paved(s, 'c2', 'path-cobblestone', 9, 12); // a second, disconnected surface of the same material
    const [part] = buildRoadTrimMeshes(s);
    const uv = part!.mesh.uv!;
    expect(uv.length * 3).toBe(part!.mesh.positions.length * 2);
    for (let i = 0; i < part!.mesh.positions.length / 3; i++) {
      const wx = part!.mesh.positions[i * 3]!, wz = part!.mesh.positions[i * 3 + 2]!;
      // The map is centred on the origin (20 cells → corner at −10), so a cell line at integer
      // world x is an integer u: the repeat starts on the grid, never on the surface.
      expect(uv[i * 2]!).toBeCloseTo(wx + 10, 6);
      expect(uv[i * 2 + 1]!).toBeCloseTo(wz + 10, 6);
    }
  });

  it('leaves a textured surface untinted', () => {
    // The tile art carries the colour; multiplying the item's hex on top would darken it twice.
    const s = makeState(20, 20) as GridState;
    paved(s, 'd', 'path-overgrown-dirt', 2, 2);
    paved(s, 'c', 'path-cobblestone', 5, 2);
    const parts = buildRoadTrimMeshes(s);
    for (const p of parts) {
      expect(p.mesh.colors.length, p.material).toBeGreaterThan(0);
      for (const c of p.mesh.colors) expect(c, p.material).toBe(1);
    }
  });
});
