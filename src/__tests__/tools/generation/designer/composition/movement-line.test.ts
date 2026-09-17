/**
 * The movement line (PDF §四 步骤 2 · 定方向与动线): the walk every other stage composes around.
 *
 * What is pinned here is what the later stages depend on and what makes a walk legible: a walk that
 * EXISTS with a readable sequence, legs that join end to end so a street can be laid
 * along them, a theme pair the kit library can answer, and the same walk from the same seed.
 */
import { describe, expect, it } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { makeRng } from '../../../../../core/model/rng';
import { flatIndex } from '../../../../../core/model/grid-model';
import { MASSIF_PEAK_FROM, planComposition } from '../../../../../tools/generation/designer/composition/composition';
import { planStreets } from '../../../../../tools/generation/designer/streets/streets';
import { planMovementLine } from '../../../../../tools/generation/designer/composition/movement-line';
import { styleOf } from '../../../../../tools/generation/designer/dressing';
import type { RegionPlan } from '../../../../../tools/generation/designer/types';

const SEEDS = [12345, 777, 42, 2026, 7, 31337, 90210, 1024];
const hexia = MAP_TEMPLATES['hexia']!;
const tafa = MAP_TEMPLATES['tafa']!;

const lineFor = (seed: number, template = hexia, richness = 1): ReturnType<typeof planMovementLine> =>
  planMovementLine(seed, template, planComposition(seed, template, richness, 8), richness);

