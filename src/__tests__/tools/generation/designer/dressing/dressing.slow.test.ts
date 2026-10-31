// The theme kits, on a synthetic canvas and on whole designed maps: the rules accept every mark (a
// refused plant is a hole in a mirror) and the map scores in the reference maps' bands for symmetry,
// unity and density.
import { CHUNK_LOAD_LIMIT } from '../../../../../core/game/profile';
import { getMapStats } from '../../../../../state/map-stats';
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; tens of seconds on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { makeRng } from '../../../../../core/base/rng';
import type { MapTemplate } from '../../../../../core/model/types';
import { type Rect } from '../../../../../core/grid/rect';
import { categoryOf, getCatalogItem } from '../../../../../state/catalog';
import { objectRect } from '../../../../../state/object-geometry';
import { plantableSurface } from '../../../../../tools/reading';
import { evaluateMap, mirrorScore } from '../../../../_support/design-eval';
import { planDesignFor } from '../_design-plan';
import { familyOf, planPalettes, type RegionPalette } from '../../../../../tools/generation/designer/dressing/palette';
import { THEME_LIBRARY, themeRef } from '../../../../../tools/generation/designer/themes';
import { mirrorOf, symmetrize } from '../../../../../tools/generation/designer/dressing/symmetry';
import { designedMap, type DesignedRun } from '../_designed-map';
import { boxOf, compose, coverCap } from '../../../../../tools/generation/designer/dressing/elements';
import { planKitGround } from '../../../../../tools/generation/designer/dressing';
import { styleOf } from '../../../../../tools/generation/designer/dressing/kits';
import type { KitCanvas } from '../../../../../tools/generation/designer/dressing/types';
import type { AnchorKind, RegionPlan } from '../../../../../tools/generation/designer/types';
import { ItemCategory } from '../../../../../config/catalog/categories';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
const SEEDS = [12345, 777, 42, 2026, 7, 31337, 90210, 1024, 4242, 99];
/**
 * The seeds the richness-range unity floor is averaged over: one map's share swings with every street
 * that climbs a terrace (at full richness seed 2026 reads 0.50, the mean over these eight 0.68).
 */
const UNITY_SEEDS = SEEDS.slice(0, 8);

const CANVAS_W = 96;

const TREE_SHARE = 0.3;

/** A rectangle of plantable ground, with the region's palette on it. */
function canvasOf(rect: Rect, palette: RegionPalette, cover: number, treeShare = TREE_SHARE): KitCanvas {
  const cells = new Set<number>();
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let x = rect.x; x < rect.x + rect.w; x++) cells.add(y * CANVAS_W + x);
  }
  return {
    regionId: palette.regionId, cells, box: boxOf(cells, CANVAS_W), elevation: 1, W: CANVAS_W,
    cover, treeShare, orientation: 'south', palette, rng: makeRng(4242),
  };
}

function samplePalette(): RegionPalette {
  const plan = planDesignFor(4242, HEXIA, 0.5);
  return planPalettes(plan, 4242).get(plan.regions[0]!.id)!;
}

/** Every region kind a map can hold, as plan rows the dispatcher can be asked about. */
function everyRegion(): RegionPlan[] {
  const base = {
    anchors: [], size: { w: 12, h: 10 }, tags: [], lot: [{ x: 4, y: 4, w: 12, h: 10 }],
    entrySide: 'south' as const, orientation: 'south' as const,
  };
  const themes: RegionPlan[] = THEME_LIBRARY.map((t, i) => ({
    ...base, id: `theme-${i}`, kind: 'theme' as const, ...themeRef(t.id),
  }));
  const anchors: RegionPlan[] = (['residential', 'own-house', 'museum', 'shop'] as AnchorKind[])
    .map((kind) => ({ ...base, id: kind, kind }));
  return [...themes, ...anchors];
}

