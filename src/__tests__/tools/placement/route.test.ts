import { describe, it, expect } from 'vitest';
import { makeState, setTerrain } from '../../rules/_helpers';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import {
  planRoute, straighten, squareJunction, approachRun, scoreCrossing, capEnter,
  MIN_RUN, STRAIGHTEN_SLACK, type RouteWorld,
} from '../../../tools/placement/route';
import type { Portal } from '../../../tools/placement/portals';
import { TerrainType, type MacroCoord, type PlacedObject } from '../../../core/model/types';
import { buildObjectOccupancy } from '../../../state/object-geometry';
import { TUNING } from '../../../tools/placement/tuning';

const manhattan = (a: MacroCoord, b: MacroCoord): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

/** Direction changes along a flat cell walk. */
function bendIndices(cells: readonly MacroCoord[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const d1 = { x: cells[i]!.x - cells[i - 1]!.x, y: cells[i]!.y - cells[i - 1]!.y };
    const d2 = { x: cells[i + 1]!.x - cells[i]!.x, y: cells[i + 1]!.y - cells[i]!.y };
    if (d1.x !== d2.x || d1.y !== d2.y) out.push(i);
  }
  return out;
}

const DEFAULT_STYLE = { turnPenalty: 0, naturalness: 1, alignment: new Map<number, 'x' | 'y'>(), materialId: undefined, source: 'default' as const };

describe('straighten', () => {
  it('collapses a full staircase into one L on open ground', () => {
    const path: MacroCoord[] = [];
    let x = 2, y = 2;
    path.push({ x, y });
    while (x < 12 || y < 12) { if (x < 12) { x++; path.push({ x, y }); } if (y < 12) { y++; path.push({ x, y }); } }
    const passable = () => true;
    const out = straighten(path, passable);
    const bends = bendIndices(out);
    expect(bends.length).toBeLessThanOrEqual(1);
  });

  it('never costs more than STRAIGHTEN_SLACK extra cells over the manhattan distance', () => {
    const path: MacroCoord[] = [];
    let x = 0, y = 0;
    path.push({ x, y });
    for (let k = 0; k < 20; k++) { if (k % 2 === 0) x++; else y++; path.push({ x, y }); }
    const out = straighten(path, () => true);
    const bends = bendIndices(out).length;
    expect(out.length).toBeLessThanOrEqual(manhattan(path[0]!, path[path.length - 1]!) + 1 + STRAIGHTEN_SLACK * Math.max(1, bends));
  });

  it('with a stepCost, keeps a genuinely cheaper detour rather than snapping to the shorter direct line', () => {
    // Row 0 is expensive to walk, row 1 is cheap. The detour's own row-1 run is MIN_RUN cells or
    // more (4), so pass 2's unconditional bend-spacing merge (a hard guarantee, never cost-gated)
    // has no reason to fold it back either — only the row-0 exit step is genuinely costly.
    const path: MacroCoord[] = [
      { x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }, { x: 4, y: 1 }, { x: 4, y: 0 },
    ];
    const stepCost = (_from: MacroCoord, to: MacroCoord): number => (to.y === 0 ? 10 : 0.1);
    const out = straighten(path, () => true, stepCost);
    expect(out.some((c) => c.y === 1)).toBe(true);
  });

  it('with a stepCost, a neutral (uniform-cost) case still collapses to the direct line', () => {
    const path: MacroCoord[] = [];
    let x = 2, y = 2;
    path.push({ x, y });
    while (x < 12 || y < 12) { if (x < 12) { x++; path.push({ x, y }); } if (y < 12) { y++; path.push({ x, y }); } }
    const out = straighten(path, () => true, () => 1);
    expect(bendIndices(out).length).toBeLessThanOrEqual(1);
  });
});

describe('approachRun', () => {
  it('steps away from the deck along its own axis, near cell first', () => {
    const p: Portal = { kind: 'bridge', regionA: 0, regionB: 1, anchor: { x: 10, y: 5 }, approachA: { x: 8, y: 5 }, approachB: { x: 12, y: 5 }, cost: 1 };
    const runA = approachRun(p, 'A');
    expect(runA).toEqual([{ x: 8, y: 5 }, { x: 7, y: 5 }]); // stepping further LEFT, away from B
    const runB = approachRun(p, 'B');
    expect(runB).toEqual([{ x: 12, y: 5 }, { x: 13, y: 5 }]); // stepping further RIGHT, away from A
  });
});

