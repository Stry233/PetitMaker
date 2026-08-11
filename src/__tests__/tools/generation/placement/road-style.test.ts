import { describe, it, expect } from 'vitest';
import { makeState } from '../../../rules/_helpers';
import { readRoadStyle, bendDensity, STYLE_MIN_ROADS } from '../../../../tools/generation/placement/road-style';
import { geoStyle } from '../../../../tools/generation/style';
import { astar } from '../../../../tools/generation/placement/network';
import type { GridState, PlacedObject, MacroCoord } from '../../../../core/model/types';

const W = 40, H = 40;

/** Drops a 1x1 road object directly into `state.objects`, bypassing the rules — road-style.ts only
 *  reads `state.objects`/`state.generation`, never validates. */
function layRoad(state: GridState, id: string, x: number, y: number, catalogId = 'road-brick'): void {
  const obj: PlacedObject = { id, catalogId, position: { x, y }, rotation: 0, elevation: 0 };
  state.objects.set(id, obj);
}

/** Long straight avenues crossing at sparse, interior intersections: mostly long straight runs, a
 *  handful of 4-way corners — reads as a rectilinear grid (bendDensity near zero). */
function layGrid(state: GridState): void {
  let n = 0;
  const xs = [5, 15, 25], ys = [5, 15, 25];
  for (const y of ys) for (let x = 0; x <= 30; x++) layRoad(state, `g${n++}`, x, y);
  for (const x of xs) for (let y = 0; y <= 30; y++) layRoad(state, `g${n++}`, x, y);
}

/** A strict R,D,R,D… staircase: every interior cell changes direction, so bendDensity reads near one. */
function layRamble(state: GridState): void {
  let x = 0, y = 0, n = 0;
  layRoad(state, `r${n++}`, x, y);
  for (let k = 0; k < 30; k++) {
    if (k % 2 === 0) x++; else y++;
    layRoad(state, `r${n++}`, x, y);
  }
}

describe('readRoadStyle', () => {
  it('a recipe map is routed by its recipe', () => {
    const state = makeState(W, H);
    state.generation = { algorithm: 'random', mode: 'earth', corridorWidth: 1, maxElevation: 8, seed: 1, region: null, naturalness: 0 };
    const style = readRoadStyle(state);
    expect(style.source).toBe('recipe');
    expect(style.naturalness).toBe(0);
    expect(style.turnPenalty).toBe(geoStyle(0).turnPenalty);
  });

  it('a map with no recipe is measured off its own roads: a grid reads low, a ramble reads high', () => {
    const grid = makeState(W, H);
    layGrid(grid);
    const gridStyle = readRoadStyle(grid);
    expect(gridStyle.source).toBe('measured');
    expect(gridStyle.naturalness).toBeLessThan(0.3);

    const ramble = makeState(W, H);
    layRamble(ramble);
    const rambleStyle = readRoadStyle(ramble);
    expect(rambleStyle.source).toBe('measured');
    expect(rambleStyle.naturalness).toBeGreaterThan(0.7);
  });

  it('a bare map keeps the organic default', () => {
    const state = makeState(W, H);
    const style = readRoadStyle(state);
    expect(style.source).toBe('default');
    expect(style.naturalness).toBe(1);
    expect(style.materialId).toBeUndefined();
  });

  it('fewer than STYLE_MIN_ROADS paved cells still reads as default', () => {
    const state = makeState(W, H);
    for (let x = 0; x < STYLE_MIN_ROADS - 1; x++) layRoad(state, `s${x}`, x, 10);
    expect(readRoadStyle(state).source).toBe('default');
  });

  it('the material is the nearest street\'s, not the pool\'s first', () => {
    const state = makeState(W, H);
    layRoad(state, 'slate', 5, 5, 'road-slate');
    layRoad(state, 'brick', 30, 30, 'road-brick');
    expect(readRoadStyle(state, { x: 6, y: 6 }).materialId).toBe('road-slate');
    expect(readRoadStyle(state, { x: 29, y: 29 }).materialId).toBe('road-brick');
  });

  it('bendDensity: a grid measures near zero, a ramble measures near one', () => {
    const gridCells = new Set<number>();
    const xs = [5, 15, 25], ys = [5, 15, 25];
    for (const y of ys) for (let x = 0; x <= 30; x++) gridCells.add(y * W + x);
    for (const x of xs) for (let y = 0; y <= 30; y++) gridCells.add(y * W + x);
    expect(bendDensity(gridCells, W, H)).toBeLessThan(0.15);

    const rambleCells = new Set<number>();
    let x = 0, y = 0;
    rambleCells.add(y * W + x);
    for (let k = 0; k < 30; k++) { if (k % 2 === 0) x++; else y++; rambleCells.add(y * W + x); }
    expect(bendDensity(rambleCells, W, H)).toBeGreaterThan(0.9);
  });
});

describe('a rectilinear map yields a rectilinear route (readRoadStyle feeding astar)', () => {
  it('the recipe\'s turnPenalty (naturalness 0) turns strictly less than the organic default (naturalness 1) over the same obstacle field', () => {
    const W = 60, H = 60;
    // A deterministic scattered obstacle field — open ground alone lets the tie-break already settle
    // on a clean L regardless of turnPenalty (see straighten's own "one L" test); a route only reads
    // as more or less rectilinear where it has to pick its way around real obstacles.
    let seed = 12345;
    const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const blocked = new Set<number>();
    for (let k = 0; k < 260; k++) blocked.add((1 + Math.floor(rnd() * (H - 2))) * W + (1 + Math.floor(rnd() * (W - 2))));
    const from: MacroCoord = { x: 3, y: 3 }, to: MacroCoord = { x: 45, y: 40 };
    blocked.delete(from.y * W + from.x); blocked.delete(to.y * W + to.x);
    const passable = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H && !blocked.has(y * W + x);

    const bendsAt = (naturalness: number): number => {
      const tp = geoStyle(naturalness).turnPenalty; // readRoadStyle's own mapping (a 'recipe' read)
      const path = astar(from, new Set([to.y * W + to.x]), passable, W, H, new Set(), to, 20000, tp)!;
      expect(path, `path at naturalness ${naturalness}`).toBeTruthy();
      let bends = 0;
      for (let i = 1; i < path.length - 1; i++) {
        const d1 = { x: path[i]!.x - path[i - 1]!.x, y: path[i]!.y - path[i - 1]!.y };
        const d2 = { x: path[i + 1]!.x - path[i]!.x, y: path[i + 1]!.y - path[i]!.y };
        if (d1.x !== d2.x || d1.y !== d2.y) bends++;
      }
      return bends;
    };
    expect(bendsAt(0)).toBeLessThan(bendsAt(1));
  });
});
