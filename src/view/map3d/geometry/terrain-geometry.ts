/**
 * Pure terrain mesher: GridState → three MeshData blobs (solid mountains, ground
 * slabs, translucent water). No three.js — emits flat vertex arrays that the terrain layer
 * wraps into BufferGeometry.
 *
 * Performance: per-cell columns merge into one geometry per material; side walls
 * use exposed-face culling (a wall toward a neighbor is emitted only when this
 * column is taller than that neighbor's mountain mass).
 */
import { TerrainType, type GridState, type CornerTrim, type Corners, type TerrainCell } from '../../../core/model/types';
import type { CellZone } from '../../../core/game/zones';
import { getCell } from '../../../core/model/grid-model';
import { mapFrame } from '../../../core/grid/map-chunks';
import { solidTopOf } from '../../../core/domain/terrain/terrain-surface';
import type { CornerPos } from '../../../core/model/corners';
import { patchCornerSplit } from '../../shared/terrain/patch-split';
import { cutBackingByCorner } from '../../shared/terrain/cut-backing';
import { cornerComplement, cornerPolygon, type Pt } from '../../shared/terrain/quadrant-poly';
import { groundWaterSurfaces } from './ground-water';
import { GROUND_SLAB_Y, SEA_Y, cellCornerWorld, layerToY, waterSurfaceY, zoneSurface } from './coords';
import { terrainColor, zoneColor, waterColor, hexToRgb01, type Rgb } from '../draw/palette';
import type { MeshData, TerrainMeshes } from './types';
import { emptyMesh, pushPolyTop, quad } from './mesh-emit';
import { bucketSpan } from '../../../core/grid/buckets';
import { PLACEMENT_GRID, TERRAIN_GRID } from '../../../core/game/profile';

const SLAB = GROUND_SLAB_Y; // land-slab top height (shared: object placement stands on it)
const GROUND_BOTTOM = -0.4; // shoreline skirt depth — gives the coast underground body
const FALL_MIN = 0.5;       // water faces taller than this are cascades (animated), not rims
const SEA_FLOOR = -0.28;    // opaque deep-sea floor → the sea reads as having volume/thickness
const FALL_SEGMENTS = 10;   // vertical subdivisions of a waterfall face (animation resolution)
const DEEP_SEA: Rgb = hexToRgb01('#3f9ec9'); // deeper blue beneath the translucent sea surface

/** A vertical water face. For waterfall/cliff faces (fallMode) it's subdivided
 *  into FALL_SEGMENTS stacked quads so the cascade animation has resolution; a
 *  short rim is a single quad. b1/b2 are the bottom-edge corners (x,z). */
function wallFace(m: MeshData, fallMode: boolean, edge: readonly [Pt, Pt], yTop: number, col: Rgb): void {
  const [b1, b2] = edge;
  const bottom = waterSurfaceY(0);
  if (yTop <= bottom) return;
  if (!fallMode) {
    quad(m, [[b1[0], bottom, b1[1]], [b2[0], bottom, b2[1]], [b2[0], yTop, b2[1]], [b1[0], yTop, b1[1]]], col);
    return;
  }
  for (let r = 0; r < FALL_SEGMENTS; r++) {
    const ylo = bottom + ((yTop - bottom) * r) / FALL_SEGMENTS, yhi = bottom + ((yTop - bottom) * (r + 1)) / FALL_SEGMENTS;
    quad(m, [[b1[0], ylo, b1[1]], [b2[0], ylo, b2[1]], [b2[0], yhi, b2[1]], [b1[0], yhi, b1[1]]], col);
  }
}

/** A vertical wall from a top edge (p1→p2 at `yTop`) down to the ground. */
function pushWall(m: MeshData, p1: Pt, p2: Pt, yTop: number, col: Rgb): void {
  quad(m, [[p1[0], 0, p1[1]], [p2[0], 0, p2[1]], [p2[0], yTop, p2[1]], [p1[0], yTop, p1[1]]], col);
}