describe('scoreCrossing', () => {
  // A bare open map: only `world.a` (for the approach term's openness reads) matters here.
  const bareWorld = (portals: Portal[]): RouteWorld =>
    ({ a: analyzeTerrain(makeState(40, 40)), portals, regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE });

  it('a deck in line with the goal outscores the same deck read against a perpendicular goal', () => {
    // axis x (approachA/B share y): due east of the anchor is ALONG the deck's own axis (a
    // zero-detour crossing); due south is ACROSS it (a 90° jog to reach and use).
    const p: Portal = { kind: 'bridge', regionA: 0, regionB: 1, anchor: { x: 10, y: 10 }, approachA: { x: 8, y: 10 }, approachB: { x: 12, y: 10 }, cost: 1 };
    const world = bareWorld([p]);
    const inLine = scoreCrossing(world, p, { x: 0, y: 10 }, { x: 30, y: 10 }).square;
    const perpendicular = scoreCrossing(world, p, { x: 10, y: 0 }, { x: 10, y: 30 }).square;
    expect(inLine).toBeGreaterThan(perpendicular);
    expect(inLine).toBeCloseTo(1, 5);
    expect(perpendicular).toBeCloseTo(0, 5);
  });

  it('an asymmetric fixture: an in-line portal outscores a perpendicular one at equal span and approach', () => {
    const inLineP: Portal = { kind: 'bridge', regionA: 0, regionB: 1, anchor: { x: 10, y: 10 }, approachA: { x: 8, y: 10 }, approachB: { x: 12, y: 10 }, cost: 1 }; // axis x, span 4
    const perpP: Portal = { kind: 'bridge', regionA: 0, regionB: 1, anchor: { x: 10, y: 20 }, approachA: { x: 10, y: 18 }, approachB: { x: 10, y: 22 }, cost: 1 }; // axis y, span 4
    const world = bareWorld([inLineP, perpP]);
    const toward = { x: 30, y: 10 }; // due east — in line with inLineP's x axis, perpendicular to perpP's y axis
    const back = { x: 10, y: 30 }; // south of both, and exactly the point at which the two cost the same detour
    expect(scoreCrossing(world, inLineP, back, toward).span).toBeCloseTo(scoreCrossing(world, perpP, back, toward).span, 10);
    expect(scoreCrossing(world, inLineP, back, toward).approach).toBe(scoreCrossing(world, perpP, back, toward).approach);
    expect(scoreCrossing(world, inLineP, back, toward).detour).toBeCloseTo(scoreCrossing(world, perpP, back, toward).detour, 10);
    expect(scoreCrossing(world, inLineP, back, toward).total).toBeGreaterThan(scoreCrossing(world, perpP, back, toward).total);
  });

  it('planRoute picks the in-line crossing over a same-span perpendicular one', () => {
    const state = makeState(40, 40);
    for (let y = 0; y < 40; y++) setTerrain(state, 19, y, TerrainType.Water, 0);
    const a = analyzeTerrain(state);
    const leftId = a.region[15 * 40 + 5]!, rightId = a.region[15 * 40 + 30]!;
    const inLineP: Portal = { kind: 'bridge', regionA: leftId, regionB: rightId, anchor: { x: 19, y: 15 }, approachA: { x: 17, y: 15 }, approachB: { x: 21, y: 15 }, cost: 1 };
    const perpP: Portal = { kind: 'bridge', regionA: leftId, regionB: rightId, anchor: { x: 19, y: 25 }, approachA: { x: 19, y: 23 }, approachB: { x: 19, y: 27 }, cost: 1 };
    const portals = [inLineP, perpP];
    const world: RouteWorld = { a, portals, regionAdj: new Map([[leftId, portals], [rightId, portals]]), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const plan = planRoute(world, { x: 5, y: 15 }, { x: 30, y: 15 }, 'short')!;
    expect(plan.crossings[0]!.anchor).toEqual({ x: 19, y: 15 }); // the in-line one, not the perpendicular one
  });
});

describe('capEnter', () => {
  it('never lets a step drop to zero or below, however negative the raw discount', () => {
    const state = makeState(10, 10);
    const a = analyzeTerrain(state);
    const roadCell = 5 * 10 + 5;
    const road = new Set<number>([roadCell]);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road, occupied: new Set(), style: DEFAULT_STYLE };
    for (const raw of [0, -0.01, -0.3, -1, -1000]) {
      expect(TUNING.roadReuseCost + capEnter(world, roadCell, raw)).toBeGreaterThan(0); // the cheaper base
      expect(TUNING.roadCost + capEnter(world, 0, raw)).toBeGreaterThan(0); // plain ground
    }
  });
});

