/**
 * The 2D drawing of a road surface: a region feathered as a whole in stepped alpha bands, filled
 * with its path tile art or colour, or an authored material's band windows phased at the world
 * origin. Pure appearance; `layers/road-surfaces.ts` decides which regions draw.
 */
import * as PIXI from 'pixi.js-legacy';
import { TILE_SIZE } from '../geometry/world';
import { ROAD_FEATHER, type RoadPt } from '../../shared/road/shape';
import { smoothstep } from '../../../core/base/math';
import type { RoadRegion } from '../../shared/road/region';
import { hexStringToNumber } from '../../../core/base/color';
import { roadTileCanvas, ROAD_TEXTURE_SIZE } from '../../shared/road/tile-texture';
import { roadFeatherOutline } from '../../shared/road/feather';
import { ROAD_BAND_WINDOW, type RoadBandLayout, type RoadBandWindow, type RoadMaterialPatch } from '../../shared/road/material';
import type { RoadMaterialSpec, RoadMaterialPattern } from '../../../config/catalog/road-material';
import { roadPatternRepeat } from '../../shared/road/pattern';
import { roadMaterialTexture } from '../../shared/road/material-texture';
import { cellCentre } from '../../../core/grid/grid-convert';
import { cellKey } from '../../../core/grid/rect';

/** Feather steps: the fade is drawn as this many stepped alpha bands between the outline and the
 *  fully-opaque core. At ROAD_FEATHER of a 64px tile each band is ~1.3px — the steps disappear
 *  into the gradient at rest zoom, straight edges and the fans' concentric arcs alike. */
const FEATHER_STEPS = 12;

/** One texture per path material, keyed by icon url. A fill references its texture rather than
 *  copying it, so a per-region texture would upload the same canvas once per surface on the map. */
const roadFillTextures = new Map<string, PIXI.Texture>();

/**
 * The repeating fill for a path material's tile art, or nothing while that art is still decoding —
 * `onReady` fires once it lands, and is where the surfaces already drawn get their redraw.
 */
export function roadFillTexture(url: string, onReady: () => void): PIXI.Texture | undefined {
  const hit = roadFillTextures.get(url);
  if (hit) return hit;
  const canvas = roadTileCanvas(url, onReady);
  if (!canvas) return undefined;
  const tex = PIXI.Texture.from(canvas);
  // The fill must tile, and the crop is power-of-two, which is what makes `REPEAT` legal on WebGL1
  // (an npot texture wraps to black there). Set at creation, so it holds from the first fill on.
  tex.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  roadFillTextures.set(url, tex);
  return tex;
}

const materialTextures = new Map<RoadMaterialPattern, PIXI.Texture>();
const materialMatrices = new Map<RoadMaterialPattern, PIXI.Matrix>();
function materialMatrix(pattern: RoadMaterialPattern): PIXI.Matrix {
  let matrix = materialMatrices.get(pattern);
  if (!matrix) {
    const scale = TILE_SIZE * roadPatternRepeat(pattern) / roadMaterialTexture(pattern).width;
    matrix = new PIXI.Matrix(scale, 0, 0, scale, 0, 0);
    materialMatrices.set(pattern, matrix);
  }
  return matrix;
}
/** The shared repeating texture of a material pattern; prints sprite with it too. */
export function materialTexture(pattern: RoadMaterialPattern, onReady?: () => void): PIXI.Texture {
  const canvas = roadMaterialTexture(pattern, onReady);
  const cached = materialTextures.get(pattern);
  if (cached) return cached;
  const texture = PIXI.Texture.from(canvas);
  roadMaterialTexture(pattern, () => texture.baseTexture.update());
  texture.baseTexture.wrapMode = PIXI.WRAP_MODES.REPEAT;
  materialTextures.set(pattern, texture);
  return texture;
}

/** Texture space → world px: the 128px tile art covers exactly one macro block. Region points are
 *  world px and a region's Graphics sits at the world origin, so the pattern is anchored to the
 *  Grid — two surfaces of one material can never disagree on phase where they meet. Shared: Pixi
 *  clones this on `beginTextureFill`. */