/** Per-corner cut backing shaped to the cut-away region (`cornerComplement`) — the one 3D mirror of the 2D
 *  drawCell backing (`cutBackingByCorner`). A cut reveals the lower tier / water / patch base behind the
 *  trimmed corner; drawing it only in the rounded-off region (not a full quadrant) is what keeps a
 *  translucent water reveal from showing through and covering the kept fan as a whole block, and matches
 *  2D exactly (there the opaque kept shape, painted over a full-rect backing, leaves only the cut-away
 *  visible). A revealed mountain step is a shaped cap with a wall for body; a revealed water level is a
 *  shaped surface with a culled shore wall. */
function pushRevealBacking(
  meshes: { solid: MeshData; water: MeshData }, terrain: TerrainCell, renderTier: number,
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  at: { x0: number; z0: number },
): void {
  const { solid, water } = meshes;
  const { x0, z0 } = at;
  const backs = cutBackingByCorner(terrain, renderTier, neighborAt);
  const quads: ReadonlyArray<readonly [CornerTrim, number, number, CornerPos]> = [
    [terrain.corners![0]!, x0, z0, 'TL'], [terrain.corners![1]!, x0 + 0.5, z0, 'TR'],
    [terrain.corners![2]!, x0, z0 + 0.5, 'BL'], [terrain.corners![3]!, x0 + 0.5, z0 + 0.5, 'BR'],
  ];
  const x1c = x0 + 1, z1c = z0 + 1;
  const nWater = (dx: number, dy: number) => neighborAt(dx, dy)?.type === TerrainType.Water;
  for (let i = 0; i < 4; i++) {
    const b = backs[i];
    if (!b) continue;
    const [trim, ox, oz, pos] = quads[i]!;
    const poly = cornerComplement(trim, { x: ox, z: oz, s: 0.5, pos }, false);
    if (!poly) continue;
    if (b.type === TerrainType.Mountain) {
      const y = layerToY(b.elevation);
      pushPolyTop(solid, poly, y, terrainColor(b.elevation));
      for (let k = 0; k < poly.length; k++) pushWall(solid, poly[k]!, poly[(k + 1) % poly.length]!, y, terrainColor(b.elevation));
    } else {
      const wc = waterColor();
      const foam: Rgb = [wc[0] + (1 - wc[0]) * 0.5, wc[1] + (1 - wc[1]) * 0.5, wc[2] + (1 - wc[2]) * 0.5];
      const y = waterSurfaceY(b.elevation);
      pushPolyTop(water, poly, y, wc);
      for (let k = 0; k < poly.length; k++) {
        const p1 = poly[k]!, p2 = poly[(k + 1) % poly.length]!;
        const on = (a: number, b2: number, v: number) => Math.abs(a - v) < 1e-6 && Math.abs(b2 - v) < 1e-6;
        let interior = false;
        if (on(p1[0], p2[0], x0)) interior = nWater(-1, 0);
        else if (on(p1[0], p2[0], x1c)) interior = nWater(1, 0);
        else if (on(p1[1], p2[1], z0)) interior = nWater(0, -1);
        else if (on(p1[1], p2[1], z1c)) interior = nWater(0, 1);
        if (!interior) wallFace(water, false, [p1, p2], y, foam);
      }
    }
  }
}

/** The four independently-trimmed quadrants (TL,TR,BL,BR) of a cell as kept caps at `yTop` + walls down to
 *  the ground (mirrors trim-shapes). `patchOnly` flips the fan/tri to the inner (notch-fill) winding. */
function pushBevelQuads(
  m: MeshData, corners: readonly CornerTrim[], at: { x0: number; z0: number }, top: { y: number; col: Rgb }, patchOnly: boolean,
): void {
  const { x0, z0 } = at;
  const { y: yTop, col } = top;
  const mx = x0 + 0.5, mz = z0 + 0.5;
  const quads: ReadonlyArray<readonly [CornerTrim, number, number, CornerPos]> = [
    [corners[0]!, x0, z0, 'TL'], [corners[1]!, mx, z0, 'TR'], [corners[2]!, x0, mz, 'BL'], [corners[3]!, mx, mz, 'BR'],
  ];
  for (const [trim, ox, oz, pos] of quads) {
    const poly = cornerPolygon(trim, { x: ox, z: oz, s: 0.5, pos }, patchOnly);
    if (!poly) continue;
    pushPolyTop(m, poly, yTop, col);
    for (let k = 0; k < poly.length; k++) pushWall(m, poly[k]!, poly[(k + 1) % poly.length]!, yTop, col);
  }
}

