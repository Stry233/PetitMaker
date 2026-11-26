/**
 * The ground of a map as a level picture: land in one colour per level, water shaded by its level,
 * an outline wherever the level changes, a red tick on every waterfall face on the side it falls
 * toward, and a faint grid on every tenth row and column of terrain cells. Objects are left out, so
 * the terrain reads on its own. Levels are standable surfaces, so a cosmetic fillet shows as the
 * level it stands at.
 * Pure RGBA, for an encoder of the caller's choice; the rectangle and the counts are terrain cells.
 */
import { TerrainType, type GridState } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { surfaceElevation } from '../../../core/domain/terrain/terrain-surface';
import { detectWaterfalls } from '../../../core/domain/terrain/waterfall-geometry';
import { isBuildableZone, isOpenSeaZone } from '../../../core/game/zones';
import { ELEVATION_MAX } from '../../../core/game/profile';

type Rgb = readonly [number, number, number];

/** Land levels from 0, each a hue apart so that neighbouring levels never read as one; the legend
 *  names each by its colour. */
const LAND: readonly { rgb: Rgb; name: string }[] = [
  { rgb: [236, 232, 214], name: 'cream' }, { rgb: [190, 222, 160], name: 'pale green' },
  { rgb: [120, 190, 110], name: 'green' }, { rgb: [60, 150, 90], name: 'deep green' },
  { rgb: [225, 205, 90], name: 'yellow' }, { rgb: [235, 150, 60], name: 'orange' },
  { rgb: [190, 95, 60], name: 'brown' }, { rgb: [140, 60, 70], name: 'dark red' },
  { rgb: [95, 60, 120], name: 'purple' }, { rgb: [55, 40, 80], name: 'dark violet' },
];
/** Water levels from 0, light to deep. */
const WATER: readonly Rgb[] = [
  [170, 220, 250], [130, 195, 245], [100, 170, 235], [75, 145, 225], [55, 120, 210],
  [40, 95, 190], [30, 75, 165], [25, 55, 140], [20, 40, 110], [15, 30, 90],
];
if (LAND.length < ELEVATION_MAX + 1 || WATER.length < ELEVATION_MAX + 1) {
  throw new Error(`the ground picture colours ${Math.min(LAND.length, WATER.length)} levels, and the game has ${ELEVATION_MAX + 1}`);
}
const SEA: Rgb = [214, 236, 246];
const SHORE: Rgb = [244, 232, 190];
const EDGE: Rgb = [40, 40, 40];
const FALL: Rgb = [225, 30, 30];

/** The picture's key in words, for a reader that sees only the picture. */
export const GROUND_LEGEND = `Land is one colour per level (${LAND.slice(0, ELEVATION_MAX + 1).map((l, level) => `${level} ${l.name}`).join(', ')}), `
  + 'water light to deep blue by its level, sand and the open sea pale; a dark line wherever the level changes, a red tick '
  + 'on each waterfall on the side it falls toward; objects are left out.';

/** A rectangle of terrain cells, corners inclusive. */
export interface GroundRect { x1: number; y1: number; x2: number; y2: number }

/** What the ground of a rectangle holds: terrain cells per land level and per water level, and its waterfall cells. */
interface GroundLevels {
  land: number[];
  water: number[];
  falls: number;
}

interface GroundPicture {
  rgba: Uint8Array;
  width: number;
  height: number;
  /** The terrain cell at the picture's top-left corner and the pixels each cell takes. */
  origin: { x: number; y: number };
  scale: number;
}

/** `rect` clamped to the map, the whole map by default. */
function clampRect(state: GridState, rect?: GroundRect): GroundRect {
  const { width: mw, height: mh } = state.template;
  return {
    x1: Math.max(0, rect?.x1 ?? 0), y1: Math.max(0, rect?.y1 ?? 0),
    x2: Math.min(mw - 1, rect?.x2 ?? mw - 1), y2: Math.min(mh - 1, rect?.y2 ?? mh - 1),
  };
}

/** A cell's ground: its kind for the colour and its standable level. */
function groundOf(cell: ReturnType<typeof getCell>): { kind: 'land' | 'water' | 'shore' | 'sea'; level: number } {
  const t = cell?.terrain;
  if (t && t.type === TerrainType.Water) return { kind: 'water', level: surfaceElevation(t) };
  if (t && t.type === TerrainType.Mountain) return { kind: 'land', level: surfaceElevation(t) };
  if (cell && isBuildableZone(cell.zone)) return { kind: 'land', level: 0 };
  return { kind: !cell || isOpenSeaZone(cell.zone) ? 'sea' : 'shore', level: 0 };
}

