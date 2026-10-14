import { GRASS, SAND, SEA } from '../../../../pipelines/planet-scan/ground/color';
import { SCAN_PROFILE } from '../../../../pipelines/planet-scan/profile';
import type { FramePosition, LatticeModel } from '../../../../pipelines/planet-scan/track/scan-solve';
import type { GreyImage, RgbaImage } from '../../../../pipelines/planet-scan/types';
import { rng } from '../synthetic';
import { ANCHOR_LANDMARK } from '../../../_support/anchor';

// A synthetic map-view scan of a known zone map: the ground painted per cell on the lattice,
// blurred, with fixed ground texture, per-frame noise, animated foam on the sea next to land and
// textured builds standing over some cells.

/** A lattice of the calibrated period with the given phase, mapping cells as the solved model does. */
export function testLattice(phaseX: number, phaseY: number): LatticeModel {
  const cells = SCAN_PROFILE.chunk.cells;
  const px = SCAN_PROFILE.chunk.width;
  const py = SCAN_PROFILE.chunk.height;
  const axis = (period: number, phase: number) => ({ period, scale: 1, phase, lines: 10, residualRms: 0, residualMax: 0 });
  return {
    cells,
    x: axis(px, phaseX),
    y: axis(py, phaseY),
    cellToTile: (cx, cy, f) => ({ x: phaseX + (cx * px) / cells - f.x, y: phaseY + (cy * py) / cells - f.y }),
    tileToCell: (tx, ty, f) => ({ x: ((tx + f.x - phaseX) * cells) / px, y: ((ty + f.y - phaseY) * cells) / py }),
  };
}

/** A rectangle of cells, [x, x + w) by [y, y + h); the plaza and the deck may lie on half cells. */
export interface CellRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface Scene {
  /** Lattice cells [0, cols) x [0, rows); ground per cell, row-major. */
  readonly cols: number;
  readonly rows: number;
  readonly ground: Uint8Array;
  /** Builds standing over cells, drawn with a high-contrast texture. */
  readonly builds: readonly CellRect[];
  /** Sand cells in shadow, drawn darker and smooth. */
  readonly shadows: readonly CellRect[];
  /** The landmark's paving, grass underneath, in `COLOURS.paving` or in vertical stripes four
   *  pixels wide of `pavingStripes`, in turn. */
  readonly plaza: CellRect | null;
  readonly pavingStripes?: readonly (readonly number[])[];
  /** A deck standing over sea cells, drawn in `COLOURS.deck`. */
  readonly deck?: CellRect | null;
  /** Inland water standing over grass cells, drawn in the sea's colour. */
  readonly water?: readonly CellRect[];
  /** Roofs drawn in the grass's colour, as the Neighbor Center's roof reads. */
  readonly roofs?: readonly CellRect[];
  /** Roads over grass cells, drawn in `COLOURS.road`. */
  readonly roads?: readonly CellRect[];
}

export const COLOURS = {
  sea: [70, 125, 215],
  sand: [222, 205, 160],
  grass: [165, 205, 110],
  paving: [205, 200, 192],
  deck: [215, 180, 90],
  build: [[90, 60, 40], [235, 225, 210]],
  shadow: [200, 184, 140],
  road: [150, 150, 158],
} as const;

const inRect = (r: CellRect, x: number, y: number) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

/** The landmark's paving where the tests put it by default. */
export const PLAZA_AT: CellRect = { x: 50, y: 34, w: ANCHOR_LANDMARK.width, h: ANCHOR_LANDMARK.height };

/** The two notches in the west edge, one cell tall and within the grass blob's closing reach: clean
 *  sand three cells deep, and shadowed sand two cells deep. */
export const SAND_NOTCH: CellRect = { x: 22, y: 45, w: 3, h: 1 };
export const SHADOW_NOTCH: CellRect = { x: 22, y: 54, w: 2, h: 1 };

/** A planet: an island of grass with a sand shore, a separate sand bank out at sea, two sand
 *  notches, builds on the grass edge and inside it (plus `builds`), and the landmark's paving at
 *  `plaza`. */