/** Mountain mass top of the cell at (x,y), or 0 if none. */
function mtnTop(state: GridState, x: number, y: number): number {
  const t = getCell(state.cells, x, y)?.terrain;
  return t && t.type === TerrainType.Mountain ? solidTopOf(t, TerrainType.Mountain) : 0;
}

/** Water mass top of the cell at (x,y), or 0 if none. */
function waterTop(state: GridState, x: number, y: number): number {
  const t = getCell(state.cells, x, y)?.terrain;
  return t && t.type === TerrainType.Water ? solidTopOf(t, TerrainType.Water) : 0;
}

export function buildTerrainMeshes(state: GridState): TerrainMeshes {
  const { width, height } = state.template;
  return buildRegion(state, 0, 0, width, height);
}

/** Terrain meshes for one storage bucket (`BUCKET_SIZE` square). Cells read their neighbors
 *  through GridState (never sibling meshes), so a chunk meshes identically
 *  whether built alone or as part of the whole map — the editor rebuilds only
 *  dirty chunks after an edit. Out-of-map chunks are empty. */
export function buildChunkTerrain(state: GridState, cx: number, cy: number): TerrainMeshes {
  const { width, height } = state.template;
  const { x0, y0, x1, y1 } = bucketSpan(cx, cy, width, height);
  if (cx < 0 || cy < 0 || x0 >= width || y0 >= height) {
    return { solid: emptyMesh(), ground: emptyMesh(), water: emptyMesh(), fall: emptyMesh() };
  }
  return buildRegion(state, x0, y0, x1, y1);
}

/** Four sea strips complete the reference grid without adding cells to the saved map. */
export function buildSeaFrame(state: GridState): Pick<TerrainMeshes, 'ground' | 'water'> {
  const { width, height } = state.template;
  const frame = mapFrame(state.template);
  const ground = emptyMesh(), water = emptyMesh();
  if (!state.template.chunkGrid) return { ground, water };
  const left = frame.x, top = frame.y;
  const right = frame.x + frame.width, bottom = frame.y + frame.height;
  const wc = waterColor();
  const origin = cellCornerWorld(0, 0, width, height, PLACEMENT_GRID);
  const strip = (x0: number, y0: number, x1: number, y1: number): void => {
    if (x1 <= x0 || y1 <= y0) return;
    const l = x0 + origin.x, r = x1 + origin.x, t = y0 + origin.z, b = y1 + origin.z;
    quad(water, [[l, SEA_Y, t], [l, SEA_Y, b], [r, SEA_Y, b], [r, SEA_Y, t]], wc);
    quad(ground, [[l, SEA_FLOOR, b], [l, SEA_FLOOR, t], [r, SEA_FLOOR, t], [r, SEA_FLOOR, b]], DEEP_SEA);
  };
  strip(left, top, right, 0);
  strip(left, height, right, bottom);
  strip(left, 0, 0, height);
  strip(width, 0, right, height);
  return { ground, water };
}

/** What every emitter of one region writes into and reads beside the cell. */
interface Region {
  state: GridState;
  frame: ReturnType<typeof mapFrame>;
  riverbed: ReturnType<typeof groundWaterSurfaces>;
  solid: MeshData; ground: MeshData; water: MeshData; fall: MeshData;
}

/** One cell's corners: (gx0, gz0) on the object grid, where zones lie, and (x0, z0) on the terrain
 *  grid, where mountains and water lie. */
interface CellAt { x: number; y: number; gx0: number; gz0: number; x0: number; z0: number }

/** The terrain of the cell `dx`, `dy` from (x, y), as the cut backing asks it. */
const neighborsOf = (state: GridState, x: number, y: number) =>
  (dx: number, dy: number): TerrainCell | null | undefined => getCell(state.cells, x + dx, y + dy)?.terrain;

/** The foam tint of a water face: the water colour halfway to white, so the falling side of a
 *  waterfall reads clearly against the flat top. */