describe('the kit dispatcher', () => {
  it('has a style for every theme in the library and every anchor kind', () => {
    for (const region of everyRegion()) {
      const style = styleOf(region, makeRng(1));
      expect(style.tile.w, region.id).toBeGreaterThan(1);
      expect(style.mix.length, region.id).toBeGreaterThan(0);
      expect(style.mix.reduce((a, [, w]) => a + w, 0), region.id).toBeGreaterThan(0);
      expect(style.appetite, region.id).toBeGreaterThan(0);
    }
  });

  it('asks the ground only for what a theme needs, and only the themes that need it', () => {
    const plan = planDesignFor(2026, HEXIA, 1);
    const wants = planKitGround({ plan, seed: 2026, richness: 1 });
    expect(wants).toHaveLength(plan.regions.length);
    const byId = new Map(plan.regions.map((r) => [r.id, r] as const));
    for (const want of wants) {
      expect(want.pools, want.regionId).toBeGreaterThanOrEqual(0);
      expect(want.pools, want.regionId).toBeLessThanOrEqual(2);
      if (want.sunken) expect(byId.get(want.regionId)!.themeId).toBe('bamboo-court');
      if (want.ring) expect(byId.get(want.regionId)!.kind).toBe('shop');
    }
  });
});

describe('a kit fills its lot', () => {
  const palette = samplePalette();
  // Big enough to steer: a kit tiles in blocks of about 5x6 and mirrors their indices, so a 20x16 lot
  // has two steerable keys and would measure the fixture's grain rather than the tiling.
  const rect: Rect = { x: 8, y: 8, w: 40, h: 32 };

  it('plants inside the canvas, and more of it the more cover it is given', () => {
    let rose = 0, kits = 0;
    for (const region of everyRegion()) {
      const counts: number[] = [];
      // Clamped as the dressing pass clamps it: past `coverCap` the tree lattices take the beds' ground.
      for (const cover of [0.15, 0.35, 0.6].map((c) => Math.min(c, coverCap(TREE_SHARE)))) {
        const canvas = canvasOf(rect, palette, cover);
        const marks = compose(canvas, styleOf(region, makeRng(3)), 'v');
        for (const m of marks) {
          expect(canvas.cells.has(m.y * CANVAS_W + m.x), `${region.id} at ${m.x},${m.y}`).toBe(true);
        }
        counts.push(marks.length / canvas.cells.size);
      }
      // Steering stops within 0.02 of the ask, so one cover step can land a shade under the previous.
      const SLACK = 0.03;
      expect(counts[0], region.id).toBeGreaterThan(0.02);
      expect(counts[1], region.id).toBeGreaterThanOrEqual(counts[0]! - SLACK);
      expect(counts[2], region.id).toBeGreaterThanOrEqual(counts[1]! - SLACK);
      expect(counts[2], region.id).toBeLessThan(0.9);
      kits++;
      if (counts[2]! > counts[0]!) rose++;
    }
    // Not every kit: a mix the density knob cannot move (a border run, a chequer) saturates.
    expect(rose / kits).toBeGreaterThan(0.7);
  });

  it('stands every tree on one parity, which is what the exclusion radius needs', () => {
    for (const region of everyRegion()) {
      const canvas = canvasOf(rect, palette, 0.4);
      for (const m of compose(canvas, styleOf(region, makeRng(3)), 'v')) {
        if (getCatalogItem(m.catalogId)?.category !== ItemCategory.Tree) continue;
        expect(m.x % 2, `${region.id} tree at ${m.x},${m.y}`).toBe(0);
        expect(m.y % 2, `${region.id} tree at ${m.x},${m.y}`).toBe(0);
      }
    }
  });

  it('mirrors exactly once the composition is reflected', () => {
    for (const region of everyRegion()) {
      const canvas = canvasOf(rect, palette, 0.4);
      const mirror = mirrorOf(canvas.box, 'v');
      const raw = compose(canvas, styleOf(region, makeRng(3)), 'v');
      const marks = symmetrize(raw, mirror, (x, y) => canvas.cells.has(y * CANVAS_W + x));
      expect(marks.length, region.id).toBeGreaterThan(20);
      const score = mirrorScore(marks.map((m) => ({ x: m.x, y: m.y, id: m.catalogId })));
      expect(score.v, region.id).toBe(1);
    }
  });

  it('keeps one dominant colour family in every composition', () => {
    for (const region of everyRegion()) {
      const canvas = canvasOf(rect, palette, 0.4);
      const marks = compose(canvas, styleOf(region, makeRng(3)), 'v');
      const families = new Map<string, number>();
      for (const m of marks) families.set(familyOf(m.catalogId), (families.get(familyOf(m.catalogId)) ?? 0) + 1);
      const dominant = Math.max(...families.values()) / marks.length;
      // Half on one canvas: a single canvas holds too few blocks for the accent draw to average out.
      expect(dominant, `${region.id} dominant ${dominant.toFixed(2)}`).toBeGreaterThanOrEqual(0.5);
    }
  });

  it('lays a block in one species, so a bed reads as a bed', () => {
    // A flower field with the trees turned down to what a flat map asks for; a canvas whose blocks
    // the tree share has taken holds no bed to read.
    const canvas = canvasOf(rect, palette, 0.5, 0.05);
    const region = everyRegion().find((r) => r.themeId === 'flower-field')!;
    const marks = compose(canvas, styleOf(region, makeRng(3)), 'v');
    const at = new Map(marks.map((m) => [`${m.x},${m.y}`, m.catalogId] as const));
    let runs = 0;
    for (const m of marks) {
      let n = 1;
      while (at.get(`${m.x + n},${m.y}`) === m.catalogId) n++;
      if (n >= 4 && at.get(`${m.x - 1},${m.y}`) !== m.catalogId) runs++;
    }
    expect(runs).toBeGreaterThan(4);
  });
});

