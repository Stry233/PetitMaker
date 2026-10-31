// The designed generator's promises, drawn from the design methodology and the two decoded reference
// maps: hard rules fail outright, soft preferences have score floors, and the distance to the style
// target has a ceiling.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; several seconds per case on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { ItemCategory } from '../../../config/catalog/categories';
import { objectRect } from '../../../state/object-geometry';
import type { GridState, MacroCoord, MapTemplate } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../tools/generation/recipe';
import { categoryOf } from '../../../state/catalog';
import { MAP_TEMPLATES } from '../../../config/maps/index';
import { templateLandmarkObjects } from '../../../core/model/landmarks';
import { createGridState } from '../../../core/model/template';
import { planComposition } from '../../../tools/generation/designer/composition/composition';
import {
  bankDressing, bridgeAlignment, decorGrain, evaluateMap, figureReading, referenceDistance,
  singularArrivals, terraceShape,
  DEAD_END_MAX, DECOR_DENSITY_BAND, ONE_WIDE_MAX, REACHABLE_MIN, SET_PIECE_CELLS_MIN,
  SET_PIECE_FLOOR, TERRACE_FILL_MAX,
} from '../../_support/design-eval';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { memo } from './designer/_designed-map';
import { makeExecutor } from '../../_support/map-state';
import { runCandidateOn } from '../../../tools/generation/run/generation-run';
import { generateWith } from '../../_support/generation';

function generateDesignedMap(seed: number, template: MapTemplate, richness: number): { state: GridState; violations: number; refused: number } {
  const state: GridState = {
    template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) state.objects.set(plaza.id, plaza);
  const exec = makeExecutor(state);
  const config: GenerateConfig = defaultConfig('designed', { maxElevation: ELEVATION_MAX, seed, richness });
  let refused = 0;
  const start = exec.beginStroke();
  exec.transaction({ silent: true }, () => {
    refused = generateWith(state, exec, config).skipped;
  });
  const violations = start.commit().length;
  return { state, violations, refused };
}

/** `generateDesignedMap`, generated once per (seed, template, richness) for this file. Read-only. */
const designed = memo(generateDesignedMap);

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
/** Pinned, so a probe that fails names a map that can be rebuilt and looked at. */
const DESIGNED_SEEDS = [12345, 777, 42];
/** Includes the lowest seeds of a ten-seed sweep (7 for unity, 1024 for symmetry), so a floor cannot
 *  pass on a lucky batch. */
const SCORE_SEEDS = [12345, 777, 7, 1024];
/**
 * The batch symmetry floor is a mean over eight seeds. Symmetry is read over the one-level runs of
 * open ground a planet's terraces and streets leave, so one seed swings widely (0.44 to 0.70 at
 * richness 0.6) and moves with a one-cell shift of the plaza; a four-seed mean moves almost as much.
 */
const SYMMETRY_SEEDS = [...SCORE_SEEDS, 42, 2026, 314, 271];

/**
 * Per-seed floors: each says the operator ran on this map, since how many regions can carry a mirror,
 * one colour family or a backed door depends on how the planet's terrain cut its open ground. The
 * reference shares are claimed by the batch means instead. Each sits under the worst of a ten-seed
 * sweep on hexia at richness 0.2, 0.6 and 1, whose figures are quoted.
 */
const FLOOR = {
  /** Sweep minimum 0.25 (quiet and mid), 0.42 at full richness; means 0.36 / 0.41 / 0.58. */
  backing: 0.2,
  /** Sweep minimum 0.50 over the wall archetypes at richness >= 0.5 (0.50 / 0.57 / 0.58 / 0.69 at
   *  full richness). The compositions that claim no direction are read, not floored. */
  monotonic: 0.45,
  /**
   * Sweep minimum 0.40 (both templates), means 0.77 to 0.83; worst 0.33 at full richness over this
   * batch. Two constructions lower it: the movement line is a third, widest rank that moves pavement
   * into the trunk band, and a staggered street's leg the ground cuts short is laid at branch width.
   * The references have no primary walk, so this floor only catches the hierarchy vanishing.
   */
  hierarchy: 0.30,
  /** The batch mean at full richness: 0.54 over this batch, 0.68 over twenty-five seeds. */
  hierarchyBatch: 0.52,
  /**
   * Sweep minimum 0.43 at full richness, means 0.76 / 0.67 / 0.56; 0.29 to 0.71 at full richness over
   * this batch. A terrace step splits a place into two one-level runs and its mirror counts in
   * neither, so terraced planets read low; the floor catches the operator not running.
   */
  symmetry: 0.25,
  /** Sweep minimum 0.45, at full richness; means 0.91 / 0.90 / 0.77. */
  unity: 0.4,
} as const;