function foamOf(wc: Rgb): Rgb {
  return [wc[0] + (1 - wc[0]) * 0.5, wc[1] + (1 - wc[1]) * 0.5, wc[2] + (1 - wc[2]) * 0.5];
}

/** Whether the cell at (nx, ny) is sea or off the map. */
function voidAt(state: GridState, nx: number, ny: number): boolean {
  const c = getCell(state.cells, nx, ny);
  return !c || zoneSurface(c.zone) === 'sea';
}

/** The land slab of a cell, cut by the riverbed where ground water runs, with an underground skirt
 *  on its void-facing sides. */
function emitLand(r: Region, zone: CellZone, at: CellAt): void {
  const { state, ground, riverbed } = r;
  const { x, y, gx0, gz0 } = at;
  const gx1 = gx0 + 1, gz1 = gz0 + 1;
  const zc = zoneColor(zone);
  const pieces = riverbed.pieces(x, y);
  if (!pieces) {
    quad(ground, [[gx0, SLAB, gz0], [gx0, SLAB, gz1], [gx1, SLAB, gz1], [gx1, SLAB, gz0]], zc);
  } else for (const piece of pieces) {
    const wet = piece.y < SLAB;
    const floor = wet ? SEA_FLOOR : SLAB;
    pushPolyTop(ground, piece.poly, floor, wet ? DEEP_SEA : zc);
    if (!wet) continue;
    for (let i = 0; i < piece.poly.length; i++) {
      const a = piece.poly[i]!, b = piece.poly[(i + 1) % piece.poly.length]!;
      const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
      if (length < 1e-8) continue;
      const mx = (a[0] + b[0]) / 2, mz = (a[1] + b[1]) / 2;
      const nx = dz / length * 1e-5, nz = -dx / length * 1e-5;
      const right = riverbed.submergedAt(mx + nx, mz + nz), left = riverbed.submergedAt(mx - nx, mz - nz);
      if (left === right) continue;
      const [p, q] = left ? [a, b] : [b, a];
      quad(ground, [[p[0], floor, p[1]], [q[0], floor, q[1]], [q[0], SLAB, q[1]], [p[0], SLAB, p[1]]], zc);
    }
  }
  // Underground skirt where land meets the sea (or the map edge): a solid wall down to
  // GROUND_BOTTOM so the shoreline has body and the transition to void hides the edge at grazing
  // camera angles. Only the exposed (void-facing) sides.
  if (voidAt(state, x - 1, y)) quad(ground, [[gx0, GROUND_BOTTOM, gz1], [gx0, GROUND_BOTTOM, gz0], [gx0, SLAB, gz0], [gx0, SLAB, gz1]], zc);
  if (voidAt(state, x + 1, y)) quad(ground, [[gx1, GROUND_BOTTOM, gz0], [gx1, GROUND_BOTTOM, gz1], [gx1, SLAB, gz1], [gx1, SLAB, gz0]], zc);
  if (voidAt(state, x, y - 1)) quad(ground, [[gx0, GROUND_BOTTOM, gz0], [gx1, GROUND_BOTTOM, gz0], [gx1, SLAB, gz0], [gx0, SLAB, gz0]], zc);
  if (voidAt(state, x, y + 1)) quad(ground, [[gx1, GROUND_BOTTOM, gz1], [gx0, GROUND_BOTTOM, gz1], [gx0, SLAB, gz1], [gx1, SLAB, gz1]], zc);
}

/** Whether (nx, ny) lies outside the map frame. */
function outsideFrame(frame: Region['frame'], nx: number, ny: number): boolean {
  return nx < frame.x || ny < frame.y || nx >= frame.x + frame.width || ny >= frame.y + frame.height;
}

/** A sea cell: a translucent surface over an opaque deep floor, so the sea has visible volume
 *  rather than a paper-thin sheet, and translucent walls floor to surface at the map frame. */
