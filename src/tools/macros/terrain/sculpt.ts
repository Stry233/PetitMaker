/**
 * Sculpted landforms as terrain commands: organic terraced hills, banded walls and pool courts.
 * Each returns the commands of one stroke and the cells it shaped; the caller runs the stroke and
 * the edge-cut pass. A `region` set, when given, holds the `cellKey` of every cell a form may take.
 */
import { mountainLadder, paintTerrainCommand } from '../../../core/model/command-build';
import { TerrainType, type Command, type GridState, type MacroCoord } from '../../../core/model/types';
import { circleCells } from '../../../core/grid/shapes';
import { cellKey } from '../../../core/grid/rect';
import { BASE_SUPPORT, ELEVATION_MAX } from '../../../core/game/profile';
import { isBuildableZone } from '../../../core/game/zones';
import { paintBleedsOffBuildable } from '../../../rules/zone-restriction';
import { makeRng } from '../../../core/base/rng';

type Region = ReadonlySet<string> | null;

/** Wall bands one support reach apart, the last at the elevation ceiling. */
const WALL_BANDS: readonly number[] = Array.from(
  { length: Math.ceil(ELEVATION_MAX / BASE_SUPPORT.reach) }, (_, i) => Math.min((i + 1) * BASE_SUPPORT.reach, ELEVATION_MAX),
);

/** Organic blob: union of a main circle and two seeded satellite circles. */
function blobCells(cx: number, cy: number, r: number, rng: { float(): number }): MacroCoord[] {
  const seen = new Set<string>();
  const out: MacroCoord[] = [];
  const add = (cells: MacroCoord[]) => {
    for (const c of cells) {
      const k = cellKey(c.x, c.y);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(c);
      }
    }
  };
  add(circleCells({ x: cx, y: cy }, r, r));
  for (let i = 0; i < 2; i++) {
    const ang = rng.float() * Math.PI * 2;
    const dist = Math.max(1, Math.round(r * (0.35 + rng.float() * 0.3)));
    const sr = Math.max(2, Math.round(r * (0.5 + rng.float() * 0.25)));
    add(circleCells({ x: cx + Math.round(Math.cos(ang) * dist), y: cy + Math.round(Math.sin(ang) * dist) }, sr, sr));
  }
  return out;
}

/** The cells of `cells` whose every neighbour within `r` (Chebyshev) is also in `cells`. */
function erodeCells(cells: readonly MacroCoord[], r: number): MacroCoord[] {
  const keys = new Set(cells.map((c) => cellKey(c.x, c.y)));
  return cells.filter((c) => {
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
      if (!keys.has(cellKey(c.x + dx, c.y + dy))) return false;
    }
    return true;
  });
}

interface TerraceSpec { cx: number; cy: number; baseRadius: number; tiers: number; seed: number }

interface Terrace {
  /** Each tier's cells, bottom first; tier L stands at elevation L + 1. */
  tiers: MacroCoord[][];
  commands: Command[];
  /** Whether the region removed any cell the blobs grew. */
  clipped: boolean;
}

/**
 * Stacked blob tiers, each inside the strict interior of the tier below so every upper cell is
 * supported and the cliffs get a visible ledge. `ground` filters the cells a tier may take.
 */