describe('the movement line', () => {
  it('is the same walk from the same seed', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      expect(JSON.stringify(lineFor(seed))).toBe(JSON.stringify(lineFor(seed)));
    }
  });

  it('leaves the plaza through a market and finishes at a look-out', () => {
    for (const template of [hexia, tafa]) {
      for (const seed of SEEDS) {
        const line = planMovementLine(
          seed, template, planComposition(seed, template, 1, 8), 1,
        );
        expect(line.stops.length).toBeGreaterThanOrEqual(2);
        expect(line.stops[0]!.role).toBe('market');
        expect(line.stops[line.stops.length - 1]!.role).toBe('lookout');
        // A look-out halfway along is a view the walk turns its back on.
        for (const stop of line.stops.slice(0, -1)) expect(stop.role).not.toBe('lookout');
      }
    }
  });

  /**
   * THE LOOK-OUT STANDS ON THE MASS, which is what makes the role a fact rather than a label.
   *
   * A walk grown greedily with a seen-set and no way back strands in a pocket of the plate graph and
   * leaves the summit unvisited: read that way over twenty seeds, three ended on tier 1, 2 and 6 of an
   * planet planned to 8, all three of them called a look-out. The route BACKTRACKS, and its destination
   * is the highest ground the plaza can reach AND stand on, so every seed of twenty on both templates
   * ends on the composition's own peak.
   *
   * Read against the PLAN's peak rather than the built map's, because that is the promise this planner
   * makes; `gen-eval.mts` carries the same reading against the built one.
   */
  it('ends on the composition own highest ground, wherever there is a massif', () => {
    const wide = [...SEEDS, 555, 8181, 313, 64007, 22, 4096, 199, 71, 8888, 3141, 27182, 60103];
    let arrived = 0, flat = 0;
    for (const template of [hexia, tafa]) {
      for (const richness of [0.5, 1]) {
        for (const seed of wide) {
          const composition = planComposition(seed, template, richness, 8);
          const line = planMovementLine(seed, template, composition, richness);
          // A map asked for less than a massif has no summit to arrive at, and the walk is bounded by
          // its stop count instead: the same test the composition itself gates the skirt and the
          // crowns on. It is the low-relief archetype at middle richness that lands here.
          if (composition.peakTier < MASSIF_PEAK_FROM) { flat++; continue; }
          const peak = Math.max(...composition.plates.map((p) => p.tier));
          const last = line.stops[line.stops.length - 1];
          expect(last, `${template.id}/${seed} r${richness}: no walk`).toBeDefined();
          expect(last!.tier, `${template.id}/${seed} r${richness}: ends at ${last!.tier} of ${peak}`)
            .toBe(peak);
          arrived++;
        }
      }
    }
    // The skip has to stay the exception, or the probe proves nothing: measured 68 of 80 runs carry a
    // massif and arrive on it, the twelve skipped all at middle richness.
    expect(arrived, `${arrived} arrivals against ${flat} maps with no massif`).toBeGreaterThan(3 * flat);
  });

  it('joins its legs end to end, each one straight', () => {
    for (const seed of SEEDS) {
      const { segments } = lineFor(seed);
      expect(segments.length).toBeGreaterThan(0);
      for (const seg of segments) expect(seg.to).toBeGreaterThan(seg.from);
      for (let k = 0; k + 1 < segments.length; k++) {
        const a = segments[k]!, b = segments[k + 1]!;
        if (a.axis === b.axis) continue;
        // Two consecutive legs turn a corner, and the corner cell lies on both of them: a leg whose
        // end is nowhere near the next one is two walks rather than one.
        const holds = (seg: typeof a, at: number): boolean => at >= seg.from - 1 && at <= seg.to + 1;
        expect(holds(a, b.line) && holds(b, a.line)).toBe(true);
      }
    }
  });

  it('names a theme the kit library answers with a style', () => {
    for (const seed of SEEDS) {
      for (const stop of lineFor(seed).stops) {
        const region = {
          id: `stop-${stop.index}`, kind: 'theme', themeId: stop.themeId, family: stop.family,
          anchors: [], size: { w: 8, h: 8 }, tags: [], lot: [{ x: 0, y: 0, w: 8, h: 8 }],
          entrySide: 'south', orientation: 'south',
        } as RegionPlan;
        expect(styleOf(region, makeRng(1))).toBeDefined();
      }
    }
  });

  it('asks for its water on the map, at the tier the stop stands on', () => {
    for (const seed of SEEDS) {
      const line = lineFor(seed);
      for (const want of line.waterWants) {
        expect(want.rect.w).toBeGreaterThan(0);
        expect(want.rect.h).toBeGreaterThan(0);
        expect(want.tier).toBeGreaterThanOrEqual(0);
        expect(line.stops[want.stop]).toBeDefined();
      }
    }
  });

  /**
   * THE WALK IS PAVED, which is the only thing that makes it a walk rather than a plan.
   *
   * Not all of it: a leg's stretch is dropped where the ground cannot carry a street at all (a coast
   * eating a corner, a terrace step across the line), and where the plates leave a piece shorter than
   * a street it is dropped rather than laid as a stub. The numbers the two bars are set against are
   * stated at the assertions, which are where a batch is re-measured.
   */
  it('is paved, and mostly paved', () => {
    for (const template of [hexia, tafa]) {
      for (const richness of [0.2, 1]) {
        const shares: number[] = [];
        for (const seed of SEEDS) {
          const composition = planComposition(seed, template, richness, 8);
          const line = planMovementLine(seed, template, composition, richness);
          const streets = planStreets(seed, template, composition, richness, line);
          const paved = new Set(streets.cells.map((c) => flatIndex(c.x, c.y, template.width)));
          const on = line.trace.filter((c) => paved.has(flatIndex(c.x, c.y, template.width))).length;
          const share = line.trace.length ? on / line.trace.length : 0;
          shares.push(share);
        }
        // THE BATCH IS THE CLAIM AND THE COUNT STANDS BESIDE IT. The planet is terraced all the way to
        // its summit, so the walk CLIMBS: every step it crosses costs it the cell no
        // coating may be laid on before a step and the corridor the flight stands in, and a leg the
        // flights cannot carry at all is pruned rather than left unreachable. Measured over both
        // templates at both ends of the axis, these eight seeds: 21% to 96% per seed, batch means 62%
        // to 88%. What the batch reading is for is a walk that is mostly PAVEMENT rather than a line
        // drawn over whatever the map happened to build, and the per-seed floor beside it is what
        // catches a walk that was never laid at all.
        const batch = shares.reduce((a, b) => a + b, 0) / shares.length;
        expect(batch, `${template.id} r${richness}: batch ${(batch * 100).toFixed(0)}% paved`)
          .toBeGreaterThan(0.55);
        const worst = Math.min(...shares);
        expect(worst, `${template.id} r${richness}: worst ${(worst * 100).toFixed(0)}% paved`)
          .toBeGreaterThan(0.2);
      }
    }
  });

  it('walks further at full richness than at the quiet end', () => {
    let longer = 0;
    for (const seed of SEEDS) {
      const quiet = planMovementLine(seed, hexia, planComposition(seed, hexia, 0.2, 8), 0.2);
      const rich = lineFor(seed);
      if (rich.stops.length >= quiet.stops.length) longer++;
    }
    // The stop count is a rounded affine map of richness, so the rich walk is never shorter.
    expect(longer).toBe(SEEDS.length);
  });
});