function emitSea(r: Region, at: CellAt): void {
  const { ground, water, frame } = r;
  const { x, y, gx0, gz0 } = at;
  const gx1 = gx0 + 1, gz1 = gz0 + 1;
  const wc = waterColor();
  quad(water, [[gx0, SEA_Y, gz0], [gx0, SEA_Y, gz1], [gx1, SEA_Y, gz1], [gx1, SEA_Y, gz0]], wc);
  quad(ground, [[gx0, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz1]], DEEP_SEA);
  if (outsideFrame(frame, x - 1, y)) quad(water, [[gx0, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz0], [gx0, SEA_Y, gz0], [gx0, SEA_Y, gz1]], wc);
  if (outsideFrame(frame, x + 1, y)) quad(water, [[gx1, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz1], [gx1, SEA_Y, gz1], [gx1, SEA_Y, gz0]], wc);
  if (outsideFrame(frame, x, y - 1)) quad(water, [[gx0, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz0], [gx1, SEA_Y, gz0], [gx0, SEA_Y, gz0]], wc);
  if (outsideFrame(frame, x, y + 1)) quad(water, [[gx1, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz1], [gx0, SEA_Y, gz1], [gx1, SEA_Y, gz1]], wc);
}

/** Strata walls on the side `edge` ((ax, az) to (bx, bz)) of a square column, from the
 *  neighbour's mountain top `nTop` to `top`: one band per layer, so the wedding-cake elevation
 *  reads on the wall. */
function emitStrata(solid: MeshData, nTop: number, top: number, edge: readonly [number, number, number, number]): void {
  const [ax, az, bx, bz] = edge;
  for (let e = nTop + 1; e <= top; e++) {
    const yb = layerToY(e - 1), yt = layerToY(e);
    quad(solid, [[ax, yb, az], [bx, yb, bz], [bx, yt, bz], [ax, yt, az]], terrainColor(e));
  }
}

/** A mountain column. A Γ patch renders at its fillet tier (its structural top is its lower base). */
function emitMountain(r: Region, t: TerrainCell, at: CellAt): void {
  const { state, solid } = r;
  const { x, y, x0, z0 } = at;
  const top = t.patchOnly ? t.elevation : solidTopOf(t, TerrainType.Mountain);
  if (top <= 0) return;
  const yTop = layerToY(top);
  const trimmed = t.corners && t.corners.some((c) => c !== 'square');

  if (!trimmed) {
    // Fast path (square cells, the majority): square top + per-layer strata walls, exposed-face
    // culled against each neighbour's mountain top.
    const x1 = x0 + 1, z1 = z0 + 1;
    quad(solid, [[x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0]], terrainColor(top));
    emitStrata(solid, mtnTop(state, x - 1, y), top, [x0, z1, x0, z0]);
    emitStrata(solid, mtnTop(state, x + 1, y), top, [x1, z0, x1, z1]);
    emitStrata(solid, mtnTop(state, x, y - 1), top, [x0, z0, x1, z0]);
    emitStrata(solid, mtnTop(state, x, y + 1), top, [x1, z1, x0, z1]);
    return;
  }

  // Bevel path (trimmed cells): honour the 2D edge-cut trims — four independently-trimmed quadrants
  // (square / triangle / fan / empty) matching trim-shapes.ts, each walled down to the ground.
  const col = terrainColor(top);
  const neighborAt = neighborsOf(state, x, y);
  if (t.patchOnly) {
    // Per corner (the shared patchCornerSplit derivation, same as 2D drawCell): base block +
    // fillets as two passes — the fillet walls sink into the solid base, so the overlap with its
    // ordinary ground walls never shows.
    const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, t);
    if (baseTier >= 1) {
      pushRevealBacking(r, { ...t, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborAt, { x0, z0 });
      pushBevelQuads(solid, baseCorners, { x0, z0 }, { y: layerToY(baseTier), col: terrainColor(baseTier) }, false);
    }
    pushBevelQuads(solid, filletCorners, { x0, z0 }, { y: yTop, col }, true);
    return;
  }
  // Back each cut corner with the lower step / water it reveals — shaped to the cut-away region so
  // a revealed (translucent) water level fills only the rounded corner, never a full quadrant that
  // covers the mountain fan and reads as a whole water block over hidden terrain.
  pushRevealBacking(r, t, top, neighborAt, { x0, z0 });
  pushBevelQuads(solid, t.corners!, { x0, z0 }, { y: yTop, col }, false);
}

/** A full-square water body at `tier`: surface + the 4 cell-side rims, each culled against that
 *  side's water neighbour. */
