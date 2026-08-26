import { describe, it, expect } from 'vitest';
import { makeState, setTerrain } from '../../rules/_helpers';
import { analyzeTerrain } from '../../../tools/placement/analysis';
import type { RouteWorld } from '../../../tools/placement/route';
import { routeOffers, sameRoute, OFFER_SAME } from '../../../tools/placement/route-offers';
import { TerrainType, type MacroCoord } from '../../../core/model/types';

const DEFAULT_STYLE = { turnPenalty: 0, naturalness: 1, alignment: new Map<number, 'x' | 'y'>(), materialId: undefined, source: 'default' as const };
/** A non-default style (readable off, say, a rectilinear map) so 'straight' genuinely outbids
 *  'short' on turns — at DEFAULT_STYLE's turnPenalty of 0, `astar` never charges for a turn at all,
 *  profile or no. */
const TURNY_STYLE = { ...DEFAULT_STYLE, turnPenalty: 1, naturalness: 0.5, source: 'measured' as const };

function bendIndices(cells: readonly MacroCoord[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < cells.length - 1; i++) {
    const d1 = { x: cells[i]!.x - cells[i - 1]!.x, y: cells[i]!.y - cells[i - 1]!.y };
    const d2 = { x: cells[i + 1]!.x - cells[i]!.x, y: cells[i + 1]!.y - cells[i]!.y };
    if (d1.x !== d2.x || d1.y !== d2.y) out.push(i);
  }
  return out;
}

const meanDistToWater = (world: RouteWorld, cells: readonly MacroCoord[]): number => {
  const { width: W } = world.a;
  const sum = cells.reduce((acc, c) => acc + world.a.distToWater[c.y * W + c.x]!, 0);
  return sum / cells.length;
};

describe('sameRoute', () => {
  it('the same plan is the same route', () => {
    const state = makeState(20, 20);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const [offer] = routeOffers(world, { x: 2, y: 10 }, { x: 17, y: 10 });
    expect(sameRoute(offer!.plan, offer!.plan)).toBe(true);
  });
});

describe('routeOffers', () => {
  it('open ground offers one way, not three', () => {
    const state = makeState(30, 30);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const offers = routeOffers(world, { x: 2, y: 15 }, { x: 17, y: 15 }); // 15 apart, same row
    expect(offers.length).toBe(1);
    expect(offers[0]!.profile).toBe('short');
  });

  it('an unreachable pair offers nothing', () => {
    const W = 20, H = 20;
    const state = makeState(W, H);
    for (let y = 0; y < H; y++) setTerrain(state, 10, y, TerrainType.Water, 0); // a full-height divide
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
    const offers = routeOffers(world, { x: 3, y: 10 }, { x: 17, y: 10 });
    expect(offers).toEqual([]);
  });

  it('offers are ordered deterministically', () => {
    const W = 50, H = 30;
    const state = makeState(W, H);
    // A lake most of the corridor's height, open only at the very top and bottom.
    for (let y = 3; y < H - 3; y++) setTerrain(state, 20, y, TerrainType.Water, 0);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: TURNY_STYLE };
    const from = { x: 3, y: 15 }, to = { x: 46, y: 15 };
    const first = routeOffers(world, from, to).map((o) => o.profile);
    expect(first.length).toBeGreaterThan(0);
    for (let i = 0; i < 10; i++) {
      expect(routeOffers(world, from, to).map((o) => o.profile)).toEqual(first);
    }
  });

  describe('a lake between two points', () => {
    function lakeWorld(): { world: RouteWorld; from: MacroCoord; to: MacroCoord } {
      const W = 40, H = 40;
      const state = makeState(W, H);
      // A wall of decorations blocks the direct row; a lake sits just above it, so going up and
      // over hugs the water while going down and under does not — the same detour cost either way.
      for (let x = 15; x <= 25; x++) {
        const id = `w${x}`;
        state.objects.set(id, { id, catalogId: 'flower-daisy', position: { x, y: 20 }, rotation: 0, elevation: 0 });
      }
      for (let x = 15; x <= 25; x++) setTerrain(state, x, 18, TerrainType.Water, 0);
      const a = analyzeTerrain(state);
      const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: DEFAULT_STYLE };
      return { world, from: { x: 10, y: 20 }, to: { x: 30, y: 20 } };
    }

    it('offers a way round and a way across, genuinely different', () => {
      const { world, from, to } = lakeWorld();
      const offers = routeOffers(world, from, to);
      expect(offers.length).toBeGreaterThanOrEqual(2);
      for (let i = 0; i < offers.length; i++) {
        for (let j = i + 1; j < offers.length; j++) {
          expect(sameRoute(offers[i]!.plan, offers[j]!.plan)).toBe(false);
        }
      }
    });

    it('the scenic way is the one that hugs the water', () => {
      const { world, from, to } = lakeWorld();
      const offers = routeOffers(world, from, to);
      const scenic = offers.find((o) => o.profile === 'scenic');
      const short = offers.find((o) => o.profile === 'short');
      expect(scenic).toBeTruthy();
      expect(short).toBeTruthy();
      expect(meanDistToWater(world, scenic!.plan.cells)).toBeLessThan(meanDistToWater(world, short!.plan.cells));
    });
  });

  it('the straight way bends less', () => {
    const W = 60, H = 40;
    const state = makeState(W, H);
    // A comb of 4 tall teeth, each leaving only a narrow alternating gap near the direct row: the
    // cheapest walk weaves through every gap (short, many bends); going around the whole comb (past
    // its top or bottom) is a single longer detour with far fewer of them.
    const teeth = [
      { x: 12, gapLo: 18, gapHi: 21 },
      { x: 18, gapLo: 22, gapHi: 25 },
      { x: 24, gapLo: 18, gapHi: 21 },
      { x: 30, gapLo: 22, gapHi: 25 },
    ];
    for (const t of teeth) for (let y = 10; y <= 30; y++) if (y < t.gapLo || y > t.gapHi) setTerrain(state, t.x, y, TerrainType.Mountain, 1);
    const a = analyzeTerrain(state);
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: TURNY_STYLE };
    const from = { x: 5, y: 20 }, to = { x: 45, y: 23 };
    const offers = routeOffers(world, from, to);
    const straight = offers.find((o) => o.profile === 'straight');
    const short = offers.find((o) => o.profile === 'short');
    expect(straight).toBeTruthy();
    expect(short).toBeTruthy();
    expect(bendIndices(straight!.plan.cells).length).toBeLessThanOrEqual(bendIndices(short!.plan.cells).length);
  });
});

