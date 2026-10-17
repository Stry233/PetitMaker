/**
 * Pure road surface mesher: every connected road region as flat feathered decals batched by
 * material and finish, plus the per-cell surface prints. No three.js; the scene wraps the arrays.
 */
import earcut from 'earcut';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { PLACEMENT_GRID } from '../../../core/game/profile';
import type { RoadMaterialPattern } from '../../../config/catalog/road-material';
import { roadPatternKey } from '../../shared/road/pattern';
import { objectElevation } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { ROAD_FEATHER } from '../../shared/road/shape';
import type { RoadRegion } from '../../shared/road/region';
import { RoadRegionCache, roadSurfaceTiles } from '../../shared/road/region-cache';
import { roadFeatherOutline } from '../../shared/road/feather';
import { roadBandLayout, roadMaterialReady, type RoadMaterialPatch } from '../../shared/road/material';
import { RoadBuildCache } from '../../shared/road/build-cache';
import { carriedRoadSurfaces, standingRoadSurfaces } from '../../shared/road/flight';
import type { Pt } from '../../shared/terrain/quadrant-poly';
import { cellCornerWorld, surfaceY, ROAD_DECAL_LIFT } from './coords';
import { hexToRgb01, objectColor, type Rgb } from '../draw/palette';
import { area2, emptyMesh } from './mesh-emit';
import type { MeshData } from './types';

/** A flat ring between two same-count outlines at height `y`, one colour, alpha running from 0 at
 *  the outer ring to 1 at the inner — the mesh form of the 2D painter's alpha bands, compositing
 *  over the real terrain beneath rather than over a guessed ground tint (two fades meeting at a
 *  seam must show the ground, and only alpha can show the ground as it is actually shaded).
 *  Coincident pairs (an edge that does not fade) emit zero-area quads, which draw nothing. */
function pushFeatherRing(m: MeshData, outer: Pt[], inner: Pt[], y: number, col: Rgb): void {
  for (let k = 0; k < outer.length; k++) {
    const k2 = (k + 1) % outer.length;
    const [o1, o2, i2, i1] = [outer[k]!, outer[k2]!, inner[k2]!, inner[k]!];
    const t1 = area2(o1, o2, i2) !== 0, t2 = area2(o1, i2, i1) !== 0;
    if (!t1 && !t2) continue;
    const base = m.positions.length / 3;
    for (const [p, a] of [[o1, 0], [o2, 0], [i2, 1], [i1, 1]] as const) {
      m.positions.push(p[0], y, p[1]);
      m.colors.push(col[0], col[1], col[2]);
      m.alpha!.push(a);
    }
    if (t1) m.index.push(base, base + 1, base + 2);
    if (t2) m.index.push(base, base + 2, base + 3);
  }
}

/** The alpha-1 interior of a region: its rings at full inset, triangulated with holes. */
function pushRegionCore(m: MeshData, rings: Pt[][], y: number, col: Rgb): void {
  // One connected surface has one outer ring; every other ring is a hole in it.
  let outerIdx = 0, outerArea = 0;
  rings.forEach((ring, i) => {
    let a = 0;
    for (let k = 0; k < ring.length; k++) {
      const [x1, y1] = ring[k]!, [x2, y2] = ring[(k + 1) % ring.length]!;
      a += x1 * y2 - x2 * y1;
    }
    if (Math.abs(a) > outerArea) { outerArea = Math.abs(a); outerIdx = i; }
  });
  const ordered = [rings[outerIdx]!, ...rings.filter((_, i) => i !== outerIdx)];
  const flat: number[] = [];
  const holes: number[] = [];
  for (const [i, ring] of ordered.entries()) {
    if (i > 0) holes.push(flat.length / 2);
    for (const [px, pz] of ring) flat.push(px, pz);
  }
  const tris = earcut(flat, holes, 2);
  const base = m.positions.length / 3;
  for (let i = 0; i < flat.length; i += 2) {
    m.positions.push(flat[i]!, y, flat[i + 1]!);
    m.colors.push(col[0], col[1], col[2]);
    m.alpha!.push(1);
  }
  for (const i of tris) m.index.push(base + i);
}

/** Road surfaces batched by catalog material and texture finish. */
export interface RoadTrimPart {
  /** The catalog id every surface in this mesh is paved with. */
  material: string;
  /** Catalog icon for legacy surfaces; authored finishes supply their own patterns. */
  icon?: string;
  pattern?: RoadMaterialPattern;
  mesh: MeshData;
}

