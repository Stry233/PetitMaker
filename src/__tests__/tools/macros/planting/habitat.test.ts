/**
 * The habitat field, and the community one press plants over it.
 *
 * Two claims are worth a test and nothing else here is: that the ground decides (a water-loving
 * species keeps to the shore and a dry-loving one keeps off it, on the same fixture, from the same
 * pool of candidate cells), and that a press reads as one community rather than a species lottery
 * (a seed-derived dominant takes most of the stand, and a different seed takes a different one).
 *
 * The fixture puts a pond in the west and a terraced butte in the east, and aims the press between
 * them so its disc spans both gradients: a wet, sheltered shore, an ordinary dry middle, and an
 * exposed top. Aiming at any one of the three would let a picker that ignored habitat pass.
 */
import { describe, it, expect } from 'vitest';
import { TerrainType, type GridState } from '../../../../core/model/types';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import { getPlaceableByCategory } from '../../../../state/catalog';
import { applyMacro } from '../../../../tools/macros';
import {
  buildAreaCommunity, buildCommunity, buildHabitatField, dominantSpecies, PATCH_SPAN,
} from '../../../../tools/macros/planting/habitat';
import { plantPatch } from '../../../../tools/macros';
import type { EditContext } from '../../../../core/commands/edit-context';
import { makeState, setTerrain, makeExecutor } from '../../../_support/map-state';
import { ItemCategory } from '../../../../config/catalog/categories';

const SIZE = 40;
/** A pond in the west: every cell of it water, so the moisture gradient runs east from x = 15. */
const POND = { x0: 8, x1: 14, y0: 14, y1: 26 };
/** A butte in the east, flat on top and terraced down its sides one tier at a time (so V-MTN-03
 *  holds by construction and the top has open interior to plant). */
const BUTTE = { at: { x: 28, y: 20 }, flat: 3, peak: 4 };
/** Between the two, on the ordinary ground: a press aimed at the shore or at the summit would
 *  choose its community from one niche and never meet the other. */
const AT = { x: 21, y: 20 };
const RADIUS = 8;

function pondState(): GridState {
  const state = makeState(SIZE, SIZE);
  for (let y = POND.y0; y <= POND.y1; y++) {
    for (let x = POND.x0; x <= POND.x1; x++) setTerrain(state, x, y, TerrainType.Water, 0);
  }
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const d = Math.max(Math.abs(x - BUTTE.at.x), Math.abs(y - BUTTE.at.y));
      const tier = Math.min(BUTTE.peak, BUTTE.peak - (d - BUTTE.flat));
      for (let e = 1; e <= tier; e++) setTerrain(state, x, y, TerrainType.Mountain, e);
    }
  }
  return state;
}

/** Open grass, nothing else: one habitat everywhere, which is the site a stand's purity means
 *  something on. On the mixed fixture above a community is supposed to thin out as it crosses into
 *  ground it does not want, so measuring purity there would be measuring the habitat field. */
const plainState = (): GridState => makeState(SIZE, SIZE);

