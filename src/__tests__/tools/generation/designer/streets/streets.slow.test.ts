import { GENERATION_STYLE } from '../../../../../config/generation-style';
// Stage B of the designer: streets as the partition. The plan is rasterized onto a GridState and
// read with `_support/design-eval`, the scorers gen-eval grades a finished map with, not with the
// planner's own arithmetic. Bounds marked "measured" are over both templates, ten seeds.
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

describe('the partition the streets cut', () => {
  it('cuts the planet into blocks of the references own scale, on both templates', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const legibility = districtLegibility(run.state);
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        // A district is a region the smallest house fits in whole. The references read 18 of median
        // 260 (garden town) and 36 of median 134 (terraced). Terraces cut a rich seed into bands too
        // narrow for a house, so it reads fewer, larger districts. The floor sits one under the
        // measured least: 11 at richness 0.2, 7 at richness 1.
        expect(legibility.count, `${where}: ${legibility.count} districts`).toBeGreaterThanOrEqual(richness <= 0.2 ? 10 : 6);
        // The ceiling is the quiet end's: every unserved block takes a line along its foot, and a flat
        // planet has more of those. Measured: 11 to 31 at richness 0.2, 7 to 22 at richness 1.
        expect(legibility.count, `${where}: ${legibility.count} districts`).toBeLessThanOrEqual(42);
        expect(legibility.median, `${where}: median ${legibility.median}`).toBeGreaterThanOrEqual(48);
        // The rich end spaces branch lines further apart (`SPACING`) to keep four-ways and spanning
        // streets within the references, so its blocks are wider. Measured largest median: 1386.
        expect(legibility.median, `${where}: median ${legibility.median}`).toBeLessThanOrEqual(1400);
        // The references read 0.44 and 0.53. A terrace is the shape the ground left, a staggered
        // crossing leaves an L-shaped block and the plaza apron is a ring, so the floor sits under the
        // terraced reference. Measured 0.44 to 0.85; worst 0.375 over twenty-five full-richness seeds.
        expect(legibility.rectangularity, `${where}: rect ${legibility.rectangularity.toFixed(2)}`)
          .toBeGreaterThan(0.35);
      }
      // Over twenty-five seeds the means are 0.52 (hexia) and 0.50 (tafa) at full richness, 0.66 quiet.
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
        // Stage C reads `unserved` rather than re-deriving it.
        expect(run.plan.unserved.slice().sort(), `${where}: reported unserved ids`)
          .toEqual(closed.map((d) => d.id).sort());
        // A terraced map can compose a plate no street can reach (a steep massif quarter); it comes
        // back `served: false` and stage C leaves it unbuilt.
        if (richness <= 0.2) {
          // On a nearly flat map the shut ground is a coastal sliver cut off by a plate rim. Not zero,
          // because the wide primary walk takes ground a branch would have run through. Measured 0.1%
          // to 2.1%.
          expect(shut / open, `${where}: ${((shut / open) * 100).toFixed(1)}% of the open map shut off`)
            .toBeLessThan(0.03);
        } else {
          // At the rich end the shut plate is the style target's own wall band (a third of the map),
          // so the bound only catches a map going mostly shut. Measured worst 37%.
          expect(shut / open, `${where}: ${((shut / open) * 100).toFixed(1)}% of the open map shut off`)
            .toBeLessThan(0.45);
        }
        // The references pave 12.0% (terraced) and 15.9% (garden town). The floor catches a map that
        // laid no network; a terraced seed paves less, since a terrace narrower than a stamp carries no
        // street. Measured 6.4% to 22.8%.
        const share = run.evaluation.metrics.roads.pavedShare;
        expect(share, `${where}: ${(share * 100).toFixed(1)}% paved`).toBeGreaterThan(0.05);
        // The ceiling also carries the movement line (a couple of points alone) and the unserved-block
        // lines, which the references lack. Measured 11.3% to 22.8% at richness 0.2, 6.4% to 14.5% at 1.
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
      // The hierarchy claim is the batch's. Measured 29% to 47%.
      expect(batch, `${template.id} r${richness}: batch branch share ${(batch * 100).toFixed(1)}%`)
        .toBeGreaterThan(0.25);
      const accents = new Set(runs.flatMap((r) => r.plan.materials.accents));
      expect(accents.size, `${template.id} r${richness}: accents across the batch`).toBeGreaterThan(1);
    }
  });
});

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
        // Read again off the plan, which is what stage C consumes.
        expect(strandedCells(run), `${where}: paved cells the plaza cannot walk to`).toBe(0);
      }
    }
  });

  it('holds the hierarchy the PDF asks for: a primary walk, trunks 3 wide, branches 2', () => {
    for (const { template, richness, runs } of batches()) {
      for (const run of runs) {
        const where = `${template.id} r${richness} seed ${run.plan.seedInfo.seed}`;
        // The movement line's leg at 4 (the style target's approaches decode at 4 to 6), a trunk at
        // 3, a branch at 2; which a seed carries depends on its ground.
        const widths = [...new Set(run.plan.streets.map((s) => s.width))].sort();
        expect(widths.every((w) => w === BRANCH_W || w === TRUNK_W || w === LINE_W),
          `${where}: street widths ${widths.join(',')}`).toBe(true);
        expect(widths, `${where}: street widths`).toContain(BRANCH_W);
        // The style target's mix is 38.4% branch, 56.5% trunk. Per seed this only catches a rank
        // disappearing: the wide movement line shifts share into w>=3, and terraces fragment the
        // branches. Measured 7.1% to 48%.
        const mix = run.evaluation.metrics.roads.widthMix;
        expect(mix.w2, `${where}: w2 ${(mix.w2 * 100).toFixed(1)}%`).toBeGreaterThan(0.06);
        expect(mix.w3plus, `${where}: w3+ ${(mix.w3plus * 100).toFixed(1)}%`).toBeGreaterThan(0.3);
      }
    }
  });
});

