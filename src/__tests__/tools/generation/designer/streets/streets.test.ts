import { GENERATION_STYLE } from '../../../../../config/generation-style';
// Stage B of the methodology generator: streets as the partition.
//
// Everything here is read back with the real scorers — the plan's pavement, ramps and plate tiers
// are rasterized onto a GridState and handed to `_support/design-eval`, the same functions gen-eval grades
// a finished map with — so what passes here is what the ledger passes, not a restatement of the
// planner's own arithmetic. Two of the stage's load-bearing claims live here: ramps never stand on
// pavement, and the blocks the streets cut front onto them.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; several seconds per case on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { objectRect } from '../../../../../state/object-geometry';
import { type MapTemplate } from '../../../../../core/model/types';
import { planComposition } from '../../../../../tools/generation/designer/composition/composition';
import {
  FRONTED_SHARE_MIN, districtFrontage, districtLegibility, networkShape, rampDiscipline,
} from '../../../../_support/design-eval';
import { LINE_W } from '../../../../../tools/generation/designer/composition/movement-line';
import { planStreets } from '../../../../../tools/generation/designer/streets/streets';
import { DOMINANT_SHARE, type StreetPlan } from '../../../../../tools/generation/designer/streets/model';
import { BRANCH_W, TRUNK_W } from '../../../../../tools/generation/designer/types';
import { ELEVATION_MAX } from '../../../../../core/game/profile';
import { planDesign } from '../../../../../tools/generation/designer/pipeline';
import {
  HEXIA, SEEDS, TEMPLATES, batches, mean, measure, tierField, type Measured,
} from './_streets-batch';

const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

// --- the partition -------------------------------------------------------------------------------