/** Texture space for a road decal: 1 unit = 1 macro cell, phased on the map corner, so the pattern
 *  is anchored to the grid (an integer cell line falls on an integer UV) and two surfaces of one
 *  material can never disagree where they meet. Derived from the finished positions rather than
 *  pushed beside each vertex: the UV is the world XZ, and one derivation cannot drift from it.
 *  Matches the 2D painter's fill matrix, which anchors the same pattern at the world origin. */
function fillGridUvs(m: MeshData, origin: { x: number; z: number }): void {
  const uv: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) uv.push(m.positions[i]! - origin.x, m.positions[i + 2]! - origin.z);
  m.uv = uv;
}

/** One window's band polygons triangulated in cell coordinates, ready to translate into place. */
interface WindowCore {
  pattern?: RoadMaterialPattern;
  color: Rgb;
  /** Interleaved x, z. */
  flat: number[];
  index: number[];
}

function triangulateWindow(patches: RoadMaterialPatch[]): WindowCore[] {
  const out: WindowCore[] = [];
  for (const patch of patches) for (const polygon of patch.polygons) {
    const flat: number[] = [];
    const holes: number[] = [];
    polygon.forEach((ring, i) => {
      if (i > 0) holes.push(flat.length / 2);
      for (const [x, z] of ring) flat.push(x, z);
    });
    out.push({ pattern: patch.pattern, color: hexToRgb01(patch.color), flat, index: earcut(flat, holes, 2) });
  }
  return out;
}

/**
 * What a scene keeps between road rebuilds. Regions are re-derived only near the road tiles that
 * changed since the previous build, and each band window is triangulated once while a build in the
 * latest two still draws it, so tween frames and move previews reuse every unchanged window.
 */
export class RoadTrimCache {
  readonly regions = new RoadRegionCache();
  readonly cores = new RoadBuildCache<WindowCore[]>();
  readonly standing = new RoadBuildCache<RoadRegion[]>();

  /** `onMaterialReady` runs when material bands become available after a build drew without them. */
  constructor(readonly onMaterialReady?: () => void) {}

  finish(): void {
    this.cores.finish();
    this.standing.finish();
  }
}

/**
 * The height of the one flat face a coating draws as: a hair above the surface it coats, and a
 * surface print a hair above the paving under it. Its marks (a flag, a selection shadow, an outline)
 * lie on this face.
 */
export function coatingSurfaceY(state: GridState, obj: PlacedObject): number {
  const lifts = getCatalogItem(obj.catalogId)?.surfacePrint ? 2 : 1;
  return surfaceY(objectElevation(state, obj)) + ROAD_DECAL_LIFT * lifts;
}

/**
 * Every road surface as flat meshes, feather included: connected same-material tiles trace one
 * region outline (`view/shared/road/region`, as the 2D painter does) and fade in over the
 * authored feather across the whole surface, never per tile. Roads use the object grid. Icon
 * textures carry their colours over white vertices; authored materials draw tinted bands, batched
 * per finish, and their swatch-coloured core until the clipper loads. `offsets` moves named roads
 * on the ground for the group tweens: a region carried whole travels whole, and a partly carried
 * one draws as `shared/road/flight.ts` describes.
 */