/**
 * How far above the reference's decor-density band a seed may read: every seed reads inside it. The
 * pressure is the water share (7% to 12% of the planet): less water leaves more ground to plant.
 */
const DENSITY_EDGE = 0;

describe('the designed generator', () => {
  it('HARD RULES: every anchor once, the plaza reaches the network, no dead end, no 1-wide road', () => {
    for (const [template, richness] of [[HEXIA, 1], [HEXIA, 0.2], [TAFA, 0.6]] as const) {
      for (const seed of DESIGNED_SEEDS) {
        const { state, violations, refused } = designed(seed, template, richness);
        const where = `${template.id}/${seed}/r${richness}`;
        const { hard } = evaluateMap(state);
        expect(hard.allAnchorsPlaced.missing, where).toEqual([]);
        expect(hard.allAnchorsPlaced.repeated, where).toEqual([]);
        expect(hard.roadsConnected.reachableShare, where).toBeGreaterThanOrEqual(REACHABLE_MIN);
        expect(hard.roadsConnected.deadEndShare, where).toBeLessThanOrEqual(DEAD_END_MAX);
        expect(hard.noOneWideRoads.oneWideShare, where).toBeLessThanOrEqual(ONE_WIDE_MAX);
        // The pipeline commits through the live registry, so a standing violation means the map is
        // not what the plan drew.
        expect(violations, where).toBe(0);
        expect(refused, where).toBe(0);
      }
    }
  }, 120_000);

  it('SOFT PREFERENCES: the methodology scores hold their floors across the richness range', () => {
    // Read per richness, never pooled: the composition scores fall as richness rises, so a pooled
    // floor would let the rich end, where the style target is, hide behind the quiet end.
    for (const richness of [0.2, 0.6, 1]) {
      const symmetry = SYMMETRY_SEEDS.filter((seed) => !SCORE_SEEDS.includes(seed))
        .map((seed) => evaluateMap(designed(seed, HEXIA, richness).state).scores.symmetryShare);
      const hierarchy: number[] = [];
      const unity: number[] = [];
      for (const seed of SCORE_SEEDS) {
        const { state } = designed(seed, HEXIA, richness);
        const where = `hexia/${seed}/r${richness}`;
        const { scores, metrics } = evaluateMap(state);
        // The garden-town reference backs 0 of 12 buildings; a quiet planet's backing floor comes
        // from the strip behind each lot's own door.
        expect(scores.backingCoverage, where).toBeGreaterThanOrEqual(FLOOR.backing);
        // Monotonicity scales with how much of the reference's 5.56-layer spread a map spends, and
        // a rim, scattered massifs or low relief is monotone along no axis, so the floor holds only
        // for a wall archetype at richness 0.5 or more.
        const archetype = planComposition({ seed, template: HEXIA, richness }).archetype;
        const walled = archetype === 'north-wall' || archetype === 'south-wall'
          || archetype === 'east-wall' || archetype === 'west-wall';
        if (richness >= 0.5 && walled) {
          expect(scores.heightMonotonicity, `${where} (${archetype})`)
            .toBeGreaterThanOrEqual(FLOOR.monotonic);
        }
        expect(metrics.objects.decorDensity, where).toBeGreaterThanOrEqual(DECOR_DENSITY_BAND[0]);
        expect(metrics.objects.decorDensity, where).toBeLessThanOrEqual(DECOR_DENSITY_BAND[1] + DENSITY_EDGE);
        expect(scores.roadHierarchyMix, where).toBeGreaterThanOrEqual(FLOOR.hierarchy);
        expect(scores.symmetryShare, where).toBeGreaterThanOrEqual(FLOOR.symmetry);
        expect(scores.unityShare, where).toBeGreaterThanOrEqual(FLOOR.unity);
        hierarchy.push(scores.roadHierarchyMix);
        symmetry.push(scores.symmetryShare);
        unity.push(scores.unityShare);
      }
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
      const hierarchyMean = mean(hierarchy);
      expect(hierarchyMean, `r${richness} batch road mix ${hierarchyMean.toFixed(2)}`)
        .toBeGreaterThanOrEqual(FLOOR.hierarchyBatch);
      // Both read per one-level run of open ground, and a richer planet cuts a place into more runs
      // (terrace steps, staggered streets), so both fall with richness. Symmetry over
      // `SYMMETRY_SEEDS` measures 0.50 at richness 1, 0.55 at 0.6 and 0.66 at 0.2; unity over the
      // score seeds 0.65 at richness 1 and 0.70 at 0.6.
      const symFloor = richness >= 1 ? 0.42 : 0.52;
      const uniFloor = richness >= 1 ? 0.64 : 0.70;
      expect(mean(symmetry), `r${richness} batch symmetry ${mean(symmetry).toFixed(2)}`).toBeGreaterThanOrEqual(symFloor);
      expect(mean(unity), `r${richness} batch unity ${mean(unity).toFixed(2)}`).toBeGreaterThanOrEqual(uniFloor);
    }
  }, 180_000);

  /**
   * The reference reads 2.65 bits of level entropy over six levels, 47% of its pavement above level 4,
   * 2.85 level changes per 100 pavement cells and 70.8% with sight of the mass; the floors are what
   * this batch reaches. A map asked for the top layer must reach it.
   */
  it('THE CLIMB: the asked height is built, the walk stands on it and can see it', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => evaluateMap(designed(seed, template, 1).state).climb);
      const where = `${template.id}`;
      const mean = (pick: (c: typeof rows[number]) => number): number =>
        rows.reduce((a, c) => a + pick(c), 0) / rows.length;
      // Two of three: the low-relief archetype has its own ceiling and any seed may draw it.
      expect(rows.filter((c) => c.peak >= ELEVATION_MAX).length, `${where}: peaks ${rows.map((c) => c.peak).join(',')}`)
        .toBeGreaterThanOrEqual(2);
      // Catches a single-storey walk; the methodology's bar is 70%, which the worst seed sits on.
      for (const c of rows) {
        expect(c.topLevelShare, `${where}: top level ${(100 * c.topLevelShare).toFixed(0)}%`)
          .toBeLessThanOrEqual(0.8);
      }
      // This batch measures 1.82 and 2.17 bits (hexia, tafa), 4.7 and 5.7 paved levels, 0.92 and
      // 1.56 level changes per 100 cells, 21.7% and 25.9% sight of the mass. The sight floor is 0.12
      // because the ten-seed gate batch reads exactly 15% on hexia.
      expect(mean((c) => c.entropy), `${where}: entropy ${mean((c) => c.entropy).toFixed(2)}`).toBeGreaterThan(1.3);
      expect(mean((c) => c.levels), `${where}: levels`).toBeGreaterThanOrEqual(3);
      expect(mean((c) => c.eventsPer100), `${where}: level changes / 100`).toBeGreaterThan(0.7);
      expect(mean((c) => c.seesMass), `${where}: sees mass ${(100 * mean((c) => c.seesMass)).toFixed(1)}%`)
        .toBeGreaterThan(0.12);
      // The reference stands 47% of its pavement above level 4, this batch 7.8% (hexia) to 21.4%
      // (tafa). Raising the composition's floor starves some seeds of streets (a terrace narrower than
      // a stamp carries no pavement), so the gap closes with wider terraces, not more height.
      expect(mean((c) => c.aboveMid), `${where}: above mid ${(100 * mean((c) => c.aboveMid)).toFixed(1)}%`)
        .toBeGreaterThan(0.03);
    }
  }, 180_000);

  /**
   * From the set-piece richness up, a planet carries one figure drawn as the largest panel its ground
   * offers, with a calm band reserved around it. The floors are the generation gate's own measurements.
   */
  it('THE SET PIECE: one composed figure per planet, framed, and the walk reaches it', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => {
        const { state } = designed(seed, template, 1);
        return { seed, figure: figureReading(state), arrivals: singularArrivals(state) };
      });
      for (const { seed, figure } of rows) {
        const where = `${template.id}/${seed}`;
        // The reference's figures are 772 and 330 cells (its water reads 1010); ours run 100 to 467
        // over the gate batch, and the floor sits under the smallest.
        expect(figure.largest, `${where}: figure ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_CELLS_MIN);
        // The calm (paved or bare) share of the band around the figure: references 1.00 and 0.92,
        // our worst seed 0.73.
        expect(figure.framed, `${where}: framed ${figure.framed.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
      }
      // Pavement within a dozen cells of the figure: the largest clear one-tier panel is often ground
      // the streets never climbed. These seeds measure 4, 9 and 12 on hexia and 3, 4 and 5 on tafa.
      const reached = rows.filter((r) => r.figure.toPavement >= 0 && r.figure.toPavement <= 12);
      expect(reached.length, `${template.id}: ${rows.map((r) => r.figure.toPavement).join(', ')} cells to pavement`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  /**
   * Full-richness claims only, so they stay out of the hard ledger's verdict: a quiet garden town has no
   * figure to end at and no room for a large court.
   */
  it('ARRIVALS: a walk finishes at one of the planet\'s set pieces, and a court is one of them', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => {
        const { state } = designed(seed, template, 1);
        const e = evaluateMap(state);
        return { seed, place: e.hard.arrivesAtPlace, courts: e.water.fountains, decks: bridgeAlignment(state) };
      });
      for (const { seed, place, courts } of rows) {
        const where = `${template.id}/${seed}`;
        expect(place.places, `${where}: the planet carries a set piece at all`).toBeGreaterThan(0);
        // Separate claims: a court exists, and the reading sees it (a moat one level deep would
        // shatter under the 4-connected decomposition every reading takes).
        expect(courts.courts, `${where}: formal courts read on the map`).toBeGreaterThan(0);
        expect(courts.related, `${where}: courts composed against a space`).toBeGreaterThan(0);
        expect(courts.perRegion, `${where}: main fountains in one region`).toBeLessThanOrEqual(1);
      }
      // No deck lies across the street it meets, at every seed; both references read zero. `aligned`
      // is not gated: the terraced reference's decks cross water between banks whose streets run
      // along them, reading 0 of 5.
      for (const { seed, decks } of rows) {
        expect(decks.crossways,
          `${template.id}/${seed}: ${decks.crossways} of ${decks.bridges} decks lie across a street`)
          .toBe(0);
      }
      // A batch claim: at full richness one seed in twenty (`tafa/777`) arrives at no place.
      const ended = rows.filter((r) => r.place.pass);
      expect(ended.length,
        `${template.id}: arrivals ${rows.map((r) => `${r.place.arrivedAt}/${r.place.places}`).join(', ')}`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  /**
   * A claim about direction, not parity: the reference has both flora masses and specimen trees. A
   * rich planet's open ground comes in runs of a few dozen cells that clip a bed, so cluster counts
   * track the run count.
   */
  it('TWO GRAINS: flowers land as beds and trees as specimens, not all at one middling size', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => decorGrain(designed(seed, template, 1).state));
      const mean = (pick: (g: typeof rows[number]) => number): number =>
        rows.reduce((a, g) => a + pick(g), 0) / rows.length;
      // A lattice plants one cell in four, so a tree cluster's median runs 3 to 4 against the
      // reference's 1.
      expect(mean((g) => g.treeMedian), `tree median ${mean((g) => g.treeMedian)}`).toBeLessThanOrEqual(6);
      // This batch measures masses at 7% to 25% and the middle at 69% to 87%.
      expect(mean((g) => g.massShare), `mass share ${mean((g) => g.massShare).toFixed(2)}`)
        .toBeGreaterThan(0.05);
      expect(mean((g) => g.middleShare), `middle share ${mean((g) => g.middleShare).toFixed(2)}`)
        .toBeLessThan(0.9);
    }
  });

  /**
   * Fill is how much of its bounding box the median terrace component covers: 0.58 on the terraced
   * reference, 1.00 for a map of boxes. Dressing is the share of water bodies with a composed bank row.
   */
  it('THE LANDFORM AND THE DRESSING: terraces are not boxes, and a body is composed against (I5.3)', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of DESIGNED_SEEDS) {
        const { state } = designed(seed, template, 1);
        const where = `${template.id}/${seed}`;
        const shape = terraceShape(state);
        expect(shape.medianFill, `${where}: median terrace box fill ${shape.medianFill.toFixed(2)}`)
          .toBeLessThanOrEqual(TERRACE_FILL_MAX);
        // The terraced reference reads 0.24 (9 of 38), this batch 0.20 to 0.55.
        expect(shape.boxyShare, `${where}: boxy share ${shape.boxyShare.toFixed(2)}`)
          .toBeLessThan(0.7);
        // The floor and its argument live in `_support/design-eval/figure.ts`. The figure ladder ratio
        // is not gated: the reference's own two figures read 1010 and 971.
        const figure = figureReading(state);
        expect(figure.largest, `${where}: set piece ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_FLOOR);
        const dressing = bankDressing(state);
        expect(dressing.bodies, `${where}: bodies of 15 cells or more`).toBeGreaterThan(5);
        // A ratchet on our own grammar, not a reference bar: the references plant their banks as beds
        // and step-2 lattices, not the same-species row this reading finds, so they read 13% and 0%.
        // Our full-richness seeds read 31% to 81%.
        expect(dressing.dressedShare, `${where}: ${dressing.dressed} of ${dressing.bodies} dressed`)
          .toBeGreaterThanOrEqual(0.25);
      }
    }
  }, 180_000);

  it('RICHNESS IS THE STYLE AXIS: quiet maps are flat garden towns, full ones are terraced planets', () => {
    const quiet = DESIGNED_SEEDS.map((seed) => evaluateMap(designed(seed, HEXIA, 0.2).state).metrics);
    const full = DESIGNED_SEEDS.map((seed) => evaluateMap(designed(seed, HEXIA, 1).state).metrics);
    const mean = (rows: typeof quiet, pick: (m: typeof quiet[number]) => number): number =>
      rows.reduce((a, m) => a + pick(m), 0) / rows.length;

    // The references sit at the ends: the garden town is 99% ground level with 15% water and 6.6
    // flowers per tree; the target terraces almost everything, has water on every layer and runs
    // 1 : 1.12. The quiet mountain bound is 0.35 (measured 0.32) because no water bed is cut into a
    // terrace, so that ground reads as mountain.
    expect(mean(quiet, (m) => m.elevation.mountainShare)).toBeLessThan(0.35);
    expect(mean(full, (m) => m.elevation.mountainShare)).toBeGreaterThan(0.45);
    expect(mean(quiet, (m) => m.elevation.waterShare)).toBeLessThan(mean(full, (m) => m.elevation.waterShare));
    expect(mean(quiet, (m) => m.elevation.quarterMeans[1]!)).toBeLessThan(0.6);
    expect(mean(full, (m) => m.elevation.quarterMeans[1]!)).toBeGreaterThan(1.2);
    expect(mean(quiet, (m) => m.objects.treeToFlora)).toBeGreaterThan(3);
    expect(mean(full, (m) => m.objects.treeToFlora)).toBeLessThan(2);
  }, 120_000);

  it('REFERENCE DISTANCE: a full-richness planet stands in the style target\'s neighbourhood', () => {
    const totals: number[] = [];
    for (const seed of DESIGNED_SEEDS) {
      const { state } = designed(seed, HEXIA, 1);
      const d = referenceDistance(evaluateMap(state).metrics);
      totals.push(d.total);
    }
    // A loose ceiling: the reference's profile term favours a north wall, so a tight bound would
    // force every map into that one composition. It catches a map with no relief, no water or a road
    // mix out of band.
    const mean = totals.reduce((a, b) => a + b, 0) / totals.length;
    for (const [i, total] of totals.entries()) {
      expect(total, `hexia/${DESIGNED_SEEDS[i]}`).toBeLessThanOrEqual(0.30);
    }
    expect(mean, `batch reference distance ${mean.toFixed(3)}`).toBeLessThanOrEqual(0.25);
  }, 120_000);

  it('deterministic: the same seed and richness reproduce the identical map', () => {
    const digest = (s: GridState): string => [
      s.cells.flat().map((c) => `${c.terrain?.type ?? '-'}${c.terrain?.elevation ?? 0}`).join(''),
      [...s.objects.values()]
        .map((o) => `${o.catalogId}@${o.position.x},${o.position.y}r${o.rotation}`)
        .sort().join('|'),
    ].join('#');
    expect(digest(generateDesignedMap(2026, HEXIA, 0.7).state)).toBe(digest(generateDesignedMap(2026, HEXIA, 0.7).state));
  }, 60_000);
});

// The painted region.

/** One designed run confined to `region` on a fresh map, through the app's own run (scope cleared,
 *  generator, seam repair, one commit). */
async function generateDesignedIn(seed: number, template: MapTemplate, richness: number, region: MacroCoord[]): Promise<{
  state: GridState; violations: number;
}> {
  const state: GridState = {
    template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  };
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) state.objects.set(plaza.id, plaza);
  const config: GenerateConfig = defaultConfig('designed', { maxElevation: ELEVATION_MAX, seed, region, richness });
  const { outcome } = await runCandidateOn(state, { config, region, rules: 'default' });
  return { state, violations: outcome.violations.length };
}

/** `generateDesignedIn`, generated once per argument list for this file. Read-only. */
const designedIn = memo(generateDesignedIn);

/** Whether the run changed cell (x, y)'s terrain from what the fresh map holds there. */
function written(state: GridState, x: number, y: number): boolean {
  const before = FRESH.get(state.template.id)!.cells[y]![x]!.terrain;
  const after = state.cells[y]![x]!.terrain;
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}
const FRESH = new Map([HEXIA, TAFA].map((t) => [t.id, createGridState(t)] as const));

function rectRegion(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

describe('a designed run inside a painted region', () => {
  // Three parts of the planet's design: the northern backing band, the town around the plaza and the
  // southern ground.
  const REGIONS: readonly (readonly [string, MacroCoord[]])[] = [
    ['the wall', rectRegion(40, 12, 96, 40)],
    ['the town', rectRegion(50, 62, 104, 96)],
    ['the south', rectRegion(30, 96, 90, 126)],
  ];

  it('touches nothing outside it: no cell written, no object placed', async () => {
    for (const [what, region] of REGIONS) {
      for (const seed of [12345, 777]) {
        const { state, violations } = await designedIn(seed, HEXIA, 1, region);
        const inside = new Set(region.map((c) => `${c.x},${c.y}`));
        const where = `${what}/seed ${seed}`;

        for (let y = 0; y < HEXIA.height; y++) {
          for (let x = 0; x < HEXIA.width; x++) {
            if (!written(state, x, y)) continue;
            expect(inside.has(`${x},${y}`), `${where}: terrain at ${x},${y}`).toBe(true);
          }
        }
        // By whole footprint: a corner check would miss a building, a deck or a half-grid ramp.
        for (const o of state.objects.values()) {
          if (o.locked) continue;   // the template's own plaza was there before the run
          const r = objectRect(o);
          for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
            for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
              expect(inside.has(`${x},${y}`), `${where}: ${o.catalogId} covers ${x},${y}`).toBe(true);
            }
          }
        }
        expect(violations, where).toBe(0);
      }
    }
  }, 180_000);

  it('lands what the planet design put there: a region over the town comes back built', async () => {
    const [, town] = REGIONS[1]!;
    const { state } = await designedIn(12345, HEXIA, 1, town);
    let paved = 0, plants = 0, terrain = 0;
    for (const o of state.objects.values()) {
      if (o.locked) continue;
      const cat = categoryOf(o);
      if (cat === ItemCategory.Road) paved++;
      else if (cat === ItemCategory.Tree || cat === ItemCategory.Flora) plants++;
    }
    for (let y = 0; y < HEXIA.height; y++) for (let x = 0; x < HEXIA.width; x++) if (written(state, x, y)) terrain++;
    // A confinement gate that built nothing would pass the previous test; this one would not.
    expect(paved, 'streets inside the region').toBeGreaterThan(25);
    expect(plants, 'planting inside the region').toBeGreaterThan(25);
    expect(terrain, 'terrain inside the region').toBeGreaterThan(25);
  }, 60_000);

  it('is the SAME planet either way: a scoped run matches the whole one, cropped', async () => {
    const [, town] = REGIONS[1]!;
    const inside = new Set(town.map((c) => `${c.x},${c.y}`));
    const whole = designed(777, HEXIA, 1).state;
    const scoped = (await designedIn(777, HEXIA, 1, town)).state;
    // Terrain only: objects are placed against the map as it stands, and a scoped run's
    // neighbours differ.
    let compared = 0, same = 0;
    for (let y = 0; y < HEXIA.height; y++) {
      for (let x = 0; x < HEXIA.width; x++) {
        if (!inside.has(`${x},${y}`)) continue;
        compared++;
        const a = whole.cells[y]![x]!.terrain, b = scoped.cells[y]![x]!.terrain;
        if ((a?.type ?? null) === (b?.type ?? null) && (a?.elevation ?? 0) === (b?.elevation ?? 0)) same++;
      }
    }
    // The crop cuts some terraces off their support outside it, so the rules refuse a few boundary
    // cells.
    expect(same / compared, `terrain agreement ${same}/${compared}`).toBeGreaterThan(0.9);
  }, 90_000);
});