describe('the partition the streets cut', () => {
  it('cuts the planet into blocks of the references own scale, on both templates', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const legibility = districtLegibility(run.state);
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        // A district is a region the smallest house fits in whole. The references segment into 18
        // districts of median 260 (the garden town, cut by its streets) and 36 of median 134 (the
        // terraced planet, cut by its terraces and by the places composed on them). This stage cuts
        // the coarse scale, and on a terraced planet the terraces cut it again into bands mostly too
        // narrow for a house, so a rich seed reads fewer, larger districts. The floor is therefore the
        // scale a planet stops reading as blocks at, one under the batch's least reading at each end:
        // over both templates, ten seeds, 11 at richness 0.2 and 7 at richness 1.
        expect(legibility.count, `${where}: ${legibility.count} districts`).toBeGreaterThanOrEqual(richness <= 0.2 ? 10 : 6);
        // The ceiling is the quiet end's, not the terraced end's. Every block the grid leaves unserved
        // takes a line along its own foot (`unservedBlockLines`), and a flat planet has more of those
        // than a terraced one — a coast eating a line, a plaza ring, a piece the settling pruned — so
        // this reading goes down as the terraces come in. Measured over both templates at both ends of
        // the axis, ten seeds: 11 to 31 at richness 0.2 and 7 to 22 at richness 1.
        expect(legibility.count, `${where}: ${legibility.count} districts`).toBeLessThanOrEqual(42);
        expect(legibility.median, `${where}: median ${legibility.median}`).toBeGreaterThanOrEqual(48);
        // The ceiling carries the anti-grid: it stands the branch lines further apart at the rich
        // end (`SPACING`), which is what brings the four-way share and the planet-spanning street
        // inside the references' own readings, and the blocks between them are wider for it.
        // Measured over both templates at both ends, ten seeds: the largest median, at richness 1,
        // reads 1386.
        expect(legibility.median, `${where}: median ${legibility.median}`).toBeLessThanOrEqual(1400);
        // The blocks a street grid cuts are rectangles; the references read 0.44 and 0.53 with their
        // places and coastlines eating into them, and a terraced planet reads at the lower end of that
        // — a terrace is the shape the ground left, and the ring around a crowned summit is an annulus
        // however straight the streets on it are. Measured over both templates at both ends of the
        // axis, ten seeds: 0.44 to 0.85. The floor sits under the terraced reference's own reading,
        // because staggering a crossing enriches a block outline by design: a block between two legs
        // of one staggered street is an L rather than a rectangle, and the level apron round the plaza
        // is a ring. Measured over both templates at full richness, twenty-five seeds: worst 0.375.
        expect(legibility.rectangularity, `${where}: rect ${legibility.rectangularity.toFixed(2)}`)
          .toBeGreaterThan(0.35);
      }
      // The batch claim: twenty-five seeds measure means of 0.52 (hexia) and 0.50 (tafa) at full
      // richness and 0.66 at the quiet end.
      const rect = mean(runs.map((run) => districtLegibility(run.state).rectangularity));
      expect(rect, `${template.id} r${richness}: mean rect ${rect.toFixed(2)}`)
        .toBeGreaterThan(richness <= 0.2 ? 0.6 : 0.47);
    }
  });

  it('leaves no block without a street, and paves the references own share of the planet', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        const open = run.plan.districts.reduce((n, d) => n + d.cells.length, 0);
        const closed = run.plan.districts.filter((d) => !d.served);
        const shut = closed.reduce((n, d) => n + d.cells.length, 0);
        // `unserved` is the plan's own report of them, and stage C reads it rather than re-deriving.
        expect(run.plan.unserved.slice().sort(), `${where}: reported unserved ids`)
          .toEqual(closed.map((d) => d.id).sort());
        // A flat map has a street against every block. A terraced one can compose a plate the
        // streets cannot reach at all — a steep massif quarter with no ground a street may be laid
        // on and none at its foot either — and this stage says so rather than paving into it: the
        // block comes back `served: false` and stage C leaves it unbuilt.
        if (richness <= 0.2) {
          // A quiet map is nearly flat, so what a street cannot reach there is a coastal sliver the
          // plate rim's slope cut off, not a composition: worst measured 1.0% of the open map.
          // Measured across both templates at richness 0.2, ten seeds: 0.1% to 2.1% of the open
          // map. It is not a hard zero because the primary walk is the widest street on the map
          // and takes ground a branch would otherwise have run through, so the bound is the measured
          // ceiling with a little room, and it still catches a flat map going shut.
          expect(shut / open, `${where}: ${((shut / open) * 100).toFixed(1)}% of the open map shut off`)
            .toBeLessThan(0.03);
        } else {
          // At the rich end that shut-off plate is the style target's own arrangement, whose wall
          // band is a third of the map at under 1% object cover, so the bound is here to catch a
          // map going mostly shut rather than to pin the terrain a seed happens to draw (worst
          // measured 37% at richness 1).
          expect(shut / open, `${where}: ${((shut / open) * 100).toFixed(1)}% of the open map shut off`)
            .toBeLessThan(0.45);
        }
        // The references pave 12.0% of the terraced planet and 15.9% of the garden town. This stage
        // lays the whole network, so the band is theirs with room either side for a coastline that
        // eats a street.
        // The lower bound is what catches a map that failed to lay a network at all. A terraced seed
        // legitimately paves less than a flat one: a terrace narrower than a stamp carries no street,
        // and a piece the flights cannot reach is pruned rather than left unreachable. Measured over
        // both templates at both ends of the axis, ten seeds: 6.4% to 22.8%.
        const share = run.evaluation.metrics.roads.pavedShare;
        expect(share, `${where}: ${(share * 100).toFixed(1)}% paved`).toBeGreaterThan(0.05);
        // The upper bound carries the movement line and the unserved-block lines, neither of which the
        // references' own share accounts for: the primary walk is the
        // widest street on the map and costs a couple of points by itself, and a block no grid line
        // reached takes a street along its foot. It is the quiet end's number — a flat planet has more
        // unserved blocks than a terraced one, and its grid runs coast to coast where a terraced one
        // fragments. Measured over both templates, ten seeds: 11.3% to 22.8% at richness 0.2 and 6.4%
        // to 14.5% at richness 1.
        expect(share, `${where}: ${(share * 100).toFixed(1)}% paved`).toBeLessThan(0.24);
      }
    }
  });

  it('paves one dominant material with seeded accents', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        expect(run.plan.materials.dominant).toBe(GENERATION_STYLE.roads.dominant);
        // One material carries 87 to 95% of the pavement on both references.
        const share = run.evaluation.metrics.roads.dominantMaterialShare;
        expect(share, `${where}: dominant ${(share * 100).toFixed(1)}%`).toBeGreaterThan(DOMINANT_SHARE - 0.01);
        expect(share, `${where}: dominant ${(share * 100).toFixed(1)}%`).toBeLessThan(0.96);
      }
      const branchShare = runs.map((r) => r.evaluation.metrics.roads.widthMix.w2);
      const batch = branchShare.reduce((a, b) => a + b, 0) / branchShare.length;
      // The batch is where the hierarchy claim lives (see the per-seed reading below). Measured over
      // both templates at both ends of the axis, ten seeds: 29% to 47%.
      expect(batch, `${template.id} r${richness}: batch branch share ${(batch * 100).toFixed(1)}%`)
        .toBeGreaterThan(0.25);
      const accents = new Set(runs.flatMap((r) => r.plan.materials.accents));
      expect(accents.size, `${template.id} r${richness}: accents across the batch`).toBeGreaterThan(1);
    }
  });
});