describe('the alignment discount', () => {
  it('planRoute takes a genuinely longer detour when the discount makes it genuinely cheaper, and stays direct otherwise', () => {
    // Open ground; a "standing street" alignment one row below the direct line. `straighten()` has to be
    // COST-AWARE or this collapses back to the direct line: a detour that pays for itself only under a
    // profile's own cost function looks, geometrically, like pure waste, and a purely geometric slack test
    // takes it away. This exercises the real pipeline end to end (planRoute → buildLegCells → straighten),
    // not just astar's raw output.
    const W = 30, H = 20;
    const state = makeState(W, H);
    const a = analyzeTerrain(state);
    const alignment = new Map<number, 'x' | 'y'>();
    for (let x = 0; x <= 20; x++) alignment.set(11 * W + x, 'x');
    const from = { x: 0, y: 10 }, to = { x: 20, y: 10 };

    const styled: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: { ...DEFAULT_STYLE, alignment } };
    const bare: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };

    const planStyled = planRoute(styled, from, to, 'short')!;
    const planBare = planRoute(bare, from, to, 'short')!;
    expect(planStyled).toBeTruthy();
    expect(planBare).toBeTruthy();

    const onStreet = (cells: MacroCoord[]): number => cells.filter((c) => c.y === 11).length;
    expect(onStreet(planStyled.cells)).toBeGreaterThan(0);       // the discounted detour survives straightening
    expect(onStreet(planBare.cells)).toBe(0);                    // without it, the direct line has no reason to wander
  });

  it('stacked with the scenic bonus (align + water, the worst case), the route still walks a valid connected line', () => {
    const W = 50, H = 50;
    const state = makeState(W, H);
    for (let y = 22; y <= 23; y++) for (let x = 0; x < W; x++) setTerrain(state, x, y, TerrainType.Water, 0);
    const a = analyzeTerrain(state);
    const road = new Set<number>();
    const alignment = new Map<number, 'x' | 'y'>();
    for (let x = 5; x <= 40; x++) { const i = 20 * W + x; road.add(i); alignment.set(i, 'x'); } // paved, aligned, AND within SCENIC_REACH of the water
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road, occupied: new Set(), style: { ...DEFAULT_STYLE, alignment } };

    // Both taps stay on the SAME side of the water band (no crossing needed): the point is to
    // exercise the align+scenic stack over a real search, not to route across a divide.
    const plan = planRoute(world, { x: 5, y: 5 }, { x: 40, y: 15 }, 'scenic');
    expect(plan).toBeTruthy();
    // A negative-edge-corrupted reconstruction is the first place a jump or a repeat would show up.
    for (let i = 1; i < plan!.cells.length; i++) expect(manhattan(plan!.cells[i - 1]!, plan!.cells[i]!)).toBe(1);
    expect(new Set(plan!.cells.map((c) => c.y * W + c.x)).size).toBe(plan!.cells.length); // no cell twice
    expect(plan!.cost).toBeGreaterThan(0);
  });
});