const ROAD_FILL_MATRIX = new PIXI.Matrix(
  TILE_SIZE / ROAD_TEXTURE_SIZE, 0, 0, TILE_SIZE / ROAD_TEXTURE_SIZE, 0, 0,
);

/**
 * One connected road surface without material bands, feathered as a whole (view/shared/road/region
 * — the same derivation the 3D mesher blends with vertex colours): each band is one closed contour
 * with the next contour as its hole, so no radial edge exists anywhere for anti-aliasing to trace —
 * band seams only ever follow the outline. A region's boundary fades everywhere (interior cell lines
 * are cancelled out of it), so a band's hole never touches its outer path and the triangulation
 * stays sound. Ring signed area tells outer rings (positive, in this y-down frame) from holes.
 *
 * `texture` is the material's tile art where it has any: the geometry is identical either way —
 * same outlines, same bands, same stepped alpha — only what fills them changes.
 */
export function drawRegion(
  g: PIXI.Graphics, region: RoadRegion, look: { color: number; alpha: number; texture?: PIXI.Texture; feather?: number },
): void {
  const { color, alpha, texture, feather = ROAD_FEATHER } = look;
  const fill = (a: number): void => {
    if (texture) g.beginTextureFill({ texture, alpha: a, matrix: ROAD_FILL_MATRIX });
    else g.beginFill(color, a);
  };
  // Each ring sampled once per inset level, scaled to px. The point count is fixed across `t` by
  // construction (view/shared/road/region.ts), which is what lets a band pair its two rings vertex by vertex.
  const ringSets = featherLevels(region, feather);
  // The fade: quad bands between consecutive insets, one strip per ring — outer contours and holes
  // alike, since every vertex's inset direction already points into the surface. A quad is two
  // triangles to the triangulator, where a contour-with-hole polygon at every band re-triangulated
  // the whole surface once per band, and the triangulation is what a paint stroke's per-frame
  // redraw of a large connected network spends nearly all of its time in.
  for (let i = 0; i < FEATHER_STEPS; i++) {
    fill(alpha * smoothstep(0, 1, (i + 0.5) / FEATHER_STEPS));
    for (const ring of ringSets) forEachFadeQuad(ring.levels, i, (quad) => g.drawPolygon(quad));
    g.endFill();
  }
  // The core: the outer contour at full inset with the holes at theirs — the one shape that still
  // needs a real triangulation.
  fill(alpha);
  for (const ring of ringSets) {
    if (!ring.outer) continue;
    g.drawPolygon(ring.levels[FEATHER_STEPS]!.flat());
    g.beginHole();
    for (const hole of ringSets) if (!hole.outer) g.drawPolygon(hole.levels[FEATHER_STEPS]!.flat());
    g.endHole();
  }
  g.endFill();
}

/** Every ring of a region at each fade inset, in world px. */
function featherLevels(region: RoadRegion, feather: number): { levels: RoadPt[][]; outer: boolean }[] {
  return region.rings.map((ring) => {
    const outlineAt = roadFeatherOutline(ring.points);
    return {
      levels: Array.from({ length: FEATHER_STEPS + 1 }, (_, i) =>
        outlineAt(feather * (i / FEATHER_STEPS)).map(([px, py]) => [px * TILE_SIZE, py * TILE_SIZE] as RoadPt)),
      outer: ringArea(ring.points(0)) > 0,
    };
  });
}

/** The fade quads of one ring between inset levels `i` and `i + 1`, skipping edges that do not fade. */
function forEachFadeQuad(levels: RoadPt[][], i: number, draw: (quad: number[], k: number) => void): void {
  const outer = levels[i]!;
  const inner = levels[i + 1]!;
  for (let k = 0; k < outer.length; k++) {
    const k2 = (k + 1) % outer.length;
    const [a, b, c, d] = [outer[k]!, outer[k2]!, inner[k2]!, inner[k]!];
    if ((a[0] === d[0] && a[1] === d[1]) && (b[0] === c[0] && b[1] === c[1])) continue; // no fade here
    draw([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], k);
  }
}

/**
 * A banded region's fade quads, grouped by the band window that draws them and then by inset level.
 * Each strip goes to the window of a region cell next to its midpoint, so the window's key covers
 * every piece that shapes it.
 */