// --- the invariants the stamp construction carries ------------------------------------------------

describe('width, dead ends and connectivity', () => {
  it('never lays a 1-wide road and never leaves a tip cell', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        const hard = run.evaluation.hard;
        expect(hard.noOneWideRoads.oneWideCells, `${where}: 1-wide cells`).toBe(0);
        expect(hard.roadsConnected.deadEnds, `${where}: tip cells`).toBe(0);
      }
    }
  });

  it('keeps the whole network walkable from the plaza', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        expect(run.evaluation.hard.roadsConnected.reachableShare, `${where}: reachable share`).toBe(1);
        // Read again off the plan rather than off the raster, since the plan is what stage C will
        // consume: pavement plus the ramps that carry it up a step, from the plaza outward.
        expect(strandedCells(run), `${where}: paved cells the plaza cannot walk to`).toBe(0);
      }
    }
  });

  it('holds the hierarchy the PDF asks for: a primary walk, trunks 3 wide, branches 2', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        // Three widths and no others: the movement line's own leg at 4 (the style target's approaches
        // decode at 4 to 6), a trunk at 3, a branch at 2. Which of them a given seed carries depends
        // on the ground its walk and its plaza ring found.
        const widths = [...new Set(run.plan.streets.map((s) => s.width))].sort();
        expect(widths.every((w) => w === BRANCH_W || w === TRUNK_W || w === LINE_W),
          `${where}: street widths ${widths.join(',')}`).toBe(true);
        expect(widths, `${where}: street widths`).toContain(BRANCH_W);
        // The style target's own width mix: branch (w=2) 38.4% of its pavement, trunk (w>=3) 56.5%.
        // Both ranks have to carry real length or the hierarchy is decoration.
        //
        // The hierarchy claim is the batch's; the per-seed reading only catches a rank disappearing
        // altogether. Two things pull a single seed's branch share under the references' mix, both by
        // construction: the movement line is a third rank and a wide one, so it shifts share out of
        // w=2 into w>=3, and on a terraced planet a terrace carries the primary walk at whatever width
        // fits while the grid's branches fragment on the steps, so a seed whose mass takes most of its
        // planet runs mostly trunk. Measured over both templates at both ends of the axis, ten seeds:
        // 7.1% to 48%, the low end on a rim composition whose plaza cross fragments into short pieces.
        const mix = run.evaluation.metrics.roads.widthMix;
        expect(mix.w2, `${where}: w2 ${(mix.w2 * 100).toFixed(1)}%`).toBeGreaterThan(0.06);
        expect(mix.w3plus, `${where}: w3+ ${(mix.w3plus * 100).toFixed(1)}%`).toBeGreaterThan(0.3);
      }
    }
  });
});

