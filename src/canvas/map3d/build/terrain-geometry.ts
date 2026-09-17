/**
 * PURE terrain mesher: GridState → three MeshData blobs (solid mountains, ground
 * slabs, translucent water). No three.js — emits flat vertex arrays that scene.ts
 * wraps into BufferGeometry.
 *
 * Performance: per-cell columns merge into ONE geometry per material; side walls
 * use exposed-face culling (a wall toward a neighbor is emitted only when this
 * column is taller than that neighbor's mountain mass).
 */
import { CHUNK_SIZE } from '../../../core/model/constants';
import { CellZone, ItemCategory, TerrainType, type GridState, type CornerTrim, type Corners, type PlacedObject, type TerrainCell } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { solidTopOf } from '../../../core/edge-cut/terrain-silhouette';
import type { CornerPos } from '../../../core/edge-cut/corner-index';
import { patchCornerSplit } from '../../../core/edge-cut/patch-corners';
import earcut from 'earcut';
import { ROAD_FEATHER, roadBodyPoints } from '../../../core/edge-cut/road-shape';
import { buildRoadRegions } from '../../../core/edge-cut/road-region';
import { objectElevation } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { cutBackingByCorner } from '../../../core/edge-cut/cut-backing';
import { cornerComplement, cornerPolygon, type Pt } from './quadrant-poly';
import { GROUND_SLAB_Y, SEA_Y, cellCornerWorld, layerToY, surfaceY, waterSurfaceY, TERRAIN_OFFSET } from '../core/coords';
import { terrainColor, zoneColor, waterColor, hexToRgb01, objectColor, type Rgb } from '../core/palette';
import type { MeshData, TerrainMeshes } from '../core/types';

const SLAB = GROUND_SLAB_Y; // land-slab top height (shared: object placement stands on it)
const GROUND_BOTTOM = -0.4; // shoreline skirt depth — gives the coast underground body
const FALL_MIN = 0.5;       // water faces taller than this are cascades (animated), not rims
const SEA_FLOOR = -0.28;    // opaque deep-sea floor → the sea reads as having volume/thickness
const FALL_SEGMENTS = 10;   // vertical subdivisions of a waterfall face (animation resolution)
const DEEP_SEA: Rgb = hexToRgb01('#3f9ec9'); // deeper blue beneath the translucent sea surface

/** A vertical water face. For waterfall/cliff faces (fallMode) it's subdivided
 *  into FALL_SEGMENTS stacked quads so the cascade animation has resolution; a
 *  short rim is a single quad. b1/b2 are the bottom-edge corners (x,z). */
function wallFace(m: MeshData, fallMode: boolean, b1: Pt, b2: Pt, yTop: number, col: Rgb): void {
  if (!fallMode) {
    quad(m, [b1[0], 0, b1[1]], [b2[0], 0, b2[1]], [b2[0], yTop, b2[1]], [b1[0], yTop, b1[1]], col);
    return;
  }
  for (let r = 0; r < FALL_SEGMENTS; r++) {
    const ylo = (yTop * r) / FALL_SEGMENTS, yhi = (yTop * (r + 1)) / FALL_SEGMENTS;
    quad(m, [b1[0], ylo, b1[1]], [b2[0], ylo, b2[1]], [b2[0], yhi, b2[1]], [b1[0], yhi, b1[1]], col);
  }
}

type Vec3 = [number, number, number];