function kitFor(state: GridState): EditContext {
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/** How far each planted object of `family` ended up from the nearest water cell. */
function waterDistances(state: GridState, family: string): number[] {
  const a = analyzeTerrain(state);
  const out: number[] = [];
  for (const o of state.objects.values()) {
    if (!o.catalogId.startsWith(family)) continue;
    out.push(a.distToWater[o.position.y * a.width + o.position.x]!);
  }
  return out;
}

const mean = (xs: readonly number[]): number => xs.reduce((s, v) => s + v, 0) / xs.length;

describe('the habitat field', () => {
  it('reads moisture off the water, exposure off the tiers, and edge off the ground running out', () => {
    const field = buildHabitatField(analyzeTerrain(pondState()));
    const at = (x: number, y: number) => {
      const i = y * SIZE + x;
      return { moisture: field.moisture[i]!, exposure: field.exposure[i]!, edge: field.edge[i]! };
    };

    expect(at(15, 20).moisture, 'the cell beside the pond is wet').toBeGreaterThan(0.8);
    expect(at(21, 20).moisture, 'the middle is barely damp').toBeLessThan(0.2);
    expect(at(15, 20).moisture).toBeGreaterThan(at(19, 20).moisture);

    expect(at(28, 20).exposure, 'the summit is exposed').toBeGreaterThan(0.6);
    expect(at(21, 8).exposure, 'open flat ground away from any step is sheltered').toBe(0);
    // The cell at the foot of the butte sits against a cliff, so it is more exposed than open flat.
    expect(at(24, 20).exposure).toBeGreaterThan(at(21, 8).exposure);

    expect(at(15, 20).edge, 'the shoreline IS the edge of the plantable ground').toBeGreaterThan(0.5);
    expect(at(21, 8).edge, 'open ground far from anything is interior').toBeLessThan(0.2);
  });
});

describe('species sort themselves by habitat', () => {
  /**
   * The two species are drawn from the same candidate cells — `placeNature` decides where a plant
   * goes before anything decides what it is — so the whole difference between the two distributions
   * is the preference table doing its work.
   */
  it('plants the water-lover near water and the dry-lover away from it', () => {
    const wet: number[] = [], dry: number[] = [];
    for (let seed = 1; seed <= 80; seed++) {
      const kit = kitFor(pondState());
      applyMacro(kit, 'patch-flora', { seed, at: AT, radius: RADIUS });
      wet.push(...waterDistances(kit.state, 'flower-lily'));
      dry.push(...waterDistances(kit.state, 'plant-agave'));
    }
    expect(wet.length, 'the sweep planted no water-lover at all').toBeGreaterThan(10);
    expect(dry.length, 'the sweep planted no dry-lover at all').toBeGreaterThan(10);
    expect(mean(wet), 'the water-lover is not closer to water than the dry-lover').toBeLessThan(mean(dry) - 4);
    // And not merely closer on average: it never strays past the moisture reach at all, while the
    // dry-lover is out on ground the shore's influence does not reach.
    expect(Math.max(...wet), 'a water-lover was planted on dry ground').toBeLessThanOrEqual(8);
    expect(Math.max(...dry), 'the dry-lover never left the shore').toBeGreaterThan(8);
  });
});

/** The share of a category's planting that is its single most-planted species, among the objects
 *  `keep` admits. */
function purity(state: GridState, category: ItemCategory, keep: (x: number, y: number) => boolean = () => true): { share: number; top: string; total: number } {
  const ids = new Set(getPlaceableByCategory(category).map((i) => i.id));
  const tally = new Map<string, number>();
  let total = 0;
  for (const o of state.objects.values()) {
    if (!ids.has(o.catalogId) || !keep(o.position.x, o.position.y)) continue;
    tally.set(o.catalogId, (tally.get(o.catalogId) ?? 0) + 1);
    total++;
  }
  let top = '', best = 0;
  for (const [id, n] of tally) if (n > best) { best = n; top = id; }
  return { share: total ? best / total : 0, top, total };
}

describe('one press is one community', () => {

  it.each([
    ['patch-flora', ItemCategory.Flora],
    ['patch-tree', ItemCategory.Tree],
  ] as const)('%s: a dominant species takes most of the stand, and the seed picks which', (id, category) => {
    const shares: number[] = [];
    const dominants = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const kit = kitFor(plainState());
      applyMacro(kit, id, { seed, at: AT, radius: RADIUS });
      const p = purity(kit.state, category);
      if (p.total < 8) continue; // too small a stand for a share to mean anything
      shares.push(p.share);
      dominants.add(p.top);
    }
    expect(shares.length, 'the sweep planted almost nothing').toBeGreaterThan(15);
    expect(mean(shares), 'the planting is a species lottery, not a community').toBeGreaterThan(0.6);
    expect(Math.min(...shares), 'one press came out with no dominant species at all').toBeGreaterThan(0.4);
    expect(dominants.size, 'every seed planted the same dominant species').toBeGreaterThan(2);
  });

  it('derives the dominant from the press seed alone, given the site', () => {
    const field = buildHabitatField(analyzeTerrain(pondState()));
    const centre = AT.y * SIZE + AT.x;
    const pool = getPlaceableByCategory(ItemCategory.Flora).map((i) => i.id);
    const picked = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) {
      const a = dominantSpecies(pool, field, centre, seed);
      expect(a, 'the same seed named a different dominant on a second call').toBe(dominantSpecies(pool, field, centre, seed));
      picked.add(a);
    }
    expect(picked.size, 'the seed does not move the dominant').toBeGreaterThan(3);
  });
});

describe('a large planting varies its community by patch', () => {
  const W = 170, H = 140;
  const RECT = { x: 20, y: 20, w: 130, h: 100 };
  const rectCells = (r: typeof RECT) => {
    const cells = [];
    for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) cells.push({ x, y });
    return cells;
  };

  it('leads different parts of a wide forest with different species, each part still a stand', () => {
    const kit = kitFor(makeState(W, H));
    plantPatch(kit, { cells: rectCells(RECT), density: 0.6, seed: 0x4d616d65 });
    const whole = purity(kit.state, ItemCategory.Tree);
    expect(whole.total).toBeGreaterThan(300);
    expect(whole.share, 'one species leads the whole rect').toBeLessThan(0.4);
    const leaders = new Set<string>();
    const shares: number[] = [];
    for (let y = RECT.y; y + PATCH_SPAN <= RECT.y + RECT.h; y += PATCH_SPAN) {
      for (let x = RECT.x; x + PATCH_SPAN <= RECT.x + RECT.w; x += PATCH_SPAN) {
        const part = purity(kit.state, ItemCategory.Tree, (px, py) => px >= x && px < x + PATCH_SPAN && py >= y && py < y + PATCH_SPAN);
        if (part.total < 10) continue;
        leaders.add(part.top);
        shares.push(part.share);
      }
    }
    expect(leaders.size, 'every part of the forest has the same leader').toBeGreaterThan(2);
    expect(mean(shares), 'the parts are species lotteries, not stands').toBeGreaterThan(0.4);
  });

  it('plants an area that fits one patch as the single community chosen for its centre', () => {
    const field = buildHabitatField(analyzeTerrain(pondState()));
    const centre = AT.y * SIZE + AT.x;
    const area = buildAreaCommunity(field, { x: 10, y: 10, w: PATCH_SPAN, h: PATCH_SPAN }, SIZE, centre, 9);
    const single = buildCommunity(field, centre, 9);
    const pool = getPlaceableByCategory(ItemCategory.Tree).map((i) => i.id);
    for (let y = 10; y < 10 + PATCH_SPAN; y++) {
      for (let x = 10; x < 10 + PATCH_SPAN; x++) {
        expect(area(ItemCategory.Tree, pool, x, y, y * SIZE + x)).toBe(single(ItemCategory.Tree, pool, x, y, y * SIZE + x));
      }
    }
  });
});

describe('determinism', () => {
  it('plants the same species in the same places at the same seed', () => {
    const shape = (): string => {
      const kit = kitFor(pondState());
      applyMacro(kit, 'patch-flora', { seed: 12, at: AT, radius: RADIUS });
      return [...kit.state.objects.values()].map((o) => `${o.catalogId}@${o.position.x},${o.position.y}`).sort().join('|');
    };
    const a = shape();
    expect(a.length).toBeGreaterThan(0);
    expect(shape()).toBe(a);
  });
});