export function islandScene(
  options: {
    readonly plaza?: CellRect | null;
    readonly pavingStripes?: readonly (readonly number[])[];
    readonly deck?: CellRect | null;
    readonly builds?: readonly CellRect[];
    readonly water?: readonly CellRect[];
    readonly roofs?: readonly CellRect[];
    readonly roads?: readonly CellRect[];
    /** Sea cells made sand, for a wider beach. */
    readonly sand?: readonly CellRect[];
  } = {},
): Scene {
  const cols = 112;
  const rows = 96;
  const ground = new Uint8Array(cols * rows).fill(SEA);
  // A blocky outline with a straight east edge (x = 82) and a notch in the north edge.
  const blocks: CellRect[] = [
    { x: 30, y: 24, w: 52, h: 48 },
    { x: 22, y: 34, w: 8, h: 28 },
    { x: 38, y: 20, w: 36, h: 4 },
    { x: 38, y: 72, w: 32, h: 4 },
  ];
  const isGrass = (x: number, y: number) =>
    !(y < 26 && x >= 44 && x < 48) && !inRect(SAND_NOTCH, x, y) && !inRect(SHADOW_NOTCH, x, y) && blocks.some((r) => inRect(r, x, y));
  const near = (x: number, y: number, r: number) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (isGrass(x + dx, y + dy)) return true;
    return false;
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (isGrass(x, y)) ground[i] = GRASS;
      else if (near(x, y, 3)) ground[i] = SAND;
    }
  }
  for (let y = 10; y < 15; y++) for (let x = 96; x < 103; x++) ground[y * cols + x] = SAND;
  for (const r of options.sand ?? []) {
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) if (ground[y * cols + x] === SEA) ground[y * cols + x] = SAND;
  }
  const builds: CellRect[] = [
    // Over the east edge: the grass column x = 81 lies under it, the sand beyond is visible.
    { x: 79, y: 40, w: 3, h: 6 },
    // Inside the grass.
    { x: 40, y: 60, w: 4, h: 3 },
    ...(options.builds ?? []),
  ];
  return {
    cols, rows, ground, builds, shadows: [SHADOW_NOTCH], plaza: options.plaza ?? null, water: options.water ?? [],
    roofs: options.roofs ?? [], roads: options.roads ?? [],
    ...(options.pavingStripes ? { pavingStripes: options.pavingStripes } : {}), deck: options.deck ?? null,
  };
}

/** A straight south coast: grass over rows [24, 56) of columns [24, 88), a beach down to row 62
 *  and sea beyond, with `deck` standing over the sea. */
export function coastScene(deck: CellRect | null): Scene {
  const cols = 112;
  const rows = 96;
  const ground = new Uint8Array(cols * rows).fill(SEA);
  for (let y = 21; y < 62; y++) {
    for (let x = 21; x < 91; x++) ground[y * cols + x] = x >= 24 && x < 88 && y >= 24 && y < 56 ? GRASS : SAND;
  }
  return { cols, rows, ground, builds: [], shadows: [], plaza: null, water: [], deck };
}

/** The world image in path pixels: path point (X, Y) is world pixel (X - originX, Y - originY). */
export interface World {
  readonly lattice: LatticeModel;
  readonly originX: number;
  readonly originY: number;
  readonly width: number;
  readonly height: number;
  readonly rgb: Float32Array;
  /** Foam strength per world pixel, 0 to 1: sea within about a cell of land. */
  readonly foam: Float32Array;
}

function blurPlane(src: Float32Array, w: number, h: number, sigma: number): Float32Array {
  const r = Math.ceil(3 * sigma);
  const k = Array.from({ length: 2 * r + 1 }, (_, i) => Math.exp(-((i - r) ** 2) / (2 * sigma * sigma)));
  const ks = k.reduce((a, b) => a + b, 0);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const clamp = (v: number, n: number) => Math.max(0, Math.min(n - 1, v));
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r]! * src[y * w + clamp(x + i, w)]!;
    tmp[y * w + x] = s / ks;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r]! * tmp[clamp(y + i, h) * w + x]!;
    out[y * w + x] = s / ks;
  }
  return out;
}

/** How far in cells the painted beach reaches beyond the land cells. */
const SHORE_REACH = 1.2;

/** Whether the point (x, y) in cells lies within `reach` cells of a land cell. */
function nearLand(scene: Scene, x: number, y: number, reach: number): boolean {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= scene.cols || ny >= scene.rows || scene.ground[ny * scene.cols + nx] === SEA) continue;
      const ex = Math.max(nx - x, 0, x - nx - 1);
      const ey = Math.max(ny - y, 0, y - ny - 1);
      if (Math.hypot(ex, ey) < reach) return true;
    }
  }
  return false;
}