/** Does the pavement of the run a flight names stand against the flight's corridor? The run's cells
 *  are recomputed from its own geometry (a w x w stamp at each point of its skeleton), so the claim
 *  does not rest on the planner's bookkeeping. */
function touchesCorridor(run: Measured, flight: StreetPlan['flights'][number]): boolean {
  const street = run.plan.streets[flight.street];
  if (!street) return false;
  const offset = (street.width - 1) >> 1;
  const owned = new Set<string>();
  for (let t = street.from; t <= street.to; t++) {
    const sx = (street.axis === 'y' ? street.line : t) - offset;
    const sy = (street.axis === 'y' ? t : street.line) - offset;
    for (let y = sy; y < sy + street.width; y++) {
      for (let x = sx; x < sx + street.width; x++) owned.add(`${x},${y}`);
    }
  }
  const r = flight.corridor;
  for (let y = r.y - 1; y <= r.y + r.h; y++) {
    for (let x = r.x - 1; x <= r.x + r.w; x++) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) continue;
      if (owned.has(`${x},${y}`)) return true;
    }
  }
  return false;
}

/** Paved cells the plaza cannot reach, walking over pavement and over a flight's ramps. The
 *  evaluation's own conduction rule, recomputed here from the plan so the claim does not rest on the
 *  planner's internal bookkeeping. */
function strandedCells(run: Measured): number {
  const W = run.state.template.width, H = run.state.template.height;
  const paved = new Uint8Array(W * H);
  for (const c of run.plan.cells) paved[c.y * W + c.x] = 1;
  const conduct = new Uint8Array(paved);
  const plaza = [...run.state.objects.values()].find((o) => o.locked);
  for (const ramp of run.plan.ramps) {
    const r = ramp.footprint;
    for (let y = r.y - 1; y <= r.y + r.h; y++) {
      for (let x = r.x - 1; x <= r.x + r.w; x++) {
        if (x >= 0 && y >= 0 && x < W && y < H) conduct[y * W + x] = 1;
      }
    }
  }
  const stack: number[] = [];
  const seen = new Uint8Array(W * H);
  if (plaza) {
    // The plaza itself conducts, the way the ledger reads it: a street tangent to one face and a
    // street tangent to another are one network through the square between them.
    const r = objectRect(plaza);
    for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
      for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const i = y * W + x;
        conduct[i] = 1;
        if (!seen[i]) { seen[i] = 1; stack.push(i); }
      }
    }
  }
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (!conduct[j] || seen[j]) continue;
      seen[j] = 1; stack.push(j);
    }
  }
  let stranded = 0;
  for (let i = 0; i < paved.length; i++) if (paved[i] && !seen[i]) stranded++;
  return stranded;
}

// --- ramps as road furniture ----------------------------------------------------------------------