export function sculptTerrace(
  state: GridState, spec: TerraceSpec, ground: (cells: MacroCoord[]) => MacroCoord[], region: Region,
): Terrace {
  const { cx, cy, baseRadius, tiers } = spec;
  const rng = makeRng(spec.seed);
  const step = Math.max(2, Math.round(baseRadius / (tiers + 0.5)));
  let clipped = false;
  const tierCells: MacroCoord[][] = [];
  for (let L = 0; L < tiers; L++) {
    const r = baseRadius - step * L;
    if (r < 2) break;
    let blob = ground(blobCells(cx, cy, r, rng));
    if (region) {
      const kept = blob.filter((c) => region.has(cellKey(c.x, c.y)));
      if (kept.length < blob.length) clipped = true;
      blob = kept;
    }
    if (L > 0) {
      const below = new Set(tierCells[L - 1]!.map((c) => cellKey(c.x, c.y)));
      blob = blob.filter(
        (c) =>
          below.has(cellKey(c.x, c.y)) &&
          below.has(cellKey(c.x + 1, c.y)) &&
          below.has(cellKey(c.x - 1, c.y)) &&
          below.has(cellKey(c.x, c.y + 1)) &&
          below.has(cellKey(c.x, c.y - 1)),
      );
    }
    if (blob.length === 0) break;
    tierCells.push(blob);
  }
  const inside = (c: MacroCoord) => c.x >= 0 && c.y >= 0 && c.x < state.template.width && c.y < state.template.height;
  const commands = tierCells.map((cells, L) => paintTerrainCommand(cells.filter(inside), TerrainType.Mountain, L + 1));
  return { tiers: tierCells, commands, clipped };
}

type MapEdge = 'N' | 'S' | 'E' | 'W';

/**
 * The rect a wall sited as the map's boundary covers: abutting `edge` of the buildable grass,
 * spanning it, `depth` rows deep. Null when the map has no buildable grass.
 */
export function wallRectAtEdge(
  state: GridState, edge: MapEdge, depth: number,
): { x1: number; y1: number; x2: number; y2: number } | null {
  const { width: mw, height: mh } = state.template;
  let gx1 = mw, gy1 = mh, gx2 = -1, gy2 = -1;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    if (isBuildableZone(state.cells[y]![x]!.zone)) {
      if (x < gx1) gx1 = x; if (x > gx2) gx2 = x; if (y < gy1) gy1 = y; if (y > gy2) gy2 = y;
    }
  }
  if (gx2 < gx1) return null;
  if (edge === 'N') return { x1: gx1, x2: gx2, y1: gy1, y2: gy1 + depth - 1 };
  if (edge === 'S') return { x1: gx1, x2: gx2, y1: gy2 - depth + 1, y2: gy2 };
  if (edge === 'W') return { x1: gx1, x2: gx1 + depth - 1, y1: gy1, y2: gy2 };
  return { x1: gx2 - depth + 1, x2: gx2, y1: gy1, y2: gy2 };
}

interface Wall {
  commands: Command[];
  /** Every cell the wall stands on: its base band. */
  base: MacroCoord[];
  /** Elevation of each band, bottom first. */
  bands: number[];
  crest: number;
  poolCells: MacroCoord[];
}

/**
 * A banded wall over a clamped rect: bands one support reach apart up to `askedCrest`, every higher
 * band the one below eroded by 2 cells, the crest flat, and with `flood` a crest pool inside a
 * 1-cell ring of the crest's own mountain. Null when no cell of the rect may hold a block.
 */
export function sculptWall(
  state: GridState, rect: { x1: number; y1: number; x2: number; y2: number }, askedCrest: number, flood: boolean, region: Region,
): Wall | null {
  const { x1, y1, x2, y2 } = rect;
  const w = x2 - x1 + 1;
  const h = y2 - y1 + 1;
  const ladder = WALL_BANDS.filter((e) => e <= askedCrest);
  if (ladder.length === 0 || ladder[ladder.length - 1]! !== askedCrest) ladder.push(askedCrest);
  // The base band is every cell of the rect a block may stand on: in the region, on buildable grass,
  // and not on the coast's grass edge, where a block bleeds onto the sand beside it. Eroding each
  // higher band by 2 cells leaves every upper cell its full support base even where a coast cuts the
  // rect, as the rect insets do on open grass.
  const base: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (region && !region.has(cellKey(x, y))) continue;
      const zone = state.cells[y]?.[x]?.zone;
      if (zone === undefined || !isBuildableZone(zone)) continue;
      if (paintBleedsOffBuildable(state, { x, y })) continue;
      base.push({ x, y });
    }
  }
  if (base.length === 0) return null;
  // Each higher band needs a crest at least 3 cells across inside the rect.
  const maxBands = Math.max(1, Math.floor((Math.min(w, h) - 3) / 4) + 1);
  const bandCells: MacroCoord[][] = [base];
  while (bandCells.length < Math.min(ladder.length, maxBands)) {
    const upper = erodeCells(bandCells[bandCells.length - 1]!, 2);
    if (upper.length === 0) break;
    bandCells.push(upper);
  }
  const bands = ladder.slice(0, bandCells.length);
  const crest = bands[bands.length - 1]!;
  // Each band is eroded out of the one below, so a cell's top is the highest band holding it.
  const top = new Map<MacroCoord, number>();
  bands.forEach((e, band) => { for (const c of bandCells[band]!) top.set(c, e); });
  const commands: Command[] = mountainLadder(base, (c) => c, () => 0, (c) => top.get(c)!);
  const poolCells = flood ? erodeCells(bandCells[bands.length - 1]!, 1) : [];
  if (poolCells.length > 0) commands.push(paintTerrainCommand(poolCells, TerrainType.Water, crest));
  return { commands, base, bands, crest, poolCells };
}