/** Paints the scene on the lattice: cell colours, a blur of `blur` pixels, fixed texture. */
export function paintWorld(scene: Scene, lattice: LatticeModel, blur = 1.5, seed = 3): World {
  const origin = lattice.cellToTile(0, 0, { x: 0, y: 0 });
  const end = lattice.cellToTile(scene.cols, scene.rows, { x: 0, y: 0 });
  const originX = Math.floor(origin.x);
  const originY = Math.floor(origin.y);
  const width = Math.ceil(end.x) - originX;
  const height = Math.ceil(end.y) - originY;
  const r = rng(seed);
  const planes = [new Float32Array(width * height), new Float32Array(width * height), new Float32Array(width * height)];
  const land = new Float32Array(width * height);
  const sharp = new Uint8Array(width * height);
  for (let py = 0; py < height; py++) {
    for (let px = 0; px < width; px++) {
      const c = lattice.tileToCell(px + 0.5, py + 0.5, { x: originX, y: originY });
      const cx = Math.floor(c.x);
      const cy = Math.floor(c.y);
      const i = py * width + px;
      const inside = cx >= 0 && cy >= 0 && cx < scene.cols && cy < scene.rows;
      let g = inside ? scene.ground[cy * scene.cols + cx]! : SEA;
      // The game draws the beach as a smooth outline reaching about a cell beyond the land cells.
      if (g === SEA && nearLand(scene, c.x, c.y, SHORE_REACH)) g = SAND;
      let colour: readonly number[] = g === GRASS ? COLOURS.grass : g === SAND ? COLOURS.sand : COLOURS.sea;
      land[i] = g === SEA ? 0 : 1;
      if (scene.plaza && inRect(scene.plaza, c.x, c.y)) {
        const stripes = scene.pavingStripes;
        colour = stripes ? stripes[Math.floor(px / 4) % stripes.length]! : COLOURS.paving;
      }
      if (g === GRASS && scene.roads?.some((r) => inRect(r, c.x, c.y))) colour = COLOURS.road;
      if (scene.roofs?.some((r) => inRect(r, c.x, c.y))) colour = COLOURS.grass;
      if (scene.deck && g === SEA && inRect(scene.deck, c.x, c.y)) colour = COLOURS.deck;
      if (scene.shadows.some((r) => inRect(r, cx, cy))) colour = COLOURS.shadow;
      if (scene.water?.some((r) => inRect(r, cx, cy))) colour = COLOURS.sea;
      if (scene.builds.some((b) => inRect(b, cx, cy))) {
        colour = COLOURS.build[(Math.floor(px / 3) + Math.floor(py / 3)) % 2]!;
        sharp[i] = 1;
      }
      for (let k = 0; k < 3; k++) planes[k]![i] = colour[k]!;
    }
  }
  const blurred = planes.map((p) => blurPlane(p, width, height, blur));
  const rgb = new Float32Array(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    const t = (r() - 0.5) * 2;
    for (let k = 0; k < 3; k++) rgb[i * 3 + k] = (sharp[i] ? planes[k]![i]! : blurred[k]![i]!) + t;
  }
  const near = blurPlane(land, width, height, 5);
  const foam = new Float32Array(width * height);
  for (let i = 0; i < foam.length; i++) foam[i] = land[i] ? 0 : Math.min(1, near[i]! * 3);
  return { lattice, originX, originY, width, height, rgb, foam };
}

/** Frame positions of a row-by-row scan covering the world with the tile. */
export function scanPositions(world: World, width: number, height: number, stepX = 60, stepY = 50): FramePosition[] {
  const out: FramePosition[] = [];
  for (let y = world.originY; y <= world.originY + world.height - height; y += stepY) {
    for (let x = world.originX; x <= world.originX + world.width - width; x += stepX) out.push({ x: x + 0.37, y: y + 0.21 });
  }
  return out;
}

/** The tile a frame at `at` sees, with per-frame noise and foam brightened by `phase` in [0, 1]. */
export function viewTile(world: World, at: FramePosition, size: { width: number; height: number }, frame: number, phase = 0.5): RgbaImage {
  const { width, height } = size;
  const r = rng(1000 + frame);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const wx = tx + at.x - world.originX;
      const wy = ty + at.y - world.originY;
      const x0 = Math.max(0, Math.min(world.width - 2, Math.floor(wx)));
      const y0 = Math.max(0, Math.min(world.height - 2, Math.floor(wy)));
      const fx = Math.max(0, Math.min(1, wx - x0));
      const fy = Math.max(0, Math.min(1, wy - y0));
      const o = (ty * width + tx) * 4;
      const at3 = (x: number, y: number, k: number) => world.rgb[(y * world.width + x) * 3 + k]!;
      const foam = world.foam[y0 * world.width + x0]! * 60 * phase;
      const noise = (r() - 0.5) * 8;
      for (let k = 0; k < 3; k++) {
        const v = (at3(x0, y0, k) * (1 - fx) + at3(x0 + 1, y0, k) * fx) * (1 - fy) + (at3(x0, y0 + 1, k) * (1 - fx) + at3(x0 + 1, y0 + 1, k) * fx) * fy;
        data[o + k] = v + foam + noise;
      }
      data[o + 3] = 255;
    }
  }
  return { width, height, data };
}

/** A still run's temporal deviation at `at`: the foam's animation. */
export function viewDeviation(world: World, at: FramePosition, width: number, height: number): GreyImage {
  const data = new Float32Array(width * height);
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) {
      const wx = Math.round(tx + at.x - world.originX);
      const wy = Math.round(ty + at.y - world.originY);
      const ok = wx >= 0 && wy >= 0 && wx < world.width && wy < world.height;
      data[ty * width + tx] = ok ? world.foam[wy * world.width + wx]! * 12 + 0.5 : 0;
    }
  }
  return { width, height, data };
}