describe('OFFER_SAME', () => {
  it('a one-cell jog is not a different way to go', () => {
    const base: MacroCoord[] = [];
    for (let x = 0; x <= 20; x++) base.push({ x, y: 10 });
    const jogged = base.map((c) => (c.x === 10 ? { x: c.x, y: 11 } : c));
    const a = { profile: 'short' as const, from: base[0]!, to: base[base.length - 1]!, legs: [], cells: base, crossings: [], pads: [], blocked: [], cost: 0 };
    const b = { ...a, cells: jogged };
    expect(sameRoute(a, b)).toBe(true);
    expect(OFFER_SAME).toBeGreaterThan(0);
  });
});

describe('the straight profile is itself at every style', () => {
  it('differs from short even where the map style carries no turn penalty', () => {
    // A `turnPenalty > 0` gate inside astar closes before the profile's own turn cost is consulted, which
    // makes 'straight' equal 'short' on every organic-default map. Same comb fixture as above, at a
    // ZERO-turn-penalty style.
    const W = 60, H = 40;
    const state = makeState(W, H);
    const teeth = [
      { x: 12, gapLo: 18, gapHi: 21 },
      { x: 18, gapLo: 22, gapHi: 25 },
      { x: 24, gapLo: 18, gapHi: 21 },
      { x: 30, gapLo: 22, gapHi: 25 },
    ];
    for (const t of teeth) for (let y = 10; y <= 30; y++) if (y < t.gapLo || y > t.gapHi) setTerrain(state, t.x, y, TerrainType.Mountain, 1);
    const a = analyzeTerrain(state);
    const zeroTurn = { ...TURNY_STYLE, turnPenalty: 0, naturalness: 1 };
    const world: RouteWorld = { a, portals: [], regionAdj: new Map(), road: new Set(), occupied: new Set(), style: zeroTurn };
    const offers = routeOffers(world, { x: 5, y: 20 }, { x: 45, y: 23 });
    const straight = offers.find((o) => o.profile === 'straight');
    const short = offers.find((o) => o.profile === 'short');
    expect(straight).toBeTruthy();
    expect(short).toBeTruthy();
    expect(bendIndices(straight!.plan.cells).length).toBeLessThan(bendIndices(short!.plan.cells).length);
  });
});