/** One designed map, generated once per (seed, template, richness, load limit) for this file. The
 *  load check runs on every read. */
function build(seed: number, template: MapTemplate, richness = 0.5, ignoreChunkLoad = false): DesignedRun {
  const run = designedMap(seed, template, { richness, ignoreChunkLoad });
  const { state } = run;
  if (!ignoreChunkLoad) {
    for (const [key, chunk] of getMapStats(state).chunks) {
      expect(chunk.load, `${template.id}/${seed} region ${key}`).toBeLessThanOrEqual(CHUNK_LOAD_LIMIT);
    }
  }
  return run;
}

describe('the dressed map', () => {
  it.each([['on', false], ['off', true]] as const)('has every composed mark accepted by the rules with the load limit %s', (_, ignoreChunkLoad) => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { outcome } = build(seed, template, 0.5, ignoreChunkLoad);
        expect(outcome.dressing.refused, `${template.id}/${seed}`).toBe(0);
        expect(outcome.dressing.planted, `${template.id}/${seed}`).toBeGreaterThan(400);
        if (ignoreChunkLoad) expect(outcome.dressing.overBudget, `${template.id}/${seed}`).toBe(0);
      }
    }
  });

  it('scores inside the calibration bands for symmetry, unity and density', () => {
    // Symmetry is held over the batch, the other two per map: a mirror is offered only to a run
    // compact enough to carry one, which depends on how the terrain cut the ground. The per-seed
    // symmetry floor only shows the operator ran.
    const shares: number[] = [];
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { state } = build(seed, template);
        const { scores, metrics } = evaluateMap(state);
        const where = `${template.id}/${seed}`;
        expect(scores.symmetryShare, where).toBeGreaterThanOrEqual(0.25);
        shares.push(scores.symmetryShare);
        // The worst seed over both templates reads 0.53: a street-end spot on unowned ground takes the
        // nearest region's palette, and a staggered street splits a place into runs.
        expect(scores.unityShare, where).toBeGreaterThanOrEqual(0.50);
        // The references sit at 0.073 and 0.092 plants per land cell; the floor is the lower one less
        // the ground water takes (a water cell also costs the dry cells whose flat sweep reaches it).
        expect(metrics.objects.decorDensity, where).toBeGreaterThanOrEqual(0.065);
        expect(metrics.objects.decorDensity, where).toBeLessThanOrEqual(0.095);
      }
    }
    const mean = shares.reduce((a, b) => a + b, 0) / shares.length;
    expect(mean, `batch symmetry ${mean.toFixed(2)}`).toBeGreaterThanOrEqual(0.5);
  });

  it('holds those bands across the richness range', () => {
    const pinned = 2026;
    for (const richness of [0.2, 1]) {
      const { state } = build(pinned, HEXIA, richness);
      const { scores, metrics } = evaluateMap(state);
      // This seed reads 0.28 at full richness and 0.35 at the quiet end: a mirror across a terrace step
      // counts in neither run.
      expect(scores.symmetryShare, `richness ${richness}`).toBeGreaterThanOrEqual(richness >= 1 ? 0.25 : 0.35);
      // Unity is lower at full richness for the same reason: terrace steps leave a place sharing its
      // run with its neighbour.
      const unity = UNITY_SEEDS.map((s) => (s === pinned ? scores : evaluateMap(build(s, HEXIA, richness).state).scores).unityShare);
      const unityMean = unity.reduce((a, b) => a + b, 0) / unity.length;
      expect(unityMean, `richness ${richness}: unity ${unity.map((u) => u.toFixed(2)).join(', ')}`)
        .toBeGreaterThanOrEqual(richness >= 1 ? 0.52 : 0.6);
      expect(metrics.objects.decorDensity, `richness ${richness}`).toBeGreaterThanOrEqual(0.065);
      expect(metrics.objects.decorDensity, `richness ${richness}`).toBeLessThanOrEqual(0.095);
    }
  });

  it('plants nothing on a road', () => {
    for (const seed of SEEDS) {
      const { state } = build(seed, HEXIA);
      const paved = new Set<string>();
      const plants: { x: number; y: number }[] = [];
      for (const o of state.objects.values()) {
        const cat = categoryOf(o);
        const r = objectRect(o);
        for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
          for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
            if (cat === ItemCategory.Road) paved.add(`${x},${y}`);
            else if (cat === ItemCategory.Tree || cat === ItemCategory.Flora) plants.push({ x, y });
          }
        }
      }
      for (const p of plants) expect(paved.has(`${p.x},${p.y}`), `seed ${seed} at ${p.x},${p.y}`).toBe(false);
    }
  });

  it('cuts water into the places that asked for it', () => {
    let bodies = 0;
    for (const seed of SEEDS) {
      bodies += build(seed, HEXIA).outcome.sculpt.water.filter((w) => w.regionId !== '').length;
    }
    expect(bodies).toBeGreaterThan(SEEDS.length);
  });

  it('leaves most of the open ground bare, so the planting reads as places', () => {
    for (const seed of [12345, 2026]) {
      const { state } = build(seed, HEXIA);
      const surface = plantableSurface(state);
      const planted = new Set<number>();
      let covered = 0;
      for (const o of state.objects.values()) {
        const cat = categoryOf(o);
        const r = objectRect(o);
        for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++) {
          for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) {
            const i = y * state.template.width + x;
            covered++;
            if (cat === ItemCategory.Tree || cat === ItemCategory.Flora) planted.add(i);
          }
        }
      }
      let open = 0;
      for (let i = 0; i < surface.length; i++) if (surface[i]! >= 0) open++;
      expect(covered, `seed ${seed}`).toBeGreaterThan(0);
      expect(planted.size / open, `seed ${seed}`).toBeLessThan(0.4);
    }
  });
});