/** Whether the street a flight names stands against the flight's corridor, its cells recomputed
 *  from its own geometry (a w x w stamp along its skeleton) rather than the planner's bookkeeping. */
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

/** Paved cells the plaza cannot reach over pavement and ramps: the evaluation's conduction rule,
 *  recomputed from the plan. */
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
    // The plaza conducts: streets tangent to two of its faces are one network through it.
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
          // A flight whose street is gone would leave the pavement it carried unreachable.
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
    // At richness 1 the plaza stands on its own plate and every street meets a step within a few
    // cells; without enough such seeds the claims above are vacuous.
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
    // Hexia at richness 0, seed 2026: the plaza's north and south trunks run off its layer-1 plateau
    // into steps down to layer 0 that other flights already reach. Settling before the step's flight
    // is offered would cut both trunks back to stubs ending at nothing.
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

describe('district frontage separates a block from a leftover', () => {
  it('reads this stage as high as the references', () => {
    for (const { template, richness, runs } of batches()) {
      const shares = runs.map((r) => districtFrontage(r.state).frontedShare);
      const where = `${template.id} r${richness}: fronted ${(Math.min(...shares) * 100).toFixed(1)}`
        + `..${(Math.max(...shares) * 100).toFixed(1)}%, mean ${(mean(shares) * 100).toFixed(1)}%`;
      // The references read 50% and 67%. The claim is the batch mean: one huge terrace is a block
      // only stage C's places subdivide. At the rich end a block stepped on two sides, or cornered by
      // a staggered street, is fronted from one side only. Measured batch means 50.9% and 50.0% at
      // richness 0.2, 11.5% worst at richness 1 (16.5% and 14.2% over twenty-five seeds).
      expect(mean(shares), where).toBeGreaterThan(richness <= 0.2 ? FRONTED_SHARE_MIN : 0.10);
      // Per seed only at the quiet end (worst measured 6.5%); at the rich end one seed whose mass
      // takes most of its land reads 4.3%.
      if (richness <= 0.2) {
        expect(Math.min(...shares), where).toBeGreaterThan(0.06);
      }
    }
  });
});

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
  // A fractional bend position makes `staggered()` refuse every bend silently, and no other
  // assertion would notice, so this reads offset pairs off plans the real planner built.
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