export function fadeQuadsByWindow(
  region: RoadRegion, spec: RoadMaterialSpec, layout: RoadBandLayout, only?: readonly RoadBandWindow[],
): Map<RoadBandWindow, number[][][]> {
  const cells = new Set(region.cells.map((c) => cellKey(c.x, c.y)));
  const out = new Map<RoadBandWindow, number[][][]>();
  // A ring's strips stay within one cell of its outline, so rings away from every wanted window are skipped.
  const near = (ring: RoadRegion['rings'][number]): boolean => {
    if (!only) return true;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of ring.points(0)) {
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    return only.some((w) => x0 - 1 <= w.x + ROAD_BAND_WINDOW && w.x <= x1 + 1 && y0 - 1 <= w.y + ROAD_BAND_WINDOW && w.y <= y1 + 1);
  };
  for (const ring of featherLevels({ ...region, rings: region.rings.filter(near) }, spec.feather)) {
    const owners: RoadBandWindow[] = [];
    const outer = ring.levels[0]!, core = ring.levels[FEATHER_STEPS]!;
    for (let k = 0; k < outer.length; k++) {
      const k2 = (k + 1) % outer.length;
      const mx = (outer[k]![0] + outer[k2]![0] + core[k]![0] + core[k2]![0]) / (4 * TILE_SIZE);
      const my = (outer[k]![1] + outer[k2]![1] + core[k]![1] + core[k2]![1]) / (4 * TILE_SIZE);
      let cx = Math.floor(mx), cy = Math.floor(my);
      search: for (const dy of [0, -1, 1]) for (const dx of [0, -1, 1]) {
        if (cells.has(cellKey(cx + dx, cy + dy))) { cx += dx; cy += dy; break search; }
      }
      const mid = cellCentre({ x: cx, y: cy });
      owners.push(layout.windowAt(mid.x, mid.y));
    }
    for (let i = 0; i < FEATHER_STEPS; i++) {
      forEachFadeQuad(ring.levels, i, (quad, k) => {
        let levels = out.get(owners[k]!);
        if (!levels) { levels = Array.from({ length: FEATHER_STEPS }, () => []); out.set(owners[k]!, levels); }
        levels[i]!.push(quad);
      });
    }
  }
  return out;
}

/** One band window: its share of the fade, then its band patches, all world-phased at the origin. */
export function drawBandWindow(
  g: PIXI.Graphics, spec: RoadMaterialSpec, window: { fade: number[][][] | undefined; patches: RoadMaterialPatch[] }, alpha: number, onReady: () => void,
): void {
  const { fade, patches } = window;
  const edge = hexStringToNumber(spec.edge.color);
  const pattern = spec.edge.pattern;
  fade?.forEach((quads, i) => {
    if (!quads.length) return;
    const a = alpha * smoothstep(0, 1, (i + 0.5) / FEATHER_STEPS);
    if (pattern) g.beginTextureFill({ texture: materialTexture(pattern, onReady), color: edge, alpha: a, matrix: materialMatrix(pattern) });
    else g.beginFill(edge, a);
    for (const quad of quads) g.drawPolygon(quad);
    g.endFill();
  });
  for (const patch of patches) {
    if (!patch.polygons.length) continue;
    if (patch.pattern) g.beginTextureFill(
      { texture: materialTexture(patch.pattern, onReady), color: hexStringToNumber(patch.color), alpha, matrix: materialMatrix(patch.pattern) },
    );
    else g.beginFill(hexStringToNumber(patch.color), alpha);
    for (const [outer, ...holes] of patch.polygons) {
      g.drawPolygon(outer!.flat().map((v) => v * TILE_SIZE));
      for (const hole of holes) {
        g.beginHole();
        g.drawPolygon(hole.flat().map((v) => v * TILE_SIZE));
        g.endHole();
      }
    }
    g.endFill();
  }
}

function ringArea(pts: RoadPt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i]!, [x2, y2] = pts[(i + 1) % pts.length]!;
    a += x1 * y2 - x2 * y1;
  }
  return a;
}
