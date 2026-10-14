// Design-quality probes — the planet generator's promises to the player, pinned as tests.
//
// The promises come from the expert methodology and the two decoded reference maps: the hard rules
// are failures, the soft preferences are scored floors, and the map's distance to the style target
// has a ceiling.
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
/** The seed set the score floors are read over. It carries the two seeds a ten-seed sweep found at
 *  the bottom of the range on purpose — 7 for unity and 1024 for symmetry — so a floor cannot pass
 *  by standing on a lucky batch. */
const SCORE_SEEDS = [12345, 777, 7, 1024];
/**
 * The seed set the batch symmetry floor is read over: the score seeds and four more, fixed. A
 * planet's symmetry share is read over the runs of one-level open ground its own terrace cut and
 * street grid leave, so a single seed swings widely (0.44 to 0.70 across these eight at richness
 * 0.6) and moves with a one-cell shift of the plaza or a plate edge. The floor claims a property of
 * the generator, not of one map, so it is read as a mean: a one-cell plaza move took the mean over
 * four seeds from 0.62 to 0.51 while the mean over twenty stayed at 0.58 to 0.59.
 */
const SYMMETRY_SEEDS = [...SCORE_SEEDS, 42, 2026, 314, 271];

/**
 * The per-seed floors, and the measured spread each one leaves slack against.
 *
 * A floor here says the operator ran on this map, not that the map is the average one: how many of
 * a planet's regions can carry a mirror, hold one colour family or stand a door against high ground
 * is decided by how that planet's own terrain cut its open ground. The batch means below are where
 * the reference shares are claimed. Every number is set under the worst of a ten-seed sweep across
 * the axis (hexia, richness 0.2 / 0.6 / 1), and the sweep's own figures are quoted so a later drift
 * reads as drift rather than as a fresh measurement.
 */
const FLOOR = {
  /** Sweep minimum 0.25 (quiet and mid), 0.42 at full richness; means 0.36 / 0.41 / 0.58. */
  backing: 0.2,
  /** Sweep minimum 0.50 over the wall archetypes at richness >= 0.5 (0.50 / 0.57 / 0.58 / 0.69 at
   *  full richness). The compositions that claim no direction are read, not floored. */
  monotonic: 0.45,
  /**
   * Sweep minimum 0.40 (both templates, three richness levels, ten seeds), means 0.77 to 0.83; worst
   * 0.33 at full richness over this batch, which is what the floor sits under.
   *
   * Two constructions hold it down, and neither is a defect the score can see: the movement line is a
   * third rank and the widest, so it shifts pavement out of the branch band into the trunk one, and a
   * staggered street is laid as two legs and a link, so a leg the ground cuts short is laid at branch
   * width rather than trunk. The score measures the mix against the references, and the references
   * have no primary walk. So the per-seed floor catches the hierarchy disappearing and the batch floor
   * below is where the claim lives.
   */
  hierarchy: 0.30,
  /** What the family must read: a mix genuinely near the references' own. Measured at full richness:
   *  0.54 over this batch, 0.68 over twenty-five seeds. */
  hierarchyBatch: 0.52,
  /**
   * Sweep minimum 0.43 at full richness, means 0.76 / 0.67 / 0.56; 0.29 to 0.71 at full richness over
   * this batch.
   *
   * A terraced planet reads its own mirrors low, because a mirrored composition is read over a run of
   * open ground at one level: a place cut by a terrace step is two runs, and the mirror the kit laid
   * is accounted in neither. What the floor still catches is the operator not running at all.
   */
  symmetry: 0.25,
  /** Sweep minimum 0.45, at full richness; means 0.91 / 0.90 / 0.77. */
  unity: 0.4,
} as const;

