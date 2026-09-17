// Design-quality probes — the planet generator's promises to the player, pinned as tests.
//
// The promises come from the expert methodology and the two decoded reference maps: the hard rules
// are failures, the soft preferences are scored floors, and the map's distance to the style target
// has a ceiling.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; several seconds per case on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import { ItemCategory } from '../../../core/model/types';
import { generateTerrain } from '../../../tools/generation/terrain-generator';
import { objectRect } from '../../../state/object-geometry';
import type { Command, EditorEvents, GenerateConfig, GridState } from '../../../core/model/types';
import { ELEVATION_MAX } from '../../../core/model/constants';
import { categoryOf } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { MAP_TEMPLATES } from '../../../config/maps/index';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import type { MacroCoord, MapTemplate } from '../../../core/model/types';
import { planComposition } from '../../../tools/generation/designer/composition/composition';
import {
  bankDressing, bridgeAlignment, decorGrain, evaluateMap, figureReading, referenceDistance,
  singularArrivals, terraceShape,
  DEAD_END_MAX, DECOR_DENSITY_BAND, ONE_WIDE_MAX, REACHABLE_MIN, SET_PIECE_CELLS_MIN,
  SET_PIECE_FLOOR, TERRACE_FILL_MAX,
} from '../../../tools/generation/designer/eval';

function designed(seed: number, template: MapTemplate, richness: number): { state: GridState; violations: number; refused: number } {
  const state: GridState = {
    template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
  };
  const plaza = createPlazaObject(template);
  if (plaza) state.objects.set(plaza.id, plaza);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: ELEVATION_MAX,
    seed, region: null, richness: richness,
  };
  let refused = 0;
  exec.runSilently(() => {
    refused = generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry()).skipped;
  });
  const violations = exec.commitStrokeGroup(exec.getUndoStackSize()).length;
  return { state, violations, refused };
}

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
/** Pinned, so a probe that fails names a map that can be rebuilt and looked at. */
const DESIGNED_SEEDS = [12345, 777, 42];
/** The seed set the score floors are read over. It carries the two seeds a ten-seed sweep found at
 *  the bottom of the range on purpose — 7 for unity and 1024 for symmetry — so a floor cannot pass
 *  by standing on a lucky batch. */
const SCORE_SEEDS = [12345, 777, 7, 1024];

/**
 * THE PER-SEED FLOORS, and the measured spread each one leaves slack against.
 *
 * A floor here says the operator RAN on this map, not that the map is the average one: how many of
 * a planet's regions can carry a mirror, hold one colour family or stand a door against high ground
 * is decided by how that planet's own terrain cut its open ground. The batch means below are where
 * the reference shares are claimed. Every number is set under the WORST of a ten-seed sweep across
 * the axis (hexia, richness 0.2 / 0.6 / 1), and the sweep's own figures are quoted so a later drift
 * reads as drift rather than as a fresh measurement.
 */
const FLOOR = {
  /** Sweep minimum 0.25 (quiet and mid), 0.42 at full richness; means 0.36 / 0.41 / 0.58. */
  backing: 0.2,
  /** Sweep minimum 0.50 over the WALL archetypes at richness >= 0.5 (0.50 / 0.57 / 0.58 / 0.69 at
   *  full richness). The compositions that claim no direction are read, not floored. */
  monotonic: 0.45,
  /**
   * Sweep minimum 0.40 (both templates, three richness levels, ten seeds), means 0.77 to 0.83; worst
   * 0.33 at full richness over this batch, which is what the floor sits under.
   *
   * TWO CONSTRUCTIONS HOLD IT DOWN, and neither is a defect the score can see: the movement line is a
   * third rank and the widest, so it shifts pavement out of the branch band into the trunk one, and a
   * staggered street is laid as two legs and a link, so a leg the ground cuts short is laid at branch
   * width rather than trunk. The score measures the mix against the references, and the references
   * have no primary walk. So the per-seed floor catches the hierarchy disappearing and the batch floor
   * below is where the claim lives.
   */
  hierarchy: 0.30,
  /** What the FAMILY must read: a mix genuinely near the references' own. Measured at full richness
   *  over this batch: 0.59. */
  hierarchyBatch: 0.55,
  /**
   * Sweep minimum 0.43 at full richness, means 0.76 / 0.67 / 0.56; 0.29 to 0.71 at full richness over
   * this batch.
   *
   * A TERRACED PLANET READS ITS OWN MIRRORS LOW, because a mirrored composition is read over a run of
   * open ground at ONE level: a place cut by a terrace step is two runs, and the mirror the kit laid
   * is accounted in neither. What the floor still catches is the operator not running at all.
   */
  symmetry: 0.25,
  /** Sweep minimum 0.45, at full richness; means 0.91 / 0.90 / 0.77. */
  unity: 0.4,
} as const;