function emitSquareWater(r: Region, at: CellAt, tier: number): void {
  const { state, water, fall } = r;
  const { x, y, x0, z0 } = at;
  const x1 = x0 + 1, z1 = z0 + 1;
  const wc = waterColor();
  const foam = foamOf(wc);
  const yTop = waterSurfaceY(tier);
  const fallMode = yTop >= FALL_MIN;
  const sideMesh = fallMode ? fall : water;
  quad(water, [[x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0]], wc);
  if (tier > waterTop(state, x - 1, y)) wallFace(sideMesh, fallMode, [[x0, z1], [x0, z0]], yTop, foam);
  if (tier > waterTop(state, x + 1, y)) wallFace(sideMesh, fallMode, [[x1, z0], [x1, z1]], yTop, foam);
  if (tier > waterTop(state, x, y - 1)) wallFace(sideMesh, fallMode, [[x0, z0], [x1, z0]], yTop, foam);
  if (tier > waterTop(state, x, y + 1)) wallFace(sideMesh, fallMode, [[x1, z1], [x0, z1]], yTop, foam);
}

/**
 * Trimmed water quadrants at `tier`: kept surfaces + walls on the surviving outline, from `yBottom`
 * up — a fillet pass starts at the base's surface so translucent bodies never overlap. Inner fans
 * for a fillet, outer fans for a real cut.
 *
 * The wall outline is recovered by edge cancellation: a straight edge shared by two kept quadrants
 * is interior water (drawn from both, it cancels), so only the true outline survives — cell-side
 * rims (culled against that side's water, exactly like the square body) and the diagonal or curved
 * cut faces that open onto whatever the trim reveals (a mountain rim, a lower lake, the sea), which
 * are always shown. The DoubleSide water material makes the per-face winding irrelevant.
 */
function emitTrimmedWater(r: Region, at: CellAt, pass: { tier: number; corners: Corners; innerFans: boolean; yBottom: number }): void {
  const { tier, corners, innerFans, yBottom } = pass;
  const { state, water, fall } = r;
  const { x, y, x0, z0 } = at;
  const x1 = x0 + 1, z1 = z0 + 1, mx = x0 + 0.5, mz = z0 + 0.5;
  const wc = waterColor();
  const foam = foamOf(wc);
  const yTop = waterSurfaceY(tier);
  const fallMode = yTop >= FALL_MIN;
  const sideMesh = fallMode ? fall : water;
  const quads: ReadonlyArray<readonly [CornerTrim, number, number, CornerPos]> = [
    [corners[0]!, x0, z0, 'TL'],
    [corners[1]!, mx, z0, 'TR'],
    [corners[2]!, x0, mz, 'BL'],
    [corners[3]!, mx, mz, 'BR'],
  ];
  const edges = new Map<string, readonly [Pt, Pt]>();
  const ekey = (a: Pt, b: Pt) => `${a[0]},${a[1]}|${b[0]},${b[1]}`;
  for (const [trim, ox, oz, pos] of quads) {
    const poly = cornerPolygon(trim, { x: ox, z: oz, s: 0.5, pos }, innerFans);
    if (!poly) continue;
    pushPolyTop(water, poly, yTop, wc);
    for (let k = 0; k < poly.length; k++) {
      const p1 = poly[k]!, p2 = poly[(k + 1) % poly.length]!;
      const rev = ekey(p2, p1);
      if (edges.has(rev)) edges.delete(rev); // shared with a sibling quadrant → interior, cancel
      else edges.set(ekey(p1, p2), [p1, p2]);
    }
  }
  for (const [p1, p2] of edges.values()) {
    // A surviving edge on a cell side is a rim, culled against that side's water neighbour.
    // Everything else (a mid-line edge exposed by an empty sibling, a triangle hypotenuse, a fan
    // arc) is a cut face and always shown.
    let nTop: number | null = null;
    if (p1[0] === x0 && p2[0] === x0) nTop = waterTop(state, x - 1, y);
    else if (p1[0] === x1 && p2[0] === x1) nTop = waterTop(state, x + 1, y);
    else if (p1[1] === z0 && p2[1] === z0) nTop = waterTop(state, x, y - 1);
    else if (p1[1] === z1 && p2[1] === z1) nTop = waterTop(state, x, y + 1);
    if (nTop !== null && tier <= nTop) continue;
    if (yBottom > 0) {
      quad(sideMesh, [[p1[0], yBottom, p1[1]], [p2[0], yBottom, p2[1]], [p2[0], yTop, p2[1]], [p1[0], yTop, p1[1]]], foam);
    } else {
      wallFace(sideMesh, fallMode, [p1, p2], yTop, foam);
    }
  }
}