/**
 * How far outside the reference's own decor-density band a single seed may read: Zero. Every seed over
 * these richness levels reads inside the band, so there is no slack to grant. The pressure on it is
 * the water share (7% to 12% of the planet, the figure alone flooding a panel of a few hundred cells):
 * a planet that spends less of its ground on water has that much more of it to plant, and a seed
 * planting into the top of the band is the one this would fail.
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
        // Rule-validity is a hard rule too, and it is the one the other three cannot stand in for:
        // the pipeline commits through the live registry, so a violation left standing at the end
        // means what the map holds is not what the plan drew.
        expect(violations, where).toBe(0);
        expect(refused, where).toBe(0);
      }
    }
  }, 120_000);

  it('SOFT PREFERENCES: the methodology scores hold their floors across the richness range', () => {
    // One reading per richness, never pooled across the axis. The two composition scores fall as the
    // knob rises — a terraced, watery planet cuts its open ground into smaller and more ragged runs
    // than a garden town does — so a floor averaged over the whole axis would let the rich end
    // collapse behind the quiet end's headroom, which is exactly the end the style target is at.
    for (const richness of [0.2, 0.6, 1]) {
      const symmetry = SYMMETRY_SEEDS.filter((seed) => !SCORE_SEEDS.includes(seed))
        .map((seed) => evaluateMap(designed(seed, HEXIA, richness).state).scores.symmetryShare);
      const hierarchy: number[] = [];
      const unity: number[] = [];
      for (const seed of SCORE_SEEDS) {
        const { state } = designed(seed, HEXIA, richness);
        const where = `hexia/${seed}/r${richness}`;
        const { scores, metrics } = evaluateMap(state);
        // Both height claims are claims about a map with height, so both are read against what the
        // richness knob asked for. A quiet planet is the garden-town reference, which measures
        // 0 of 12 buildings backed and no north-south profile at all; what it still owes is the
        // strip behind each lot's own door, which is where its floor comes from.
        expect(scores.backingCoverage, where).toBeGreaterThanOrEqual(FLOOR.backing);
        // The score multiplies the gradient's direction by how much of the reference's own
        // 5.56-layer spread the map spends, so a garden town scores low for being a garden town —
        // which is what the quiet end of the axis is for, and what the axis probe pins from the
        // other side.
        // Near-low-far-high is a claim about a wall, and the archetype is drawn per seed: a raised
        // rim, a set of scattered massifs or a low-relief planet is not monotone along any one axis,
        // and lowering the floor until they pass would only make the score stop measuring. So the
        // floor holds only where the composition claims a direction.
        const archetype = planComposition({ seed, template: HEXIA, richness }).archetype;
        const walled = archetype === 'north-wall' || archetype === 'south-wall'
          || archetype === 'east-wall' || archetype === 'west-wall';
        if (richness >= 0.5 && walled) {
          expect(scores.heightMonotonicity, `${where} (${archetype})`)
            .toBeGreaterThanOrEqual(FLOOR.monotonic);
        }
        // The band is the reference's own reading and a seed is held inside it with no slack
        // (`DENSITY_EDGE` is zero). The batch means below are where the volume is claimed.
        expect(metrics.objects.decorDensity, where).toBeGreaterThanOrEqual(DECOR_DENSITY_BAND[0]);
        expect(metrics.objects.decorDensity, where).toBeLessThanOrEqual(DECOR_DENSITY_BAND[1] + DENSITY_EDGE);
        // A road hierarchy at all: the references' own bands for the two widths, scored.
        expect(scores.roadHierarchyMix, where).toBeGreaterThanOrEqual(FLOOR.hierarchy);
        expect(scores.symmetryShare, where).toBeGreaterThanOrEqual(FLOOR.symmetry);
        expect(scores.unityShare, where).toBeGreaterThanOrEqual(FLOOR.unity);
        hierarchy.push(scores.roadHierarchyMix);
        symmetry.push(scores.symmetryShare);
        unity.push(scores.unityShare);
      }
      const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
      // The batch is where the reference shares are claimed.
      const hierarchyMean = mean(hierarchy);
      expect(hierarchyMean, `r${richness} batch road mix ${hierarchyMean.toFixed(2)}`)
        .toBeGreaterThanOrEqual(FLOOR.hierarchyBatch);
      // Symmetry and unity both read lower the richer the planet, and for one reason: each is read
      // over a run of open ground at one level, and the rich end cuts a place into more runs. The
      // planet is terraced to its summit, so a mirror laid across a step is accounted in neither run,
      // and a staggered street cuts a place into runs that share a boundary, so a run's dominant
      // colour family carries less of it. Symmetry also pays for marks the composition did not draw:
      // the fountain court stands at a place's street corner where the ground allows and at its middle
      // where it does not, and the mirror cannot account for it. Symmetry is read as the mean over
      // `SYMMETRY_SEEDS`, which measures 0.50 at richness 1, 0.55 at 0.6 and 0.66 at the quiet end;
      // unity over the score seeds measures 0.65 at richness 1 and 0.70 at 0.6.
      const symFloor = richness >= 1 ? 0.42 : 0.52;
      const uniFloor = richness >= 1 ? 0.64 : 0.70;
      expect(mean(symmetry), `r${richness} batch symmetry ${mean(symmetry).toFixed(2)}`).toBeGreaterThanOrEqual(symFloor);
      expect(mean(unity), `r${richness} batch unity ${mean(unity).toFixed(2)}`).toBeGreaterThanOrEqual(uniFloor);
    }
  }, 180_000);

  /**
   * The walk climbs, and the planet is visible from it.
   *
   * Both are facts about where a visitor stands. The reference reads 2.65 bits of level entropy over
   * six levels, 47% of its pavement above level 4, 2.85 level changes per 100 pavement cells and 70.8%
   * of it with sight of the mass; the floors here are what this batch achieves, stated so the distance
   * left is readable rather than hidden. The max-height reach is the hard half: the shelf's cap is a
   * promise to the player, so a map asked for eight layers has to come back with eight.
   */
  it('THE CLIMB: the asked height is built, the walk stands on it and can see it', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => evaluateMap(designed(seed, template, 1).state).climb);
      const where = `${template.id}`;
      const mean = (pick: (c: typeof rows[number]) => number): number =>
        rows.reduce((a, c) => a + pick(c), 0) / rows.length;
      // The cap the harness asks for, reached rather than merely permitted. Two of three, because the
      // low-relief archetype has its own ceiling and any seed may draw it.
      expect(rows.filter((c) => c.peak >= ELEVATION_MAX).length, `${where}: peaks ${rows.map((c) => c.peak).join(',')}`)
        .toBeGreaterThanOrEqual(2);
      // A single-storey walk is what this is here to catch: no seed may stand more than four fifths of
      // its pavement on one level (the analysis's own bar is 70%, which this batch's worst seed sits
      // exactly on).
      for (const c of rows) {
        expect(c.topLevelShare, `${where}: top level ${(100 * c.topLevelShare).toFixed(0)}%`)
          .toBeLessThanOrEqual(0.8);
      }
      // Measured over this batch: 1.82 bits on hexia and 2.17 on tafa, 4.7 and 5.7 levels carrying
      // real pavement, 0.92 and 1.56 level changes per 100 cells, 21.7% and 25.9% with sight of the
      // mass. The sight floor is 0.12 rather than the 0.15 those two clear easily, because the TEN-seed
      // gate batch reads exactly 15% on hexia: a floor at its own measurement has no headroom, and this
      // probe's three seeds are not the batch the number came from.
      expect(mean((c) => c.entropy), `${where}: entropy ${mean((c) => c.entropy).toFixed(2)}`).toBeGreaterThan(1.3);
      expect(mean((c) => c.levels), `${where}: levels`).toBeGreaterThanOrEqual(3);
      expect(mean((c) => c.eventsPer100), `${where}: level changes / 100`).toBeGreaterThan(0.7);
      expect(mean((c) => c.seesMass), `${where}: sees mass ${(100 * mean((c) => c.seesMass)).toFixed(1)}%`)
        .toBeGreaterThan(0.12);
      // The residual, stated as a floor rather than hidden: the reference stands 47% of its pavement
      // above level 4 where this batch stands 7.8% (hexia) to 21.4% (tafa) and the ten-seed gate batch
      // 4% to 11%. Raising the composition's own floor reaches 22% on both templates and starves two
      // seeds of twenty of a street network entirely — a terrace narrower than a stamp carries no
      // pavement at all — so what closes the gap is wider terraces, not more height.
      expect(mean((c) => c.aboveMid), `${where}: above mid ${(100 * mean((c) => c.aboveMid)).toFixed(1)}%`)
        .toBeGreaterThan(0.03);
    }
  }, 180_000);

  /**
   * The map's one set piece, and the two grains of its planting.
   *
   * "A composition has a primary set piece, two or three secondary ones, and ordinary ground for the
   * rest; when every place is equally elaborate, none of them is the point." So every planet from the
   * set-piece richness up carries exactly one figure, drawn as the largest panel its ground offers, with
   * a calm band reserved around it and paved where the network reaches.
   *
   * The floors here are the gate's own, and both are measured rather than chosen: `gen-eval` runs the
   * batch the numbers come from.
   */
  it('THE SET PIECE: one composed figure per planet, framed, and the walk reaches it', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => {
        const { state } = designed(seed, template, 1);
        return { seed, figure: figureReading(state), arrivals: singularArrivals(state) };
      });
      for (const { seed, figure } of rows) {
        const where = `${template.id}/${seed}`;
        // In the hundreds of cells: the reference's own two figures are 772 and 330 cells, and this
        // reading measures its water at 1010. Ours run 100 to 467 over the gate batch, so the floor is
        // under the smallest of those rather than at the ambition.
        expect(figure.largest, `${where}: figure ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_CELLS_MIN);
        // Framed, which is what makes a figure read as figure against ground: the reference frames its
        // banner on four sides with a road border. Read as the calm share of the band around it — paved
        // or bare — the two references read 1.00 and 0.92 and our worst seed 0.73.
        expect(figure.framed, `${where}: framed ${figure.framed.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
      }
      // The walk relates to it. Pavement stands within a dozen cells of the figure, and a dozen is the
      // price of drawing the figure at the scale of a terrace floor (252 to 1012 cells): the largest
      // clear one-tier panel a planet has is the ground the streets never climbed. Measured over these
      // seeds, 4, 9 and 12 cells on hexia and 3, 4 and 5 on tafa. So this is a batch claim at what it
      // measures, with the reach named rather than assumed.
      const reached = rows.filter((r) => r.figure.toPavement >= 0 && r.figure.toPavement <= 12);
      expect(reached.length, `${template.id}: ${rows.map((r) => r.figure.toPavement).join(', ')} cells to pavement`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  /**
   * Where the streets stop, and the fountain court that gives them somewhere.
   *
   * Both claims are about a full-richness planet and neither belongs in the hard ledger's own verdict:
   * the quiet end of the richness axis is a flat garden town with no composed figure to end at and no
   * room for a large court, which is what it was asked for. They are held here and by `gen-eval`, the
   * same arrangement `noLattice` has.
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
        // A court is on the map and the reading can see it. The two halves are separate claims: the
        // grammar carves one on nearly every planet, and a moat drawn one level deep would shatter
        // under the 4-connected decomposition every reading takes, leaving the court invisible on a
        // map that carries it.
        expect(courts.courts, `${where}: formal courts read on the map`).toBeGreaterThan(0);
        expect(courts.related, `${where}: courts composed against a space`).toBeGreaterThan(0);
        expect(courts.perRegion, `${where}: main fountains in one region`).toBeLessThanOrEqual(1);
      }
      // And a walk finishes at one of them. A batch claim with the residual named, like the figure's
      // own reach above: a court the streets run through is a court on the way somewhere rather than
      // a place, and a figure standing on the terrace no street climbs has nothing to be arrived
      // from. Measured over the sixty-map gate, one seed of twenty at full richness (`tafa/777`)
      // carries neither, and `gen-eval` names it per seed.
      // And no deck lies across the street it meets. Hard at every seed: nothing about a map makes a
      // turned deck acceptable, and both references read zero. `aligned` is not gated — the terraced
      // reference reads 0 of its 5, because its decks cross open water between banks whose streets run
      // along them.
      for (const { seed, decks } of rows) {
        expect(decks.crossways,
          `${template.id}/${seed}: ${decks.crossways} of ${decks.bridges} decks lie across a street`)
          .toBe(0);
      }
      const ended = rows.filter((r) => r.place.pass);
      expect(ended.length,
        `${template.id}: arrivals ${rows.map((r) => `${r.place.arrivedAt}/${r.place.places}`).join(', ')}`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  /**
   * The two grains, as a claim about direction rather than a parity bar: the reference has both flora
   * masses and specimen trees. The element grammar reaches for the mass end (the cover knob walks a
   * flower block up to a solid bed). Cluster counts still track the number of open-ground runs,
   * since a rich planet's open ground comes in pieces of a few dozen cells that clip a bed.
   */
  it('TWO GRAINS: flowers land as beds and trees as specimens, not all at one middling size', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => decorGrain(designed(seed, template, 1).state));
      const mean = (pick: (g: typeof rows[number]) => number): number =>
        rows.reduce((a, g) => a + pick(g), 0) / rows.length;
      // The tree grain is the specimen extreme and it is already the reference's: a lattice plants one
      // cell in four, so a tree cluster's median runs 3 to 4 against the reference's 1.
      expect(mean((g) => g.treeMedian), `tree median ${mean((g) => g.treeMedian)}`).toBeLessThanOrEqual(6);
      // And the mass extreme is present rather than absent, which is what the two-rung ladder buys.
      // Floors under the batch's own measurement (masses 7% to 25%, middle 69% to 87%).
      expect(mean((g) => g.massShare), `mass share ${mean((g) => g.massShare).toFixed(2)}`)
        .toBeGreaterThan(0.05);
      expect(mean((g) => g.middleShare), `middle share ${mean((g) => g.middleShare).toFixed(2)}`)
        .toBeLessThan(0.9);
    }
  });

  /**
   * The ground is landform and the water is dressed, as two numbers.
   *
   * Tofu terrain is the first: how much of its own bounding box the median terrace component fills, read
   * against 0.58 on the decoded terraced reference (a map of boxes reads 1.00). The dressing is the
   * second: the share of the map's real water bodies carrying a composed bank row.
   *
   * The fill floor is measured against the references (0.58 terraced, 1.00 garden town). The dressing
   * floor is not: this reading answers 13% on the terraced reference and 0% on the garden town, so it is
   * a ratchet on our own grammar rather than a bar derived from the target.
   */
  it('THE LANDFORM AND THE DRESSING: terraces are not boxes, and a body is composed against (I5.3)', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of DESIGNED_SEEDS) {
        const { state } = designed(seed, template, 1);
        const where = `${template.id}/${seed}`;
        const shape = terraceShape(state);
        expect(shape.medianFill, `${where}: median terrace box fill ${shape.medianFill.toFixed(2)}`)
          .toBeLessThanOrEqual(TERRACE_FILL_MAX);
        // A map of boxes reads 1.00 here; the terraced reference reads 0.24 (9 of 38) and this batch
        // 0.20 to 0.55.
        expect(shape.boxyShare, `${where}: boxy share ${shape.boxyShare.toFixed(2)}`)
          .toBeLessThan(0.7);
        // And the figure is the one big thing. The floor lives in `_support/design-eval/figure.ts`, the same number the
        // harness gates on, with the argument for its value stated there. The ladder ratio is not gated:
        // the reference's own two figures read 1010 and 971, so a bar on the ratio would fail the map it
        // was derived from.
        const figure = figureReading(state);
        expect(figure.largest, `${where}: set piece ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_FLOOR);
        const dressing = bankDressing(state);
        expect(dressing.bodies, `${where}: bodies of 15 cells or more`).toBeGreaterThan(5);
        // A self-ratchet, not a reference bar, and the difference matters: read by this code the
        // terraced reference dresses 5 of its 40 bodies (13%) and the garden town 0 of 10, because the
        // reference's own waterside planting is beds and step-2 lattices rather than the orthogonal
        // same-species row this reading looks for. So the reading measures our grammar's reach, and the
        // floor is under our own worst full-richness seed (31% to 81% at full richness, 14% to 83%
        // across the range). A looser definition — runs at step 1 or 2 among plants within 4 cells —
        // reads 41% on that reference, and adopting it would change what this floor means.
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

    // The two references sit at the ends of this axis: the garden town is 99% ground level with 15%
    // water and one tree per 6.6 flowers, the target planet terraces almost everything, carries water
    // on every layer and runs 1 : 1.12.
    // The quiet bound is 0.35 rather than 0.30 because no water bed is cut into a terrace, so ground
    // that could read as water reads as the mountain it stands on: measured 0.32 over this batch. The
    // claim the axis is for is unaffected — a quiet map is a third mountain where a full one is most
    // of the way to two thirds.
    expect(mean(quiet, (m) => m.elevation.mountainShare)).toBeLessThan(0.35);
    expect(mean(full, (m) => m.elevation.mountainShare)).toBeGreaterThan(0.45);
    expect(mean(quiet, (m) => m.elevation.waterShare)).toBeLessThan(mean(full, (m) => m.elevation.waterShare));
    expect(mean(quiet, (m) => m.elevation.quarterMeans[1]!)).toBeLessThan(0.6);
    expect(mean(full, (m) => m.elevation.quarterMeans[1]!)).toBeGreaterThan(1.2);
    // The ratio runs the right way along the axis, which is the whole of what it is for.
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
    // A ceiling, not a target, and a loose one: One reference is one composition, not the composition.
    //
    // A per-seed distance as tight as 0.12 is reachable only by making every map the same composition —
    // a wall across the north, which is the shape the reference's own profile term measures — so a
    // west-wall or corner-highland planet scores that term against a north-heavy reference and is right
    // to differ. What the distance still catches is a map that has stopped being kin to the target at
    // all: no relief, no water, a road mix out of band.
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

// --- the painted region ----------------------------------------------------------------------------

/** One designed run confined to `region`, on a fresh map (the template's own terrain and plaza),
 *  through the app's own run: the scope cleared, the generator, the seam repair and one commit. */
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
  // Three rectangles over three different parts of the planet's own design: the backing band it
  // raises in the north, the town it builds around the plaza, and the southern ground. What each one
  // comes back holding is the design's business; that it comes back holding nothing elsewhere is
  // this suite's.
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

        // Every written cell: one whose terrain differs from the fresh map's was written by this run.
        for (let y = 0; y < HEXIA.height; y++) {
          for (let x = 0; x < HEXIA.width; x++) {
            if (!written(state, x, y)) continue;
            expect(inside.has(`${x},${y}`), `${where}: terrain at ${x},${y}`).toBe(true);
          }
        }
        // Every object, by its whole footprint — the unit a stray is measured in, and the one a
        // corner check would miss for a building, a deck or a half-grid ramp.
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
    // How much is the design's business, not the region's: what these numbers pin is that a scope
    // over the built part of the planet comes back with all three kinds of thing on it, which is the
    // failure mode a confinement gate that simply built nothing would otherwise pass.
    expect(paved, 'streets inside the region').toBeGreaterThan(25);
    expect(plants, 'planting inside the region').toBeGreaterThan(25);
    expect(terrain, 'terrain inside the region').toBeGreaterThan(25);
  }, 60_000);

  it('is the SAME planet either way: a scoped run matches the whole one, cropped', async () => {
    const [, town] = REGIONS[1]!;
    const inside = new Set(town.map((c) => `${c.x},${c.y}`));
    const whole = designed(777, HEXIA, 1).state;
    const scoped = (await designedIn(777, HEXIA, 1, town)).state;
    // The plan is the planet's, and the region only crops what lands: the ground inside a scoped
    // run is the ground the unscoped run put there. Terrain only — an object is placed against the
    // map as it stands, so a scoped run's neighbours differ and its own placements legitimately do.
    let compared = 0, same = 0;
    for (let y = 0; y < HEXIA.height; y++) {
      for (let x = 0; x < HEXIA.width; x++) {
        if (!inside.has(`${x},${y}`)) continue;
        compared++;
        const a = whole.cells[y]![x]!.terrain, b = scoped.cells[y]![x]!.terrain;
        if ((a?.type ?? null) === (b?.type ?? null) && (a?.elevation ?? 0) === (b?.elevation ?? 0)) same++;
      }
    }
    // Not every cell: the crop cuts a terrace off the support standing outside it, so the rules
    // legitimately refuse a handful at the boundary. The claim is that the two runs designed the
    // same planet, not that a crop is free.
    expect(same / compared, `terrain agreement ${same}/${compared}`).toBeGreaterThan(0.9);
  }, 90_000);
});