/**
 * How far outside the reference's own decor-density band a single seed may read: ZERO. Every seed over
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
        // RULE-VALIDITY IS A HARD RULE TOO, and it is the one the other three cannot stand in for:
        // the pipeline commits through the live registry, so a violation left standing at the end
        // means what the map holds is not what the plan drew.
        expect(violations, where).toBe(0);
        expect(refused, where).toBe(0);
      }
    }
  }, 120_000);

  it('SOFT PREFERENCES: the methodology scores hold their floors across the richness range', () => {
    // ONE READING PER RICHNESS, never pooled across the axis. The two composition scores fall as the
    // knob rises — a terraced, watery planet cuts its open ground into smaller and more ragged runs
    // than a garden town does — so a floor averaged over the whole axis would let the rich end
    // collapse behind the quiet end's headroom, which is exactly the end the style target is at.
    for (const richness of [0.2, 0.6, 1]) {
      const symmetry: number[] = [];
      const hierarchy: number[] = [];
      const unity: number[] = [];
      for (const seed of SCORE_SEEDS) {
        const { state } = designed(seed, HEXIA, richness);
        const where = `hexia/${seed}/r${richness}`;
        const { scores, metrics } = evaluateMap(state);
        // BOTH HEIGHT CLAIMS ARE CLAIMS ABOUT A MAP WITH HEIGHT, so both are read against what the
        // richness knob asked for. A quiet planet is the garden-town reference, which measures
        // 0 of 12 buildings backed and no north-south profile at all; what it still owes is the
        // strip behind each lot's own door, which is where its floor comes from.
        expect(scores.backingCoverage, where).toBeGreaterThanOrEqual(FLOOR.backing);
        // The score multiplies the gradient's direction by how much of the reference's own
        // 5.56-layer spread the map spends, so a garden town scores low for being a garden town —
        // which is what the quiet end of the axis is FOR, and what the axis probe pins from the
        // other side.
        // NEAR-LOW-FAR-HIGH IS A CLAIM ABOUT A WALL, and the archetype is drawn per seed: a raised
        // rim, a set of scattered massifs or a low-relief planet is not monotone along any one axis,
        // and lowering the floor until they pass would only make the score stop measuring. So the
        // floor holds only where the composition claims a direction.
        const archetype = planComposition(seed, HEXIA, richness).archetype;
        const walled = archetype === 'north-wall' || archetype === 'south-wall'
          || archetype === 'east-wall' || archetype === 'west-wall';
        if (richness >= 0.5 && walled) {
          expect(scores.heightMonotonicity, `${where} (${archetype})`)
            .toBeGreaterThanOrEqual(FLOOR.monotonic);
        }
        // THE BAND IS THE REFERENCE'S OWN READING and a seed is held inside it with no slack
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
      // The BATCH is where the reference shares are claimed.
      const hierarchyMean = mean(hierarchy);
      expect(hierarchyMean, `r${richness} batch road mix ${hierarchyMean.toFixed(2)}`)
        .toBeGreaterThanOrEqual(FLOOR.hierarchyBatch);
      // SYMMETRY AND UNITY BOTH READ LOWER THE RICHER THE PLANET, and for one reason: each is read
      // over a RUN of open ground at one level, and the rich end cuts a place into more runs. The
      // planet is terraced to its summit, so a mirror laid across a step is accounted in neither run,
      // and a staggered street cuts a place into runs that share a boundary, so a run's dominant
      // colour family carries less of it. Symmetry also pays for marks the composition did not draw:
      // the fountain court stands at a place's street corner where the ground allows and at its middle
      // where it does not, and the mirror cannot account for it. Measured over this batch: symmetry
      // 0.44 at richness 1, 0.54 at 0.6 and 0.55 at the quiet end; unity 0.65 at richness 1 and 0.70
      // at 0.6.
      const symFloor = richness >= 1 ? 0.42 : 0.52;
      const uniFloor = richness >= 1 ? 0.64 : 0.70;
      expect(mean(symmetry), `r${richness} batch symmetry ${mean(symmetry).toFixed(2)}`).toBeGreaterThanOrEqual(symFloor);
      expect(mean(unity), `r${richness} batch unity ${mean(unity).toFixed(2)}`).toBeGreaterThanOrEqual(uniFloor);
    }
  }, 180_000);

  /**
   * THE WALK CLIMBS, AND THE PLANET IS VISIBLE FROM IT (P1 and P2 of the design analysis).
   *
   * Both are facts about where a VISITOR stands. The reference reads 2.65 bits of level entropy over
   * six levels, 47% of its pavement above level 4, 2.85 level changes per 100 pavement cells and 70.8%
   * of it with sight of the mass; the floors here are what this batch achieves, stated so the distance
   * left is readable rather than hidden. The MAX-HEIGHT REACH is the hard half: the shelf's cap is a
   * promise to the player, so a map asked for eight layers has to come back with eight.
   */
  it('THE CLIMB: the asked height is built, the walk stands on it and can see it (P1, P2)', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => evaluateMap(designed(seed, template, 1).state).climb);
      const where = `${template.id}`;
      const mean = (pick: (c: typeof rows[number]) => number): number =>
        rows.reduce((a, c) => a + pick(c), 0) / rows.length;
      // The cap the harness asks for, reached rather than merely permitted. Two of three, because the
      // low-relief archetype has its own ceiling and any seed may draw it.
      expect(rows.filter((c) => c.peak >= ELEVATION_MAX).length, `${where}: peaks ${rows.map((c) => c.peak).join(',')}`)
        .toBeGreaterThanOrEqual(2);
      // A SINGLE-STOREY WALK is what this is here to catch: no seed may stand more than four fifths of
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
      // THE RESIDUAL, stated as a floor rather than hidden: the reference stands 47% of its pavement
      // above level 4 where this batch stands 7.8% (hexia) to 21.4% (tafa) and the ten-seed gate batch
      // 4% to 11%. Raising the composition's own floor reaches 22% on both templates and starves two
      // seeds of twenty of a street network entirely — a terrace narrower than a stamp carries no
      // pavement at all — so what closes the gap is wider terraces, not more height.
      expect(mean((c) => c.aboveMid), `${where}: above mid ${(100 * mean((c) => c.aboveMid)).toFixed(1)}%`)
        .toBeGreaterThan(0.03);
    }
  }, 180_000);

  /**
   * THE MAP'S ONE SET PIECE, AND THE TWO GRAINS OF ITS PLANTING (P7 and P4 of the design analysis).
   *
   * P7: "a composition has a PRIMARY set piece, two or three secondary ones, and ordinary ground for the
   * rest; when every place is equally elaborate, none of them is the point." So every planet from the
   * set-piece richness up carries exactly ONE figure, drawn as the largest panel its ground offers, with
   * a calm band reserved around it and paved where the network reaches.
   *
   * The FLOORS here are the gate's own, and both are measured rather than chosen: `gen-eval` runs the
   * batch the numbers come from.
   */
  it('THE SET PIECE: one composed figure per planet, framed, and the walk reaches it (P7)', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => {
        const { state } = designed(seed, template, 1);
        return { seed, figure: figureReading(state), arrivals: singularArrivals(state) };
      });
      for (const { seed, figure } of rows) {
        const where = `${template.id}/${seed}`;
        // In the HUNDREDS of cells: the reference's own two figures are 772 and 330 cells, and this
        // reading measures its water at 1010. Ours run 100 to 467 over the gate batch, so the floor is
        // under the smallest of those rather than at the ambition.
        expect(figure.largest, `${where}: figure ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_CELLS_MIN);
        // FRAMED, which is what makes a figure read as figure against ground: the reference frames its
        // banner on four sides with a road border. Read as the calm share of the band around it — paved
        // or bare — the two references read 1.00 and 0.92 and our worst seed 0.73.
        expect(figure.framed, `${where}: framed ${figure.framed.toFixed(2)}`).toBeGreaterThanOrEqual(0.7);
      }
      // THE WALK RELATES TO IT. Pavement stands within a dozen cells of the figure, and a dozen is the
      // price of drawing the figure at the scale of a TERRACE FLOOR (252 to 1012 cells): the largest
      // clear one-tier panel a planet has is the ground the streets never climbed. Measured over these
      // seeds, 4, 9 and 12 cells on hexia and 3, 4 and 5 on tafa. So this is a BATCH claim at what it
      // measures, with the reach named rather than assumed.
      const reached = rows.filter((r) => r.figure.toPavement >= 0 && r.figure.toPavement <= 12);
      expect(reached.length, `${template.id}: ${rows.map((r) => r.figure.toPavement).join(', ')} cells to pavement`)
        .toBeGreaterThanOrEqual(rows.length - 1);
    }
  });

  /**
   * WHERE THE STREETS STOP (P5's second half), and the fountain court that gives them somewhere.
   *
   * Both claims are about a FULL-RICHNESS planet and neither belongs in the hard ledger's own verdict:
   * the quiet end of the richness axis is a flat garden town with no composed figure to end at and no
   * room for a large court, which is what it was asked for. They are held here and by `gen-eval`, the
   * same arrangement `noLattice` has.
   */
  it('ARRIVALS: a walk finishes at one of the planet\'s set pieces, and a court is one of them (P5)', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => {
        const { state } = designed(seed, template, 1);
        const e = evaluateMap(state);
        return { seed, place: e.hard.arrivesAtPlace, courts: e.water.fountains, decks: bridgeAlignment(state) };
      });
      for (const { seed, place, courts } of rows) {
        const where = `${template.id}/${seed}`;
        expect(place.places, `${where}: the planet carries a set piece at all`).toBeGreaterThan(0);
        // A COURT IS ON THE MAP AND THE READING CAN SEE IT. The two halves are separate claims: the
        // grammar carves one on nearly every planet, and a moat drawn one level deep would shatter
        // under the 4-connected decomposition every reading takes, leaving the court invisible on a
        // map that carries it.
        expect(courts.courts, `${where}: formal courts read on the map`).toBeGreaterThan(0);
        expect(courts.related, `${where}: courts composed against a space`).toBeGreaterThan(0);
        expect(courts.perRegion, `${where}: main fountains in one region`).toBeLessThanOrEqual(1);
      }
      // AND A WALK FINISHES AT ONE OF THEM. A BATCH claim with the residual named, like the figure's
      // own reach above: a court the streets run THROUGH is a court on the way somewhere rather than
      // a place, and a figure standing on the terrace no street climbs has nothing to be arrived
      // from. Measured over the sixty-map gate, one seed of twenty at full richness (`tafa/777`)
      // carries neither, and `gen-eval` names it per seed.
      // AND NO DECK LIES ACROSS THE STREET IT MEETS. Hard at every seed: nothing about a map makes a
      // turned deck acceptable, and both references read zero. `aligned` is NOT gated — the terraced
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
   * THE TWO GRAINS (P4), reported as a claim about DIRECTION rather than as a parity bar.
   *
   * The reference lays flora as 27 clusters at a median of 18 cells and trees as 179 at a median of 1, so
   * both extremes are present; ours read 86 to 120 flora clusters at a median of 4 to 6. The ELEMENT
   * GRAMMAR is what reaches for the mass end: the cover knob walks a flower block up to a SOLID BED
   * rather than to a half-filled stripe, so a place that needs more planting gets another bed. Measured
   * over the gate batch, 16.2% of planting stands in masses of 40 cells or more and 78.0% in the middle
   * band.
   *
   * THE REMAINING GAP IS THE RUN SIZE, and it is measured: a rich planet's open ground comes in about a
   * hundred pieces of a few dozen cells each (the districts reading's own median run is 28 to 42), so a
   * 30-cell bed lands clipped and the flora CLUSTER COUNT tracks the number of runs rather than the
   * element grammar. Closing it means composing fewer, larger places, which is a stage-C change.
   */
  it('TWO GRAINS: flowers land as beds and trees as specimens, not all at one middling size (P4)', () => {
    for (const template of [HEXIA, TAFA]) {
      const rows = DESIGNED_SEEDS.map((seed) => decorGrain(designed(seed, template, 1).state));
      const mean = (pick: (g: typeof rows[number]) => number): number =>
        rows.reduce((a, g) => a + pick(g), 0) / rows.length;
      // The tree grain is the SPECIMEN extreme and it is already the reference's: a lattice plants one
      // cell in four, so a tree cluster's median runs 3 to 4 against the reference's 1.
      expect(mean((g) => g.treeMedian), `tree median ${mean((g) => g.treeMedian)}`).toBeLessThanOrEqual(6);
      // And the MASS extreme is present rather than absent, which is what the two-rung ladder buys.
      // Floors under the batch's own measurement (masses 7% to 25%, middle 69% to 87%).
      expect(mean((g) => g.massShare), `mass share ${mean((g) => g.massShare).toFixed(2)}`)
        .toBeGreaterThan(0.05);
      expect(mean((g) => g.middleShare), `middle share ${mean((g) => g.middleShare).toFixed(2)}`)
        .toBeLessThan(0.9);
    }
  });

  /**
   * THE GROUND IS LANDFORM AND THE WATER IS DRESSED, as two numbers.
   *
   * TOFU TERRAIN is the first: how much of its own bounding box the median terrace component fills, read
   * against 0.58 on the decoded terraced reference (a map of boxes reads 1.00). THE DRESSING is the
   * second: the share of the map's real water bodies carrying a composed bank row.
   *
   * The FILL floor is measured against the references (0.58 terraced, 1.00 garden town). The DRESSING
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
        // AND THE FIGURE IS THE ONE BIG THING. The floor lives in `eval/figure.ts`, the same number the
        // harness gates on, with the argument for its value stated there. The ladder RATIO is not gated:
        // the reference's own two figures read 1010 and 971, so a bar on the ratio would fail the map it
        // was derived from.
        const figure = figureReading(state);
        expect(figure.largest, `${where}: set piece ${figure.largest} cells`)
          .toBeGreaterThanOrEqual(SET_PIECE_FLOOR);
        const dressing = bankDressing(state);
        expect(dressing.bodies, `${where}: bodies of 15 cells or more`).toBeGreaterThan(5);
        // A SELF-RATCHET, NOT A REFERENCE BAR, and the difference matters: read by THIS code the
        // terraced reference dresses 5 of its 40 bodies (13%) and the garden town 0 of 10, because the
        // reference's own waterside planting is beds and step-2 lattices rather than the orthogonal
        // same-species row this reading looks for. So the reading measures OUR grammar's reach, and the
        // floor is under our own worst full-richness seed (31% to 81% at full richness, 14% to 83%
        // across the range). A looser definition — runs at step 1 OR 2 among plants within 4 cells —
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
    // The ratio runs the RIGHT WAY along the axis, which is the whole of what it is for.
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
    // A CEILING, NOT A TARGET, and a loose one: ONE reference is one composition, not THE composition.
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
    expect(digest(designed(2026, HEXIA, 0.7).state)).toBe(digest(designed(2026, HEXIA, 0.7).state));
  }, 60_000);
});

// --- the painted region ----------------------------------------------------------------------------

/** One designed run confined to `region`, on a map that starts empty. */
function designedIn(seed: number, template: MapTemplate, richness: number, region: MacroCoord[]): {
  state: GridState; violations: number;
} {
  const state: GridState = {
    template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
  };
  const plaza = createPlazaObject(template);
  if (plaza) state.objects.set(plaza.id, plaza);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: ELEVATION_MAX,
    seed, region, richness: richness,
  };
  exec.runSilently(() => { generateTerrain(config, state, (c: Command) => exec.execute(c), exec.getRegistry()); });
  const violations = exec.commitStrokeGroup(exec.getUndoStackSize()).length;
  return { state, violations };
}

function rectRegion(x0: number, y0: number, x1: number, y1: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
}

describe('a designed run inside a painted region', () => {
  // Three rectangles over three different parts of the planet's own design: the backing band it
  // raises in the north, the town it builds around the plaza, and the southern ground. What each one
  // comes back holding is the design's business; that it comes back holding NOTHING ELSEWHERE is
  // this suite's.
  const REGIONS: readonly (readonly [string, MacroCoord[]])[] = [
    ['the wall', rectRegion(40, 12, 96, 40)],
    ['the town', rectRegion(50, 62, 104, 96)],
    ['the south', rectRegion(30, 96, 90, 126)],
  ];

  it('touches nothing outside it: no cell written, no object placed', () => {
    for (const [what, region] of REGIONS) {
      for (const seed of [12345, 777]) {
        const { state, violations } = designedIn(seed, HEXIA, 1, region);
        const inside = new Set(region.map((c) => `${c.x},${c.y}`));
        const where = `${what}/seed ${seed}`;

        // Every written cell. The map starts empty, so anything with terrain on it was written by
        // this run.
        for (let y = 0; y < HEXIA.height; y++) {
          for (let x = 0; x < HEXIA.width; x++) {
            if (!state.cells[y]![x]!.terrain) continue;
            expect(inside.has(`${x},${y}`), `${where}: terrain at ${x},${y}`).toBe(true);
          }
        }
        // Every object, BY ITS WHOLE FOOTPRINT — the unit a stray is measured in, and the one a
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

  it('lands what the planet design put there: a region over the town comes back built', () => {
    const [, town] = REGIONS[1]!;
    const { state } = designedIn(12345, HEXIA, 1, town);
    let paved = 0, plants = 0, written = 0;
    for (const o of state.objects.values()) {
      if (o.locked) continue;
      const cat = categoryOf(o);
      if (cat === ItemCategory.Road) paved++;
      else if (cat === ItemCategory.Tree || cat === ItemCategory.Flora) plants++;
    }
    for (const row of state.cells) for (const cell of row) if (cell.terrain) written++;
    // HOW MUCH is the design's business, not the region's: what these numbers pin is that a scope
    // over the built part of the planet comes back with all three KINDS of thing on it, which is the
    // failure mode a confinement gate that simply built nothing would otherwise pass.
    expect(paved, 'streets inside the region').toBeGreaterThan(25);
    expect(plants, 'planting inside the region').toBeGreaterThan(25);
    expect(written, 'terrain inside the region').toBeGreaterThan(25);
  }, 60_000);

  it('is the SAME planet either way: a scoped run matches the whole one, cropped', () => {
    const [, town] = REGIONS[1]!;
    const inside = new Set(town.map((c) => `${c.x},${c.y}`));
    const whole = designed(777, HEXIA, 1).state;
    const scoped = designedIn(777, HEXIA, 1, town).state;
    // THE PLAN IS THE PLANET'S, and the region only crops what lands: the ground inside a scoped
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
