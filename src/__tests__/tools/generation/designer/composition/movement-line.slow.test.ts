/**
 * The movement line, the walk every other stage composes around: a readable sequence of stops, legs
 * that join end to end so a street can be laid along them, themes the kit library answers, and the
 * same walk from the same seed.
 */
import { describe, expect, it, vi } from 'vitest';

// Synchronous generation batch; seconds per case under a loaded or instrumented run.
vi.setConfig({ testTimeout: 60_000 });
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { makeRng } from '../../../../../core/base/rng';
import { flatIndex } from '../../../../../core/grid/rect';
import { MASSIF_PEAK_FROM, planComposition } from '../../../../../tools/generation/designer/composition/composition';
import { planDesign } from '../../../../../tools/generation/designer/pipeline';
import { planMovementLine } from '../../../../../tools/generation/designer/composition/movement-line';
import { styleOf } from '../../../../../tools/generation/designer/dressing/kits';
import type { RegionPlan } from '../../../../../tools/generation/designer/types';

const SEEDS = [12345, 777, 42, 2026, 7, 31337, 90210, 1024];
const hexia = MAP_TEMPLATES['hexia']!;
const tafa = MAP_TEMPLATES['tafa']!;

const lineFor = (seed: number, template = hexia, richness = 1): ReturnType<typeof planMovementLine> =>
  planMovementLine({ seed, template, composition: planComposition({ seed, template, richness, maxElevation: 8 }), richness });

describe('the movement line', () => {
  it('is the same walk from the same seed', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      expect(JSON.stringify(lineFor(seed))).toBe(JSON.stringify(lineFor(seed)));
    }
  });

  it('leaves the plaza through a market and finishes at a look-out', () => {
    for (const template of [hexia, tafa]) {
      for (const seed of SEEDS) {
        const line = planMovementLine({ seed, template, composition: planComposition({ seed, template, richness: 1, maxElevation: 8 }), richness: 1 });
        expect(line.stops.length).toBeGreaterThanOrEqual(2);
        expect(line.stops[0]!.role).toBe('market');
        expect(line.stops[line.stops.length - 1]!.role).toBe('lookout');
        // A look-out halfway along is a view the walk turns its back on.
        for (const stop of line.stops.slice(0, -1)) expect(stop.role).not.toBe('lookout');
      }
    }
  });

  /**
   * The look-out stands on the summit, read against the plan's peak rather than the built map's. A walk
   * grown greedily with no way back can strand in a pocket of the plate graph short of it.
   */
  it('ends on the composition own highest ground, wherever there is a massif', () => {
    const wide = [...SEEDS, 555, 8181, 313, 64007, 22, 4096, 199, 71, 8888, 3141, 27182, 60103];
    let arrived = 0, flat = 0;
    for (const template of [hexia, tafa]) {
      for (const richness of [0.5, 1]) {
        for (const seed of wide) {
          const composition = planComposition({ seed, template, richness, maxElevation: 8 });
          const line = planMovementLine({ seed, template, composition, richness });
          // Below a massif there is no summit to arrive at (the low-relief archetype at middle richness).
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
    // The skip stays the exception, or the probe proves nothing: 68 of these 80 runs carry a massif.
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
        // Consecutive legs on different axes share their corner cell.
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
   * Not all of it: a stretch is dropped where the ground cannot carry a street (a coast eating a
   * corner, a terrace step across the line) or where the plates leave a piece shorter than a street.
   */
  it('is paved, and mostly paved', () => {
    for (const template of [hexia, tafa]) {
      for (const richness of [0.2, 1]) {
        const shares: number[] = [];
        for (const seed of SEEDS) {
          const { line, streets } = planDesign({ seed, template, richness, maxElevation: 8 });
          const paved = new Set(streets.cells.map((c) => flatIndex(c.x, c.y, template.width)));
          const on = line.trace.filter((c) => paved.has(flatIndex(c.x, c.y, template.width))).length;
          const share = line.trace.length ? on / line.trace.length : 0;
          shares.push(share);
        }
        // The walk climbs terraces, and each flight keeps pavement off the cell before it and the
        // corridor it stands in; a leg the flights cannot carry is pruned. Over these seeds a single walk ranges from 21% to 96% paved
        // and batch means from 62% to 88%; the per-seed floor catches a walk that was never laid.
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
      const composition = planComposition({ seed, template: hexia, richness: 0.2, maxElevation: 8 });
      const quiet = planMovementLine({ seed, template: hexia, composition, richness: 0.2 });
      const rich = lineFor(seed);
      if (rich.stops.length >= quiet.stops.length) longer++;
    }
    // The stop count is a rounded affine map of richness, so the rich walk is never shorter.
    expect(longer).toBe(SEEDS.length);
  });
});