/** Cell (x, y) as a comparable height: water a half step above land of the same level. */
function heightAt(state: GridState, x: number, y: number): number | null {
  const cell = getCell(state.cells, x, y);
  if (!cell) return null;
  const g = groundOf(cell);
  return g.kind === 'water' ? g.level + 0.5 : g.kind === 'land' ? g.level : 0;
}

/** The waterfalls whose first cell lies in `r`. */
const fallsIn = (state: GridState, r: GroundRect) => detectWaterfalls(state).filter((fall) => {
  const { x, y } = fall.cells[0]!;
  return x >= r.x1 && x <= r.x2 && y >= r.y1 && y <= r.y2;
});

/** What the ground of `rect` (the whole map by default) holds, without drawing it. */
export function groundLevels(state: GridState, rect?: GroundRect): GroundLevels {
  const r = clampRect(state, rect);
  const land = new Array<number>(ELEVATION_MAX + 1).fill(0), water = new Array<number>(ELEVATION_MAX + 1).fill(0);
  for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) {
    const g = groundOf(getCell(state.cells, x, y));
    if (g.kind === 'land') land[g.level]!++;
    else if (g.kind === 'water') water[g.level]!++;
  }
  return { land, water, falls: fallsIn(state, r).length };
}

/** The level picture of `rect` (the whole map by default) at `scale` pixels a cell. */
export function groundPicture(state: GridState, scale: number, rect?: GroundRect): GroundPicture {
  const { x1, y1, x2, y2 } = clampRect(state, rect);
  const cw = x2 - x1 + 1, ch = y2 - y1 + 1, s = Math.max(1, Math.floor(scale));
  const width = cw * s, height = ch * s;
  const rgba = new Uint8Array(width * height * 4);
  const put = (px: number, py: number, c: Rgb, alpha = 1): void => {
    if (px < 0 || py < 0 || px >= width || py >= height) return;
    const i = (py * width + px) * 4;
    rgba[i] = Math.round(rgba[i]! * (1 - alpha) + c[0] * alpha);
    rgba[i + 1] = Math.round(rgba[i + 1]! * (1 - alpha) + c[1] * alpha);
    rgba[i + 2] = Math.round(rgba[i + 2]! * (1 - alpha) + c[2] * alpha);
    rgba[i + 3] = 255;
  };
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    const g = groundOf(getCell(state.cells, x, y));
    const c = g.kind === 'water' ? WATER[g.level]! : g.kind === 'land' ? LAND[g.level]!.rgb : g.kind === 'sea' ? SEA : SHORE;
    for (let dy = 0; dy < s; dy++) for (let dx = 0; dx < s; dx++) put((x - x1) * s + dx, (y - y1) * s + dy, c);
  }
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    if (x % 10 === 0) for (let k = 0; k < s; k++) put((x - x1) * s, (y - y1) * s + k, EDGE, 0.18);
    if (y % 10 === 0) for (let k = 0; k < s; k++) put((x - x1) * s + k, (y - y1) * s, EDGE, 0.18);
    const here = heightAt(state, x, y);
    if (x < x2 && heightAt(state, x + 1, y) !== here) for (let k = 0; k < s; k++) put((x - x1) * s + s - 1, (y - y1) * s + k, EDGE);
    if (y < y2 && heightAt(state, x, y + 1) !== here) for (let k = 0; k < s; k++) put((x - x1) * s + k, (y - y1) * s + s - 1, EDGE);
  }
  const t = Math.max(1, Math.floor(s / 3));
  for (const fall of fallsIn(state, { x1, y1, x2, y2 })) {
    const { x, y } = fall.cells[0]!;
    const ox = (x - x1) * s, oy = (y - y1) * s;
    for (const face of fall.faces) {
      for (let k = 0; k < s; k++) for (let d = 0; d < t; d++) {
        if (face.flowDirection === 'south') put(ox + k, oy + s - 1 - d, FALL);
        else if (face.flowDirection === 'north') put(ox + k, oy + d, FALL);
        else if (face.flowDirection === 'east') put(ox + s - 1 - d, oy + k, FALL);
        else put(ox + d, oy + k, FALL);
      }
    }
  }
  return { rgba, width, height, origin: { x: x1, y: y1 }, scale: s };
}