describe('squareJunction', () => {
  const W = 40;
  const road = new Set<number>();
  for (let x = 5; x <= 30; x++) road.add(15 * W + x); // a standing horizontal street
  const passable = () => true;

  it('a route meeting a street meets it square: last MIN_RUN cells vertical, join on the street', () => {
    const path: MacroCoord[] = [];
    for (let y = 25; y >= 16; y--) path.push({ x: 15, y }); // arriving straight from below
    const { cells, pads } = squareJunction(path, road, passable, W);
    const tail = cells.slice(-MIN_RUN);
    expect(tail.every((c) => c.x === tail[0]!.x)).toBe(true); // vertical
    const last = cells[cells.length - 1]!;
    expect(road.has(last.y * W + last.x)).toBe(true);
    // the join cell sits mid-street, so left+right are already paved: a three-way meeting → a pad.
    expect(pads.length).toBeGreaterThan(0);
  });

  it('does nothing when the tail never meets pavement', () => {
    const path: MacroCoord[] = [{ x: 1, y: 1 }, { x: 1, y: 2 }, { x: 1, y: 3 }];
    const { cells, pads } = squareJunction(path, road, passable, W);
    expect(cells).toEqual(path);
    expect(pads).toEqual([]);
  });
});

describe('planRoute', () => {
  it('a diagonal is one L, not a staircase', () => {
    const state = makeState(20, 20);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const plan = planRoute(world, { x: 2, y: 2 }, { x: 12, y: 12 }, 'short');
    expect(plan).toBeTruthy();
    expect(plan!.legs.length).toBe(2);
    for (const leg of plan!.legs) {
      const sameX = leg.cells.every((c) => c.x === leg.cells[0]!.x);
      const sameY = leg.cells.every((c) => c.y === leg.cells[0]!.y);
      expect(sameX || sameY, `leg ${JSON.stringify(leg.cells)} collinear`).toBe(true);
    }
  });

  it('two bends never fall within MIN_RUN cells of each other', () => {
    const state = makeState(30, 30);
    // Two single-cell decorations, three cells apart, directly on the straight line — otherwise open
    // ground gives straighten() room to reroute around them without violating MIN_RUN spacing.
    const deco = (id: string, x: number, y: number): void => {
      const obj: PlacedObject = { id, catalogId: 'flower-daisy', position: { x, y }, rotation: 0, elevation: 0 };
      state.objects.set(id, obj);
    };
    deco('d1', 12, 15); deco('d2', 15, 15);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const plan = planRoute(world, { x: 2, y: 15 }, { x: 25, y: 15 }, 'short');
    expect(plan).toBeTruthy();
    const bends = bendIndices(plan!.cells);
    for (let i = 1; i < bends.length; i++) expect(bends[i]! - bends[i - 1]!).toBeGreaterThanOrEqual(MIN_RUN);
  });

  it('straightening pays at most the slack over the manhattan distance', () => {
    const state = makeState(30, 30);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const from = { x: 2, y: 3 }, to = { x: 22, y: 18 };
    const plan = planRoute(world, from, to, 'short')!;
    const bends = Math.max(1, bendIndices(plan.cells).length);
    expect(plan.cells.length).toBeLessThanOrEqual(manhattan(from, to) + 1 + STRAIGHTEN_SLACK * bends);
  });

  describe('crossing choice', () => {
    const W = 40, H = 40;
    function twoRegionWorld(): { world: RouteWorld; leftId: number; rightId: number; a: ReturnType<typeof analyzeTerrain> } {
      const state = makeState(W, H);
      for (let y = 0; y < H; y++) setTerrain(state, 19, y, TerrainType.Water, 0); // a 1-wide water column
      const a = analyzeTerrain(state);
      const leftId = a.region[15 * W + 5]!, rightId = a.region[15 * W + 30]!;
      expect(leftId).not.toBe(rightId);
      const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
      return { world, leftId, rightId, a };
    }

    // Symmetric around from/to's own row, so the (toward-relative) square term is IDENTICAL for both
    // candidates whichever row they sit on — only span may decide. Approach cells sit one cell clear
    // of the water column on each side: the column erodes ITS OWN neighbours' openness too (x=18/20),
    // so the nearest genuinely open bank cells are x=17 and x=21.
    function portals(leftId: number, rightId: number, narrowY: number, wideY: number): Portal[] {
      const narrow: Portal = { kind: 'bridge', regionA: leftId, regionB: rightId, anchor: { x: 19, y: narrowY }, approachA: { x: 17, y: narrowY }, approachB: { x: 21, y: narrowY }, cost: 1 };
      const wide: Portal = { kind: 'bridge', regionA: leftId, regionB: rightId, anchor: { x: 19, y: wideY }, approachA: { x: 17, y: wideY }, approachB: { x: 27, y: wideY }, cost: 1 };
      return [narrow, wide];
    }

    it('the narrow ford wins over the near one, by span rather than distance', () => {
      const { world, leftId, rightId } = twoRegionWorld();
      const from = { x: 5, y: 15 }, to = { x: 30, y: 15 };

      const near = portals(leftId, rightId, 10, 20); // narrow(span4) at y=10, wide(span10) at y=20
      world.portals = near;
      world.regionAdj = new Map([[leftId, near], [rightId, near]]);
      const planA = planRoute(world, from, to, 'short')!;
      expect(planA.crossings[0]!.anchor).toEqual({ x: 19, y: 10 });

      const flipped = portals(leftId, rightId, 20, 10); // same spans, narrow now at y=20
      world.portals = flipped;
      world.regionAdj = new Map([[leftId, flipped], [rightId, flipped]]);
      const planB = planRoute(world, from, to, 'short')!;
      expect(planB.crossings[0]!.anchor).toEqual({ x: 19, y: 20 }); // still the span-4 anchor
    });

    it('a ramp is approached straight, and the bend is before the run', () => {
      const { world, leftId, rightId } = twoRegionWorld();
      const [p] = portals(leftId, rightId, 15, 15);
      world.portals = [p!];
      world.regionAdj = new Map([[leftId, [p!]], [rightId, [p!]]]);
      // off-axis endpoints, so the route must bend before it can enter the deck's own row.
      const plan = planRoute(world, { x: 3, y: 3 }, { x: 34, y: 27 }, 'short')!;
      expect(plan).toBeTruthy();
      const crossIdx = plan.legs.findIndex((l) => l.crossing);
      expect(crossIdx).toBeGreaterThanOrEqual(0);
      const nearTail = plan.legs[crossIdx]!.cells.slice(-2);
      expect(nearTail.every((c) => c.y === nearTail[0]!.y)).toBe(true); // the near run's own axis
      const farHead = plan.legs[crossIdx + 1]!.cells.slice(0, 2);
      expect(farHead.every((c) => c.y === farHead[0]!.y)).toBe(true); // the far run's own axis
    });
  });

  it('a plant in the way is reported, never routed through', () => {
    const W = 20, H = 30;
    const state = makeState(W, H);
    // Mountain walls 4 apart (x=9, x=13), full map height: the two grass columns touching a wall
    // (x=10, x=12) erode to non-open too, leaving x=11 as the single open column — the only line,
    // with no way around the ends since the walls run the map's whole height.
    for (let y = 0; y < H; y++) { setTerrain(state, 9, y, TerrainType.Mountain, 1); setTerrain(state, 13, y, TerrainType.Mountain, 1); }
    const deco: PlacedObject = { id: 'blocker', catalogId: 'flower-daisy', position: { x: 11, y: 15 }, rotation: 0, elevation: 0 };
    state.objects.set('blocker', deco);
    const a = analyzeTerrain(state);
    // The real footprint the generator itself uses (buildObjectOccupancy), not a hand-picked cell.
    const occupied = new Set<number>([...buildObjectOccupancy(state)].map((k) => { const [x, y] = k.split(',').map(Number); return y! * W + x!; }));
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied, style: DEFAULT_STYLE };
    const plan = planRoute(world, { x: 11, y: 2 }, { x: 11, y: 27 }, 'short');
    expect(plan).toBeTruthy();
    for (const c of occupied) expect(plan!.cells.some((p) => p.y * W + p.x === c)).toBe(false);
    // the corridor is one cell wide — there is no way round, so the plant is named.
    expect(plan!.blocked.some((c) => c.x === 11 && c.y === 15)).toBe(true);
  });

  it('the same world and the same taps give the same plan', () => {
    const state = makeState(30, 30);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const from = { x: 3, y: 4 }, to = { x: 24, y: 19 };
    const first = JSON.stringify(planRoute(world, from, to, 'short'));
    for (let i = 0; i < 10; i++) expect(JSON.stringify(planRoute(world, from, to, 'short'))).toBe(first);
  });
});