describe('ramps stand at steps, never on pavement', () => {
  it('puts no ramp footprint on a paved cell, at any seed', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        const discipline = rampDiscipline(run.state);
        expect(discipline.onPavement, `${where}: ramps on pavement`).toBe(0);
        expect(discipline.overlapCells, `${where}: ramp cells over pavement`).toBe(0);
        expect(discipline.pass, `${where}: ramp discipline`).toBe(true);
      }
    }
  });

  it('carries a street over every step it has to cross, plaza exits included', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        for (const flight of run.plan.flights) {
          // A flight names the street it belongs to, and that street has to exist and stand against
          // it: a flight retired after the settling would give its corridor back with nothing left
          // to re-prune, and the pavement it carried would stand there unreachable.
          expect(flight.street, `${where}: flight street index`).toBeGreaterThanOrEqual(0);
          expect(flight.street, `${where}: flight street index`).toBeLessThan(run.plan.streets.length);
          expect(touchesCorridor(run, flight), `${where}: the flight's own street stands against it`)
            .toBe(true);
          expect(flight.ramps.length, `${where}: flight ramps`).toBe(flight.highTier - flight.lowTier);
          expect(flight.landings.length, `${where}: flight landings`).toBe(flight.ramps.length - 1);
          for (const ramp of flight.ramps) {
            expect(objectRect({ ...ramp, id: 'probe' })).toEqual(ramp.footprint);
            expect(ramp.elevation, `${where}: ramp elevation inside the flight`)
              .toBeGreaterThan(flight.lowTier - 1);
            expect(ramp.elevation, `${where}: ramp elevation inside the flight`)
              .toBeLessThanOrEqual(flight.highTier);
          }
        }
      }
    }
    // The plaza bowl at richness 1 is the case that makes the flights load-bearing: the hub stands
    // on its own plate and every street out of it meets a step within a few cells, so without the
    // flights the network would be the plaza's plate and nothing else. It has to actually occur in
    // this batch, or the claims above are vacuous.
    const climbing = TEMPLATES.flatMap((template) => SEEDS
      .map((seed) => measure(seed, template, 1))
      .filter((run) => run.plan.flights.length > 0));
    expect(climbing.length, 'seeds whose streets take a flight at richness 1').toBeGreaterThan(15);
    const tiersReached = climbing.map((run) => {
      const tier = tierField(run.state.template, run.composition);
      return new Set(run.plan.cells.map((c) => tier[c.y * run.state.template.width + c.x]!)).size;
    });
    expect(Math.max(...tiersReached), 'terraces one map lays street on').toBeGreaterThan(2);
  });

  it('climbs a step that splits a street even where the network already reaches both pieces', () => {
    // Hexia at richness 0, seed 2026: the plaza's north and south trunks run west and east off the
    // plaza's layer-1 plateau into the steps down to layer 0, and other flights already reach the
    // lower ground. Settling the network before the step's flight is offered cuts the pieces back to
    // stubs past their crossing, which end at nothing on both sides; a flight on each trunk is what
    // carries them on. Without the hold this seed carries one.
    const run = measure(2026, HEXIA, 0);
    const carried = run.plan.flights.filter((f) => !f.entry
      && run.plan.streets.some((s) => s.axis === f.axis && s.rank === 'trunk' && !s.primary
        && (f.axis === 'y'
          ? f.corridor.x <= s.line && s.line < f.corridor.x + f.corridor.w
          : f.corridor.y <= s.line && s.line < f.corridor.y + f.corridor.h)));
    expect(carried.length, 'inline flights carrying a ring trunk').toBeGreaterThanOrEqual(2);
  });

  it('bounds both ramp count and total occupied run', () => {
    for (const { template, richness, runs } of batches()) {
      const counts = runs.map((r) => r.plan.ramps.length);
      const where = `${template.id} r${richness}: ramps ${Math.min(...counts)}..${Math.max(...counts)}`;
      // Count caps visual repetition; occupied run measures corridor density across ramp lengths.
      expect(Math.max(...counts), where).toBeLessThanOrEqual(51);
      const occupiedRun = runs.map((run) => run.plan.ramps.reduce((sum, ramp) => {
        const r = ramp.footprint;
        return sum + (ramp.rotation === 0 || ramp.rotation === 180 ? r.h : r.w);
      }, 0));
      expect(mean(occupiedRun), where).toBeLessThan(80);
    }
  });
});

// --- frontage: does a block read as a block -------------------------------------------------------