export function buildRoadTrimMeshes(
  state: GridState,
  hiddenLayers?: ReadonlySet<number>,
  offsets?: ReadonlyMap<string, { dx: number; dz: number }>,
  cache: RoadTrimCache = new RoadTrimCache(),
): RoadTrimPart[] {
  const { width, height } = state.template;
  const roads = roadLookup(state);
  const roadObjs = roadSurfaceTiles(state);
  const origin = cellCornerWorld(0, 0, width, height, PLACEMENT_GRID);
  const bands = roadMaterialReady(cache.onMaterialReady);

  const parts = new Map<string, RoadTrimPart>();
  const partFor = (material: string, pattern?: RoadMaterialPattern): RoadTrimPart => {
    const key = `${material}:${roadPatternKey(pattern)}`;
    let part = parts.get(key);
    if (!part) {
      const item = getCatalogItem(material);
      const icon = item?.roadMaterial ? undefined : item?.icon;
      part = { material, ...(icon ? { icon } : {}), ...(pattern ? { pattern } : {}), mesh: { ...emptyMesh(), alpha: [] } };
      parts.set(key, part);
    }
    return part;
  };

  const drawSurface = (region: RoadRegion, y: number, off?: { dx: number; dz: number }): void => {
    const item = getCatalogItem(region.material);
    const spec = item?.roadMaterial;
    const banded = !!spec && bands;
    const part = partFor(region.material, banded ? spec.edge.pattern : undefined);
    const m = part.mesh;
    const col: Rgb = banded ? hexToRgb01(spec.edge.color)
      : spec ? hexToRgb01(item.color ?? spec.edge.color)
        : part.icon ? [1, 1, 1] : objectColor(region.members[0]!, item);
    const dx = origin.x + (off?.dx ?? 0), dz = origin.z + (off?.dz ?? 0);
    const place = (pts: readonly (readonly [number, number])[]): Pt[] =>
      pts.map(([px, pz]) => [px + dx, pz + dz] as Pt);
    const cores: Pt[][] = [];
    for (const ring of region.rings) {
      const outlineAt = roadFeatherOutline(ring.points);
      const outer = place(outlineAt(0));
      const core = place(outlineAt(spec?.feather ?? ROAD_FEATHER));
      pushFeatherRing(m, outer, core, y, col);
      cores.push(core);
    }
    if (!banded) { pushRegionCore(m, cores, y, col); return; }
    for (const window of roadBandLayout(region, spec).windows) {
      for (const core of cache.cores.get(window.key, () => triangulateWindow(window.patches()))) {
        const target = partFor(region.material, core.pattern).mesh;
        const base = target.positions.length / 3;
        for (let i = 0; i < core.flat.length; i += 2) {
          target.positions.push(core.flat[i]! + dx, y, core.flat[i + 1]! + dz);
          target.colors.push(core.color[0], core.color[1], core.color[2]);
          target.alpha!.push(1);
        }
        for (const i of core.index) target.index.push(base + i);
      }
    }
  };

  // A landed tween hands back offsets that are only float dust; a build where every offset is dust is at rest.
  const moving = (o?: { dx: number; dz: number }): boolean => !!o && Math.abs(o.dx) + Math.abs(o.dz) > 1e-9;
  const inFlight = !!offsets && [...offsets.values()].some(moving);
  const carried = (id: string): boolean => inFlight && offsets!.has(id);

  for (const region of cache.regions.regionsFor(state, roadObjs, roads)) {
    const elev = objectElevation(state, region.members[0]!);
    if (hiddenLayers?.has(elev)) continue; // hides with its layer
    // A road is a flat decal: one face a hair above the surface it coats, no walls and no
    // thickness of its own.
    const y = coatingSurfaceY(state, region.members[0]!);
    const flying = region.members.filter((o) => carried(o.id));
    if (flying.length === 0) { drawSurface(region, y); continue; }
    const off = offsets!.get(flying[0]!.id)!;
    if (flying.length === region.members.length && flying.every((o) => {
      const v = offsets!.get(o.id)!;
      return v.dx === off.dx && v.dz === off.dz;
    })) {
      drawSurface(region, y, off);
      continue;
    }
    const key = `${region.signature}#${flying.map((o) => o.id).sort().join(',')}`;
    for (const standing of cache.standing.get(key, () => standingRoadSurfaces(region, carried, roads))) drawSurface(standing, y);
    for (const member of flying) {
      for (const surface of carriedRoadSurfaces(member, roads)) drawSurface(surface, y, offsets!.get(member.id));
    }
  }
  cache.finish();
  const out = [...parts.values()].filter((p) => p.mesh.positions.length > 0);
  for (const p of out) fillGridUvs(p.mesh, origin);
  for (const obj of state.objects.values()) {
    const pattern = getCatalogItem(obj.catalogId)?.surfacePrint;
    if (!pattern) continue;
    const elevation = objectElevation(state, obj);
    if (hiddenLayers?.has(elevation)) continue;
    let part = parts.get(obj.catalogId);
    if (!part) {
      part = { material: obj.catalogId, pattern, mesh: { ...emptyMesh(), alpha: [], uv: [] } };
      parts.set(obj.catalogId, part); out.push(part);
    }
    const m = part.mesh, base = m.positions.length / 3;
    const offset = offsets?.get(obj.id);
    const x = origin.x + obj.position.x + (offset?.dx ?? 0), z = origin.z + obj.position.y + (offset?.dz ?? 0);
    const y = coatingSurfaceY(state, obj);
    const angle = -obj.rotation * Math.PI / 180, c = Math.cos(angle), s = Math.sin(angle);
    for (const [u, v] of [[0, 0], [0, 1], [1, 1], [1, 0]]) {
      m.positions.push(x + u!, y, z + v!); m.colors.push(1, 1, 1); m.alpha!.push(1);
      m.uv!.push((u! - .5) * c - (v! - .5) * s + .5, (u! - .5) * s + (v! - .5) * c + .5);
    }
    m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  return out;
}