/** Append a quad (4 corners, CCW seen from outside) with one flat colour. */
function quad(m: MeshData, a: Vec3, b: Vec3, c: Vec3, d: Vec3, col: Rgb): void {
  const base = m.positions.length / 3;
  for (const p of [a, b, c, d]) { m.positions.push(p[0], p[1], p[2]); m.colors.push(col[0], col[1], col[2]); }
  m.index.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function empty(): MeshData { return { positions: [], colors: [], index: [] }; }

/** Twice the signed XZ area of a triangle — 0 means it cannot draw. A zero-area triangle is
 *  never EMITTED here: the rasterizer's edge tests can disagree about one and leak lone samples
 *  (collinear slivers rendered as isolated bright pixels). */
function area2(a: Pt, b: Pt, c: Pt): number {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

/** Fan-triangulate a top polygon (XZ points) at world height `y`. The polygon must be visible
 *  whole from its FIRST vertex (convex, or star-shaped from there — `RoadFeed` polygons lead
 *  with their star vertex for exactly this): a fan across a concave stretch overdraws it. */
function pushPolyTop(m: MeshData, pts: Pt[], y: number, col: Rgb): void {
  const base = m.positions.length / 3;
  for (const [px, pz] of pts) { m.positions.push(px, y, pz); m.colors.push(col[0], col[1], col[2]); }
  for (let i = 1; i < pts.length - 1; i++) {
    if (area2(pts[0]!, pts[i]!, pts[i + 1]!) === 0) continue;
    m.index.push(base, base + i, base + i + 1);
  }
}

/** A vertical wall from a top edge (p1→p2 at `yTop`) down to the ground. */
function pushWall(m: MeshData, p1: Pt, p2: Pt, yTop: number, col: Rgb): void {
  quad(m, [p1[0], 0, p1[1]], [p2[0], 0, p2[1]], [p2[0], yTop, p2[1]], [p1[0], yTop, p1[1]], col);
}

/** Per-corner cut backing SHAPED to the cut-away region (`cornerComplement`) — the ONE 3D mirror of the 2D
 *  drawCell backing (`cutBackingByCorner`). A cut reveals the lower tier / water / patch base behind the
 *  trimmed corner; drawing it only in the rounded-off region (not a full quadrant) is what keeps a
 *  translucent WATER reveal from showing through and covering the kept fan as a whole block, and matches
 *  2D exactly (there the opaque kept shape, painted over a full-rect backing, leaves only the cut-away
 *  visible). A revealed mountain step is a shaped cap with a wall for body; a revealed water level is a
 *  shaped surface with a culled shore wall. */
function pushRevealBacking(
  solid: MeshData, water: MeshData, terrain: TerrainCell, renderTier: number,
  neighborAt: (dx: number, dy: number) => TerrainCell | null | undefined,
  x0: number, z0: number,
): void {
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
    const poly = cornerComplement(trim, ox, oz, 0.5, pos, false);
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
        if (!interior) wallFace(water, false, p1, p2, y, foam);
      }
    }
  }
}

/** The four independently-trimmed quadrants (TL,TR,BL,BR) of a cell as kept caps at `yTop` + walls down to
 *  the ground (mirrors trim-shapes). `patchOnly` flips the fan/tri to the INNER (notch-fill) winding. */