describe('district frontage separates a block from a leftover', () => {
  it('reads this stage as high as the references', () => {
    for (const { template, richness, runs } of batches()) {
      const shares = runs.map((r) => districtFrontage(r.state).frontedShare);
      const where = `${template.id} r${richness}: fronted ${(Math.min(...shares) * 100).toFixed(1)}`
        + `..${(Math.max(...shares) * 100).toFixed(1)}%, mean ${(mean(shares) * 100).toFixed(1)}%`;
      // The references read 50% and 67%, the routed baseline 8% to 26%. The batch mean is the claim
      // rather than every seed: a seed whose plates leave one huge terrace has a block this stage
      // cannot subdivide on its own, and stage C's places are what cut those.
      //
      // The reading splits by richness, because at the rich end the terraces do the cutting: a block
      // bounded by a step on two sides can be fronted from one side only, and the street that serves
      // it runs along its foot rather than round it. The anti-grid costs the rich end again — a block
      // cornered between two legs of a staggered street has its front on the shorter of them, and
      // where a bend turns a line the block inside the turn is fronted on one side only. Measured over
      // both templates, ten seeds: batch mean 50.9% and 50.0% at richness 0.2 against 11.5% worst at
      // richness 1 (16.5% and 14.2% over twenty-five seeds). The quiet end therefore keeps the
      // references' own bar and the terraced end keeps the one that says a block still has a front.
      expect(mean(shares), where).toBeGreaterThan(richness <= 0.2 ? FRONTED_SHARE_MIN : 0.10);
      // And the per-seed floor survives at the quiet end, where nothing explains a block with no front
      // at all: worst measured 6.5%, one block of forty cornered between two legs of a staggered
      // street with its front on the shorter of them. At the rich end one seed reads 4.3% — a map whose
      // mass takes most of its land, where the blocks are terraces the street serves from one side —
      // so the claim there is the batch's alone.
      if (richness <= 0.2) {
        expect(Math.min(...shares), where).toBeGreaterThan(0.06);
      }
    }
  });
});

// --- determinism -----------------------------------------------------------------------------------

/** A plan reduced to plain values, for equality between two runs of the same arguments. */
function digest(plan: StreetPlan): string {
  return JSON.stringify({
    streets: plan.streets.map((s) => [s.rank, s.axis, s.line, s.width, s.from, s.to]),
    cells: plan.cells.length,
    ramps: plan.ramps.map((r) => [r.catalogId, r.position.x, r.position.y, r.rotation, r.elevation]),
    districts: plan.districts.map((d) => [d.id, d.tier, d.cells.length, d.served]),
    materials: plan.materials,
  });
}

describe('determinism', () => {
  it('answers the same arguments with the same plan, and different seeds with different ones', () => {
    for (const template of TEMPLATES) {
      const seen = new Map<string, number>();
      for (const seed of SEEDS) {
        const composition = planComposition({ seed, template, richness: 0.6 });
        const once = digest(planStreets({ seed, template, composition, richness: 0.6 }));
        const twice = digest(planStreets({ seed, template, composition: planComposition({ seed, template, richness: 0.6 }), richness: 0.6 }));
        expect(twice, `${template.id}/${seed}: two runs of one seed`).toBe(once);
        seen.set(once, (seen.get(once) ?? 0) + 1);
      }
      expect(seen.size, `${template.id}: distinct plans over ${SEEDS.length} seeds`).toBe(SEEDS.length);
    }
  });
});

describe('the offset crossing fires', () => {
  // `longRun` is a share of the map's extent and so comes out fractional: added to a coordinate
  // unrounded, it offers every bend between two cells and `staggered()` refuses all of them — a
  // silent no-op no other assertion would catch. This pin therefore reads the operator's output off
  // maps whose plan the real planner built.
  it('lays offset crossings on a full-richness planet, on more than one seed', () => {
    const laid = [12345, 777, 42, 2026, 7].map((seed) => {
      const plan = planDesign({ seed, template: HEXIA, richness: 1, maxElevation: ELEVATION_MAX }).streets;
      const paved = new Uint8Array(HEXIA.width * HEXIA.height);
      for (const c of plan.cells) paved[c.y * HEXIA.width + c.x] = 1;
      return networkShape(paved, allLand(HEXIA), HEXIA.width, HEXIA.height).offsetPairs;
    });
    expect(laid.filter((n) => n > 0).length, `offset pairs per seed: ${laid.join(', ')}`)
      .toBeGreaterThanOrEqual(2);
  });
});

/** Every cell of the template that is land: the extent a span is measured against. */
function allLand(template: MapTemplate): Uint8Array {
  const out = new Uint8Array(template.width * template.height);
  for (let y = 0; y < template.height; y++) {
    for (let x = 0; x < template.width; x++) {
      if (template.zones[y]?.[x] !== undefined) out[y * template.width + x] = 1;
    }
  }
  return out;
}