/** Water terrain (lakes, rivers, waterfalls): a translucent body from the lowest waterline to its
 *  tier, side walls exposed-face culled against neighbouring water so the translucent interior
 *  faces never double up into dark seams. */
function emitWater(r: Region, t: TerrainCell, at: CellAt): void {
  const { state } = r;
  const { x, y, x0, z0 } = at;
  // Γ patch: the 2D drawCell split (cellRenderSpec) — a real water base body only when its support
  // tier is a real elevated pool (baseTier >= 1), plus the wrapped corner's fillet at the cell's
  // tier. A cosmetic gamma over ground (baseTier < 1) draws no base, just the fillet over the grass
  // floor, exactly like 2D, so the empty corners stay grass. The fillet body spans baseTop to
  // filletTop so translucent volumes never double up.
  if (t.patchOnly) {
    const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, t);
    const hasBase = baseTier >= 1;
    if (hasBase) {
      if (baseCorners.some((c) => c !== 'square')) {
        pushRevealBacking(r, { ...t, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborsOf(state, x, y), { x0, z0 });
        emitTrimmedWater(r, at, { tier: baseTier, corners: baseCorners, innerFans: false, yBottom: 0 });
      } else {
        emitSquareWater(r, at, baseTier);
      }
    }
    emitTrimmedWater(r, at, { tier: t.elevation, corners: filletCorners, innerFans: true, yBottom: hasBase ? waterSurfaceY(baseTier) : 0 });
    return;
  }
  const top = solidTopOf(t, TerrainType.Water);
  if (!(t.corners && t.corners.some((c) => c !== 'square'))) {
    emitSquareWater(r, at, top);
    return;
  }
  // Back each cut corner with the surface it reveals — the mountain bank behind a cut water corner,
  // or the lower water behind a cut mountain corner — so a water cut that rounds toward land shows
  // the land filling behind it, never a hole (mirrors view/shared/terrain/cut-backing.ts).
  pushRevealBacking(r, t, top, neighborsOf(state, x, y), { x0, z0 });
  emitTrimmedWater(r, at, { tier: top, corners: t.corners!, innerFans: false, yBottom: 0 });
}

function buildRegion(state: GridState, rx0: number, ry0: number, rx1: number, ry1: number): TerrainMeshes {
  const { width, height } = state.template;
  const r: Region = {
    state, frame: mapFrame(state.template), riverbed: groundWaterSurfaces(state),
    solid: emptyMesh(), ground: emptyMesh(), water: emptyMesh(), fall: emptyMesh(),
  };
  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const cell = getCell(state.cells, x, y);
      if (!cell) continue;
      const c0 = cellCornerWorld(x, y, width, height, PLACEMENT_GRID);
      const t0 = cellCornerWorld(x, y, width, height, TERRAIN_GRID);
      const at: CellAt = { x, y, gx0: c0.x, gz0: c0.z, x0: t0.x, z0: t0.z };
      if (zoneSurface(cell.zone) === 'land') emitLand(r, cell.zone, at);
      else emitSea(r, at);
      const t = cell.terrain;
      if (!t) continue;
      // A ground-islet cut shares the pool's shifted terrain grid: the slab cut follows the same
      // complement as the recessed water reveal.
      if (t.type === TerrainType.None && !!t.corners && t.corners.some((c) => c !== 'square')) {
        pushRevealBacking(r, t, 0, neighborsOf(state, x, y), { x0: at.x0, z0: at.z0 });
      } else if (t.type === TerrainType.Mountain) emitMountain(r, t, at);
      else if (t.type === TerrainType.Water) emitWater(r, t, at);
    }
  }
  return { solid: r.solid, ground: r.ground, water: r.water, fall: r.fall };
}