interface PoolCourt {
  commands: Command[];
  /** Every cell of the rect the court stands on. */
  cells: MacroCoord[];
  water: MacroCoord[];
  /** The cells of each islet left dry, as inclusive corners. */
  islets: { x1: number; y1: number; x2: number; y2: number }[];
}

/** An islet is this many terrain cells a side: the ground one object cell rests on. */
const ISLET_SIDE = 2;
/** From one islet's first cell to the next one's, the islet and the water between. */
export const ISLET_PITCH = 4;

/** Where islets start along one axis of the water `lo..hi`: as many as fit with water at both ends, centred. */
function isletStarts(lo: number, hi: number): number[] {
  const span = hi - lo + 1;
  const count = Math.floor(span / ISLET_PITCH);
  if (count < 1) return [];
  const run = count * ISLET_PITCH - (ISLET_PITCH - ISLET_SIDE);
  const first = lo + Math.floor((span - run) / 2);
  return Array.from({ length: count }, (_, i) => first + i * ISLET_PITCH);
}

/**
 * A bench of mountain at `elevation` over a clamped rect, holding water at the bench's own height
 * inside a 1-cell rim. With `islets`, blocks of bench stay dry inside the water on a centred
 * lattice, each the ground of one object cell. Null when the region leaves no cell of the rect.
 */
export function sinkPoolCourt(
  rect: { x1: number; y1: number; x2: number; y2: number }, elevation: number, islets: boolean, region: Region,
): PoolCourt | null {
  const { x1, y1, x2, y2 } = rect;
  const cells: MacroCoord[] = [];
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) {
    if (region && !region.has(cellKey(x, y))) continue;
    cells.push({ x, y });
  }
  if (cells.length === 0) return null;
  const commands: Command[] = [];
  commands.push(...mountainLadder(cells, (c) => c, () => 0, () => elevation));
  const dry = new Set<string>();
  const kept: PoolCourt['islets'] = [];
  if (islets) {
    for (const iy of isletStarts(y1 + 1, y2 - 1)) for (const ix of isletStarts(x1 + 1, x2 - 1)) {
      const block: MacroCoord[] = [];
      for (let dy = 0; dy < ISLET_SIDE; dy++) for (let dx = 0; dx < ISLET_SIDE; dx++) block.push({ x: ix + dx, y: iy + dy });
      // An islet the region cuts would hold no whole object cell.
      if (region && !block.every((c) => region.has(cellKey(c.x, c.y)))) continue;
      for (const c of block) dry.add(cellKey(c.x, c.y));
      kept.push({ x1: ix, y1: iy, x2: ix + ISLET_SIDE - 1, y2: iy + ISLET_SIDE - 1 });
    }
  }
  const water = cells.filter((c) => c.x !== x1 && c.x !== x2 && c.y !== y1 && c.y !== y2 && !dry.has(cellKey(c.x, c.y)));
  commands.push(paintTerrainCommand(water, TerrainType.Water, elevation));
  return { commands, cells, water, islets: kept };
}