function pushBevelQuads(m: MeshData, corners: readonly CornerTrim[], x0: number, z0: number, yTop: number, col: Rgb, patchOnly: boolean): void {
  const mx = x0 + 0.5, mz = z0 + 0.5;
  const quads: ReadonlyArray<readonly [CornerTrim, number, number, CornerPos]> = [
    [corners[0]!, x0, z0, 'TL'], [corners[1]!, mx, z0, 'TR'], [corners[2]!, x0, mz, 'BL'], [corners[3]!, mx, mz, 'BR'],
  ];
  for (const [trim, ox, oz, pos] of quads) {
    const poly = cornerPolygon(trim, ox, oz, 0.5, pos, patchOnly);
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

/** Terrain meshes for one CHUNK_SIZE-square chunk. Cells read their neighbors
 *  through GridState (never sibling meshes), so a chunk meshes identically
 *  whether built alone or as part of the whole map — the editor rebuilds only
 *  dirty chunks after an edit. Out-of-map chunks are empty. */
export function buildChunkTerrain(state: GridState, cx: number, cy: number): TerrainMeshes {
  const { width, height } = state.template;
  const x0 = cx * CHUNK_SIZE, y0 = cy * CHUNK_SIZE;
  if (cx < 0 || cy < 0 || x0 >= width || y0 >= height) {
    return { solid: empty(), ground: empty(), water: empty(), fall: empty() };
  }
  return buildRegion(state, x0, y0, Math.min(x0 + CHUNK_SIZE, width), Math.min(y0 + CHUNK_SIZE, height));
}

function buildRegion(state: GridState, rx0: number, ry0: number, rx1: number, ry1: number): TerrainMeshes {
  const { width, height } = state.template;
  const solid = empty();
  const ground = empty();
  const water = empty();
  const fall = empty();

  for (let y = ry0; y < ry1; y++) {
    for (let x = rx0; x < rx1; x++) {
      const cell = getCell(state.cells, x, y);
      if (!cell) continue;
      const c0 = cellCornerWorld(x, y, width, height);
      // Zones + objects sit on the MACRO grid (gx0..); terrain (mountains/water) is
      // shifted by TERRAIN_OFFSET to the micro grid (x0..), mirroring 2D's −HALF_TILE.
      const gx0 = c0.x, gz0 = c0.z, gx1 = gx0 + 1, gz1 = gz0 + 1;
      const x0 = gx0 + TERRAIN_OFFSET, z0 = gz0 + TERRAIN_OFFSET, x1 = x0 + 1, z1 = z0 + 1;

      // A GROUND-ISLET cut (type None + corners): a grass corner poking into water (an islet tip, or
      // the concave inner corner of an L-shaped pool). Like 2D, the full macro zone floor stays and the
      // cut only reveals water at the trimmed corner — drawn on the MICRO terrain grid so it aligns with
      // the pool, not a half-cell off.
      const isCutGround = cell.terrain?.type === TerrainType.None
        && !!cell.terrain.corners && cell.terrain.corners.some((c) => c !== 'square');

      // ── ground slab (every non-Void cell) / sea quad (Void) — MACRO grid ──
      if (cell.zone !== CellZone.Void) {
        const zc = zoneColor(cell.zone);
        quad(ground, [gx0, SLAB, gz0], [gx0, SLAB, gz1], [gx1, SLAB, gz1], [gx1, SLAB, gz0], zc);
        // Underground SKIRT where land meets the sea (or the map edge): a solid
        // wall down to GROUND_BOTTOM so the shoreline has body and the transition
        // to void hides the edge at grazing camera angles. Only the exposed (void-facing) sides.
        const voidSide = (nx: number, ny: number) => {
          const c = getCell(state.cells, nx, ny);
          return !c || c.zone === CellZone.Void;
        };
        if (voidSide(x - 1, y)) quad(ground, [gx0, GROUND_BOTTOM, gz1], [gx0, GROUND_BOTTOM, gz0], [gx0, SLAB, gz0], [gx0, SLAB, gz1], zc);
        if (voidSide(x + 1, y)) quad(ground, [gx1, GROUND_BOTTOM, gz0], [gx1, GROUND_BOTTOM, gz1], [gx1, SLAB, gz1], [gx1, SLAB, gz0], zc);
        if (voidSide(x, y - 1)) quad(ground, [gx0, GROUND_BOTTOM, gz0], [gx1, GROUND_BOTTOM, gz0], [gx1, SLAB, gz0], [gx0, SLAB, gz0], zc);
        if (voidSide(x, y + 1)) quad(ground, [gx1, GROUND_BOTTOM, gz1], [gx0, GROUND_BOTTOM, gz1], [gx0, SLAB, gz1], [gx1, SLAB, gz1], zc);
      } else {
        const wc = waterColor();
        // translucent surface over an OPAQUE deep floor → the sea has visible volume
        // (thickness), not a paper-thin sheet.
        quad(water, [gx0, SEA_Y, gz0], [gx0, SEA_Y, gz1], [gx1, SEA_Y, gz1], [gx1, SEA_Y, gz0], wc);
        quad(ground, [gx0, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz1], DEEP_SEA);
        // solid ocean depth at the MAP EDGE (out-of-bounds): translucent walls floor→surface.
        const oob = (nx: number, ny: number) => !getCell(state.cells, nx, ny);
        if (oob(x - 1, y)) quad(water, [gx0, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz0], [gx0, SEA_Y, gz0], [gx0, SEA_Y, gz1], wc);
        if (oob(x + 1, y)) quad(water, [gx1, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz1], [gx1, SEA_Y, gz1], [gx1, SEA_Y, gz0], wc);
        if (oob(x, y - 1)) quad(water, [gx0, SEA_FLOOR, gz0], [gx1, SEA_FLOOR, gz0], [gx1, SEA_Y, gz0], [gx0, SEA_Y, gz0], wc);
        if (oob(x, y + 1)) quad(water, [gx1, SEA_FLOOR, gz1], [gx0, SEA_FLOOR, gz1], [gx0, SEA_Y, gz1], [gx1, SEA_Y, gz1], wc);
      }

      const t = cell.terrain;
      if (!t) continue;
      const neighborAt = (dx: number, dy: number) => getCell(state.cells, x + dx, y + dy)?.terrain;

      // ── GROUND ISLET cut (type None + corners): the macro grass floor above already fills the cell;
      //    the cut only OPENS its trimmed corner onto the water it sits in. The reveal is drawn in the
      //    CUT-AWAY shape (`cornerComplement`), on the MICRO terrain grid (x0/z0) the pool uses — so the
      //    grass/water seam is the rounded fan arc that meets the pool, exactly as 2D drawCell paints the
      //    kept grass fan over the square backing (here the opaque grass floor plays the kept-fan role and
      //    the reveal fills only the rounded corner). ──
      if (isCutGround) {
        pushRevealBacking(solid, water, t, 0, neighborAt, x0, z0);
        continue;
      }

      // ── mountain column ──
      if (t.type === TerrainType.Mountain) {
        // RENDER top = the fillet tier (elevation) for a Γ patch, else the solid top. (A patch's
        // structural top, solidTopOf, is its lower base; the fillet itself draws at its elevation tier.)
        const top = t.patchOnly ? t.elevation : solidTopOf(t, TerrainType.Mountain);
        if (top <= 0) continue;
        const yTop = layerToY(top);
        const trimmed = t.corners && t.corners.some((c) => c !== 'square');

        if (!trimmed) {
          // FAST PATH (square cells — the majority): square top + per-layer strata
          // walls, EXPOSED-FACE CULLED against each neighbour's mountain top so the
          // wedding-cake elevation reads on the walls (layer e → ELEVATION_COLORS[e]).
          quad(solid, [x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], terrainColor(top));
          const sides: ReadonlyArray<readonly [number, (yb: number, yt: number, col: Rgb) => void]> = [
            [mtnTop(state, x - 1, y), (yb, yt, c) => quad(solid, [x0, yb, z1], [x0, yb, z0], [x0, yt, z0], [x0, yt, z1], c)],
            [mtnTop(state, x + 1, y), (yb, yt, c) => quad(solid, [x1, yb, z0], [x1, yb, z1], [x1, yt, z1], [x1, yt, z0], c)],
            [mtnTop(state, x, y - 1), (yb, yt, c) => quad(solid, [x0, yb, z0], [x1, yb, z0], [x1, yt, z0], [x0, yt, z0], c)],
            [mtnTop(state, x, y + 1), (yb, yt, c) => quad(solid, [x1, yb, z1], [x0, yb, z1], [x0, yt, z1], [x1, yt, z1], c)],
          ];
          for (const [nTop, emit] of sides) {
            for (let e = nTop + 1; e <= top; e++) emit(layerToY(e - 1), layerToY(e), terrainColor(e));
          }
          continue;
        }

        // BEVEL PATH (trimmed cells): honour the 2D edge-cut trims — four independently-trimmed quadrants
        // (square / triangle / fan / empty) matching trim-shapes.ts, each walled down to the ground.
        const col = terrainColor(top);
        if (t.patchOnly) {
          // PER CORNER (the shared patchCornerSplit derivation, same as 2D drawCell):
          // base block + fillets as two passes — the fillet walls sink into the solid
          // base, so the overlap with its ordinary ground walls never shows.
          const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, t);
          if (baseTier >= 1) {
            pushRevealBacking(solid, water, { ...t, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborAt, x0, z0);
            pushBevelQuads(solid, baseCorners, x0, z0, layerToY(baseTier), terrainColor(baseTier), false);
          }
          pushBevelQuads(solid, filletCorners, x0, z0, yTop, col, true);
        } else {
          // Back each cut corner with the lower step / water it reveals — SHAPED to the cut-away region so a
          // revealed (translucent) water level fills only the rounded corner, never a full quadrant that
          // covers the mountain fan and reads as a whole water block over hidden terrain.
          pushRevealBacking(solid, water, t, top, neighborAt, x0, z0);
          pushBevelQuads(solid, t.corners!, x0, z0, yTop, col, false);
        }
        continue;
      }

      // ── water terrain (lakes / rivers / waterfalls): translucent body 0..top.
      //    Side walls are EXPOSED-FACE CULLED against neighbouring water so the
      //    translucent interior faces don't double up into dark seams. ──
      if (t.type === TerrainType.Water) {
        const wc = waterColor();
        // Exposed vertical faces (pond rims + waterfall drops) get a lighter "foam"
        // tint so the FALLING side of a waterfall reads clearly against the flat top.
        const foam: Rgb = [wc[0] + (1 - wc[0]) * 0.5, wc[1] + (1 - wc[1]) * 0.5, wc[2] + (1 - wc[2]) * 0.5];
        const mx = x0 + 0.5, mz = z0 + 0.5;

        /** A full-square water body at `tier`: surface + the 4 cell-side rims,
         *  each culled against that side's water neighbour. */
        const emitSquareWater = (tier: number) => {
          const yTop = waterSurfaceY(tier);
          const fallMode = yTop >= FALL_MIN;
          const sideMesh = fallMode ? fall : water;
          quad(water, [x0, yTop, z0], [x0, yTop, z1], [x1, yTop, z1], [x1, yTop, z0], wc); // surface
          const sides: ReadonlyArray<readonly [number, Pt, Pt]> = [
            [waterTop(state, x - 1, y), [x0, z1], [x0, z0]],
            [waterTop(state, x + 1, y), [x1, z0], [x1, z1]],
            [waterTop(state, x, y - 1), [x0, z0], [x1, z0]],
            [waterTop(state, x, y + 1), [x1, z1], [x0, z1]],
          ];
          for (const [nTop, b1, b2] of sides) if (tier > nTop) wallFace(sideMesh, fallMode, b1, b2, yTop, foam);
        };

        // ── Γ PATCH: the 2D drawCell split (cellRenderSpec) — a REAL water base body
        //    ONLY when its support tier is a real elevated pool (baseTier >= 1), plus
        //    the wrapped corner's fillet at the cell's tier. A cosmetic gamma over
        //    ground (the generator's `[empty,…,fan]` water fillet, baseTier < 1) draws
        //    NO base — just the fillet over the grass floor, exactly like 2D — so the
        //    empty corners stay grass instead of flooding the whole cell. The fillet
        //    body spans baseTop→filletTop so translucent volumes never double up. ──
        if (t.patchOnly) {
          const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, t);
          const hasBase = baseTier >= 1;
          if (hasBase) {
            if (baseCorners.some((c) => c !== 'square')) {
              pushRevealBacking(solid, water, { ...t, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborAt, x0, z0);
              emitTrimmedWater(baseTier, baseCorners, false, 0);
            } else {
              emitSquareWater(baseTier);
            }
          }
          const baseY = hasBase ? waterSurfaceY(baseTier) : 0;
          emitTrimmedWater(t.elevation, filletCorners, true, baseY);
          continue;
        }

        const top = solidTopOf(t, TerrainType.Water);
        const trimmed = t.corners && t.corners.some((c) => c !== 'square');

        if (!trimmed) {
          emitSquareWater(top);
          continue;
        }

        // BEVEL PATH (trimmed cells): honour the 2D edge-cut — four independently-trimmed
        // quadrants (square / triangle / fan / empty) form the translucent surface, mirroring
        // trim-shapes.ts. The wall OUTLINE is recovered by edge cancellation: a straight edge
        // shared by two kept quadrants is interior water (drawn from both → it cancels), so only
        // the true outline survives — cell-side RIMS (culled against that side's water, exactly
        // like the fast path) and the diagonal/curved CUT faces that open onto whatever the trim
        // reveals (a mountain rim, a lower lake, the sea), which are always shown. The DoubleSide
        // water material makes the per-face winding irrelevant.
        // Back each cut corner with the surface it reveals — the mountain bank behind a cut water
        // corner, or the lower water behind a cut mountain corner — so a water cut that rounds
        // toward land shows the land filling behind it, never a hole (mirrors core/edge-cut/cut-backing.ts).
        pushRevealBacking(solid, water, t, top, neighborAt, x0, z0);
        emitTrimmedWater(top, t.corners!, false, 0);

        /** Trimmed water quadrants at `tier`: kept surfaces + walls on the
         *  surviving (edge-cancelled) outline, from `yBottom` up — a fillet
         *  pass starts at the base's surface so translucent bodies never
         *  overlap; cell-side rims cull against that side's water. Inner fans
         *  for a fillet, outer fans for a real cut. */
        function emitTrimmedWater(tier: number, corners: Corners, innerFans: boolean, yBottom: number): void {
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
            const poly = cornerPolygon(trim, ox, oz, 0.5, pos, innerFans);
            if (!poly) continue;
            pushPolyTop(water, poly, yTop, wc); // trimmed translucent surface
            for (let k = 0; k < poly.length; k++) {
              const p1 = poly[k]!, p2 = poly[(k + 1) % poly.length]!;
              const rev = ekey(p2, p1);
              if (edges.has(rev)) edges.delete(rev); // shared with a sibling quadrant → interior, cancel
              else edges.set(ekey(p1, p2), [p1, p2]);
            }
          }
          for (const [p1, p2] of edges.values()) {
            // A surviving edge that lies on a cell side is a rim → cull against that side's water
            // neighbour (same rule as the fast path). Everything else (a mid-line edge exposed by an
            // empty sibling, a triangle hypotenuse, a fan arc) is a cut face → always shown.
            let nTop: number | null = null;
            if (p1[0] === x0 && p2[0] === x0) nTop = waterTop(state, x - 1, y);
            else if (p1[0] === x1 && p2[0] === x1) nTop = waterTop(state, x + 1, y);
            else if (p1[1] === z0 && p2[1] === z0) nTop = waterTop(state, x, y - 1);
            else if (p1[1] === z1 && p2[1] === z1) nTop = waterTop(state, x, y + 1);
            if (nTop !== null && tier <= nTop) continue; // rim culled by an equal/taller water neighbour
            if (yBottom > 0) {
              quad(sideMesh, [p1[0], yBottom, p1[1]], [p2[0], yBottom, p2[1]], [p2[0], yTop, p2[1]], [p1[0], yTop, p1[1]], foam);
            } else {
              wallFace(sideMesh, fallMode, p1, p2, yTop, foam);
            }
          }
        }
      }
    }
  }
  return { solid, ground, water, fall };
}

// Above the coated VISIBLE surface (surfaceY, not layerToY — at layer 0 the surface is the
// ground slab top) only far enough that the depth test keeps the decal over it.
const ROAD_DECAL_LIFT = 0.02;

/** A flat ring between two same-count outlines at height `y`, one colour, alpha running from 0 at
 *  the outer ring to 1 at the inner — the mesh form of the 2D painter's alpha bands, compositing
 *  over the real terrain beneath rather than over a guessed ground tint (two fades meeting at a
 *  seam must SHOW the ground, and only alpha can show the ground as it is actually shaded).
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

/** One road material's surfaces as a mesh, plus the tile art (if any) that paves them. */
export interface RoadTrimPart {
  /** The catalog id every surface in this mesh is paved with. */
  material: string;
  /** The material's tile-art icon basename, absent for a colour-only surface. */
  icon?: string;
  mesh: MeshData;
}

/** Texture space for a road decal: 1 unit = 1 macro cell, phased on the map corner, so the pattern
 *  is anchored to the GRID (an integer cell line falls on an integer UV) and two surfaces of one
 *  material can never disagree where they meet. Derived from the finished positions rather than
 *  pushed beside each vertex: the UV IS the world XZ, and one derivation cannot drift from it.
 *  Matches the 2D painter's fill matrix, which anchors the same pattern at the world origin. */
function fillGridUvs(m: MeshData, origin: { x: number; z: number }): void {
  const uv: number[] = [];
  for (let i = 0; i < m.positions.length; i += 3) uv.push(m.positions[i]! - origin.x, m.positions[i + 2]! - origin.z);
  m.uv = uv;
}

/**
 * EVERY road surface as flat custom meshes, feather and all: connected same-material tiles
 * (plus the fills they feed into foreign cut cells) trace one region outline
 * (`core/edge-cut/road-region`, the same derivation the 2D painter fills), and the surface fades
 * from nothing at that outline to full colour over ROAD_FEATHER of a cell — corners wrapping as
 * the whole surface's distance field does, never per tile. Roads use the macro grid (no
 * TERRAIN_OFFSET); a unit cell means half-extents of 0.5.
 *
 * ONE MESH PER MATERIAL, because a path material paves with its own tile art and a texture belongs
 * to a mesh: the split is what lets the materials on one map wear different tiles. A textured
 * material's vertex colours are WHITE — the art carries the colour, and the item's hex multiplied
 * over it would darken the map twice; a colour-only road keeps its hex as the vertex colour.
 *
 * `offsets` displaces named roads on the ground plane (cell units = world units) for the
 * group-move/rotation tweens. A region whose members all carry one offset travels whole; a region
 * only partly in flight falls back to per-tile bodies until the tween lands, since a surface
 * cannot stretch between its moving and standing halves.
 */
export function buildRoadTrimMeshes(
  state: GridState,
  hiddenLayers?: ReadonlySet<number>,
  offsets?: ReadonlyMap<string, { dx: number; dz: number }>,
): RoadTrimPart[] {
  const { width, height } = state.template;
  const roads = roadLookup(state);
  const roadObjs: PlacedObject[] = [];
  for (const obj of state.objects.values()) {
    if (getCatalogItem(obj.catalogId)?.category === ItemCategory.Road) roadObjs.push(obj);
  }
  if (roadObjs.length === 0) return [];
  const origin = cellCornerWorld(0, 0, width, height);

  const parts = new Map<string, RoadTrimPart>();
  const partFor = (material: string): RoadTrimPart => {
    let part = parts.get(material);
    if (!part) {
      const icon = getCatalogItem(material)?.icon;
      part = { material, ...(icon ? { icon } : {}), mesh: { ...empty(), alpha: [] } };
      parts.set(material, part);
    }
    return part;
  };

  const perTile = (m: MeshData, obj: PlacedObject, y: number, col: Rgb): void => {
    const off = offsets?.get(obj.id);
    const cx = obj.position.x + origin.x + (off?.dx ?? 0), cz = obj.position.y + origin.z + (off?.dz ?? 0);
    pushFeatherRing(m, roadBodyPoints(roads, obj, cx, cz, 1, 1, 0), roadBodyPoints(roads, obj, cx, cz, 1, 1, ROAD_FEATHER), y, col);
    const core = roadBodyPoints(roads, obj, cx, cz, 1, 1, ROAD_FEATHER);
    const base = m.positions.length / 3;
    for (const [px, pz] of core) { m.positions.push(px, y, pz); m.colors.push(col[0], col[1], col[2]); m.alpha!.push(1); }
    for (const i of earcut(core.flat(), [], 2)) m.index.push(base + i);
  };

  for (const region of buildRoadRegions(roadObjs, roads)) {
    const first = region.members[0]!;
    const elev = objectElevation(state, first);
    if (hiddenLayers?.has(elev)) continue; // hides with its layer
    // A road is a FLAT decal: one face a hair above the surface it coats, no walls and no
    // thickness of its own.
    const y = surfaceY(elev) + ROAD_DECAL_LIFT;
    const item = getCatalogItem(region.material);
    const part = partFor(region.material);
    const m = part.mesh;
    const col: Rgb = part.icon ? [1, 1, 1] : objectColor(first, item);
    // A landed tween hands back offsets that are only float dust — treat those as rest.
    const memberOffsets = region.members.map((o) => {
      const v = offsets?.get(o.id);
      return v && Math.abs(v.dx) + Math.abs(v.dz) > 1e-9 ? v : undefined;
    });
    const off = memberOffsets.find((o) => o !== undefined);
    const together = off !== undefined && memberOffsets.every((o) =>
      o !== undefined && o.dx === off.dx && o.dz === off.dz);
    if (off !== undefined && !together) {
      for (const obj of region.members) perTile(m, obj, y, col);
      continue;
    }
    const dx = origin.x + (off?.dx ?? 0), dz = origin.z + (off?.dz ?? 0);
    const place = (pts: readonly (readonly [number, number])[]): Pt[] =>
      pts.map(([px, pz]) => [px + dx, pz + dz] as Pt);
    const cores: Pt[][] = [];
    for (const ring of region.rings) {
      const outer = place(ring.points(0));
      const core = place(ring.points(ROAD_FEATHER));
      pushFeatherRing(m, outer, core, y, col);
      cores.push(core);
    }
    pushRegionCore(m, cores, y, col);
  }
  const out = [...parts.values()].filter((p) => p.mesh.positions.length > 0);
  for (const p of out) fillGridUvs(p.mesh, origin);
  return out;
}
