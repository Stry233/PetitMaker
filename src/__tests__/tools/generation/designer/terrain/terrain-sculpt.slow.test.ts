// The sculptor realizes the composition's plates as ground. Shape claims (tiers, flight landings,
// water kinds and tiers) are read off the pure sculpt; legality claims off a committed map, which
// must re-validate with no violations and no refused layer.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; tens of seconds on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/grid/rect';
import { detectWaterfalls } from '../../../../../core/domain/terrain/waterfall-geometry';
import { TerrainType, type MapTemplate } from '../../../../../core/model/types';
import { categoryOf } from '../../../../../state/catalog';
import { cellTiers } from '../../../../../tools/generation/designer/planet';
import { planDesign } from '../../../../../tools/generation/designer/pipeline';
import { planComposition } from '../../../../../tools/generation/designer/composition/composition';
import { designedMap, memo, type DesignedRun } from '../_designed-map';
import { sculptTerrain, type TerrainSculpt } from '../../../../../tools/generation/designer/terrain/terrain-sculpt';
import { terraceShape, TERRACE_FILL_MAX } from '../../../../_support/design-eval';
import { ItemCategory } from '../../../../../config/catalog/categories';
import { ELEVATION_MAX } from '../../../../../core/game/profile';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
const SEEDS = [12345, 777, 42, 2026, 7];

/** The pure sculpt for one seed: the three planning stages, then the ground they stand on. */
function sculptFor(seed: number, template: MapTemplate, richness: number): TerrainSculpt {
  const { composition, streets, plan, anchors, ground } = planDesign({ seed, template, richness });
  return sculptTerrain({ template, composition, streets, plan, anchors, seed, richness, ground });
}

/** `sculptFor`, sculpted once per (seed, template, richness) for this file. Read-only. */
const sculpt = memo(sculptFor);

/** One designed map, generated once per (seed, template, richness) for this file. Read-only. */
function build(seed: number, template: MapTemplate, richness = 0.5): DesignedRun {
  return designedMap(seed, template, { richness, maxElevation: 8 });
}

describe('the ground is the composition, realized', () => {
  it('stands every cell at its plate tier, on both templates', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const composition = planComposition({ seed, template, richness: 1 });
        const tiers = cellTiers(template, composition);
        const s = sculpt(seed, template, 1);
        let cells = 0, agreed = 0;
        for (let i = 0; i < tiers.length; i++) {
          if (tiers[i]! <= 0) continue;
          cells++;
          // Water carries its own level; a composed place stands one above its block's floor.
          const level = s.terrain.water[i]! >= 0 ? s.terrain.water[i]! : s.terrain.tier[i]!;
          if (level === tiers[i] || level === tiers[i]! + 1) agreed++;
        }
        expect(cells, `${template.id}/${seed}`).toBeGreaterThan(200);
        // A taller summit's base support takes more of its rim below the plate tier: hexia seed 42
        // reads 0.88, the other seeds above 0.9.
        expect(agreed / cells, `${template.id}/${seed}: cells at their plate's tier`)
          .toBeGreaterThan(0.88);
      }
    }
  });

  it('carves every flight landing at the tier the street plan declared', () => {
    for (const seed of SEEDS) {
      const { composition, streets, plan, anchors, ground } = planDesign({ seed, template: HEXIA, richness: 1 });
      const s = sculptTerrain({ template: HEXIA, composition, streets, plan, anchors, seed, richness: 1, ground });
      for (const flight of streets.flights) {
        for (const landing of flight.landings) {
          for (let y = landing.rect.y; y < landing.rect.y + landing.rect.h; y++) {
            for (let x = landing.rect.x; x < landing.rect.x + landing.rect.w; x++) {
              const i = flatIndex(x, y, HEXIA.width);
              if (s.terrain.tier[i] === 0 && landing.tier > 0
                && HEXIA.zones[y]?.[x] !== 2) continue;   // off the buildable land
              expect(s.terrain.tier[i], `seed ${seed}: landing at ${x},${y}`).toBe(landing.tier);
            }
          }
        }
      }
    }
  });

  it('grows taller with richness and never passes the map\'s ceiling', () => {
    let peak = -1;
    for (const richness of [0, 0.25, 0.5, 0.75, 1]) {
      const s = sculpt(2026, HEXIA, richness);
      expect(s.wall.peak, `richness ${richness}`).toBeGreaterThanOrEqual(peak);
      expect(s.wall.peak).toBeLessThanOrEqual(ELEVATION_MAX);
      peak = s.wall.peak;
    }
  });

  it('honours a lowered ceiling', () => {
    const { composition, streets, plan, anchors } = planDesign({ seed: 42, template: HEXIA, richness: 1, maxElevation: 3 });
    const s = sculptTerrain({ template: HEXIA, composition, streets, plan, anchors, seed: 42, richness: 1 });
    // The sculptor gets no ceiling of its own: it reads the cap off the plan, so the passes that add a
    // tier (a place's terrace, a door's backing) stay under it.
    expect(s.wall.peak).toBeLessThanOrEqual(3);
    expect(Math.max(...s.terrain.tier)).toBeLessThanOrEqual(3);
    expect(Math.max(...s.terrain.water)).toBeLessThanOrEqual(3);
  });

  it('never puts water under a building or its doorstep', () => {
    for (const template of [HEXIA, TAFA]) {
      const { composition, streets, plan, anchors, ground } = planDesign({ seed: 31337, template, richness: 1 });
      const s = sculptTerrain({ template, composition, streets, plan, anchors, seed: 31337, richness: 1, ground });
      for (const p of anchors.placements) {
        for (const cell of [p.position, p.gate, p.approach]) {
          const i = flatIndex(cell.x, cell.y, template.width);
          expect(s.terrain.water[i], `${p.catalogId} at ${cell.x},${cell.y}`).toBe(-1);
        }
      }
    }
  });
});

describe('the ground is not a box (I5.3)', () => {
  // Against terraces drawn as full rectangles with ruled seams: `liftRect` chamfers a lift's corners
  // and `erodeSeams` bites seams where nothing is built.
  it('leaves the median terrace off its own bounding box', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS.slice(0, 3)) {
        const { state } = build(seed, template, 1);
        const shape = terraceShape(state);
        expect(shape.components, `${template.id}/${seed}`).toBeGreaterThan(20);
        expect(shape.medianFill, `${template.id}/${seed}: median box fill`)
          .toBeLessThanOrEqual(TERRACE_FILL_MAX);
        expect(shape.boxyShare, `${template.id}/${seed}: boxy share`).toBeLessThan(0.7);
      }
    }
  });

  it('erodes a seam only where nothing is built against it', () => {
    // Pavement, doorsteps and the figure's panel are reserved before erosion, so every road tile's
    // 2x2 window stays on one level, as a coating requires.
    for (const seed of SEEDS.slice(0, 3)) {
      const { state, violations } = build(seed, HEXIA, 1);
      expect(violations, `hexia/${seed}`).toEqual([]);
      let roads = 0, level = 0;
      for (const o of state.objects.values()) {
        if (categoryOf(o) !== ItemCategory.Road) continue;
        roads++;
        const here = state.cells[o.position.y]?.[o.position.x]?.terrain;
        const east = state.cells[o.position.y]?.[o.position.x + 1]?.terrain;
        const south = state.cells[o.position.y + 1]?.[o.position.x]?.terrain;
        const own = here?.elevation ?? 0;
        if ((east?.elevation ?? 0) === own && (south?.elevation ?? 0) === own) level++;
      }
      expect(roads, `hexia/${seed}`).toBeGreaterThan(100);
      expect(level / roads, `hexia/${seed}: road tiles whose window is one level`).toBe(1);
    }
  });
});

describe('water is a material', () => {
  it('commits clean: every body is legal where it was drawn', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const { state, outcome, violations } = build(seed, template, 1);
        expect(violations, `${template.id}/${seed}`).toEqual([]);
        expect(outcome.terrain.refused, `${template.id}/${seed}`).toBe(0);
        let water = 0;
        for (const row of state.cells) {
          for (const cell of row) if (cell.terrain?.type === TerrainType.Water) water++;
        }
        // These seeds hold 567 to 936 water cells on hexia and 707 to 1080 on tafa.
        expect(water, `${template.id}/${seed}`).toBeGreaterThan(450);
        // How many falls a map carries depends on its terrace steps; it must carry some.
        expect(detectWaterfalls(state).length, `${template.id}/${seed}`).toBeGreaterThan(2);
      }
    }
  });

  it('speaks the water SYSTEM, not one shape', () => {
    const kinds = new Set<string>();
    let stories = 0;
    for (const seed of SEEDS) {
      const s = sculpt(seed, HEXIA, 1);
      for (const f of s.water) kinds.add(f.kind);
      if (s.story) stories++;
    }
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['accent', 'fall', 'fountain', 'pond', 'story']));
    // A map whose ground offers no story is left dry, so this is a majority claim.
    expect(stories, `${stories} of ${SEEDS.length} seeds carry a story`).toBeGreaterThan(SEEDS.length / 2);
  });

  it('carries water on the upper terraces as well as the low ground', () => {
    const s = sculpt(12345, HEXIA, 1);
    const tiers = new Set<number>();
    for (const f of s.water) tiers.add(f.tier);
    // The style target carries water on every layer, its share roughly doubling above elevation 3.
    expect(tiers.size, `tiers ${[...tiers].sort().join(',')}`).toBeGreaterThan(2);
    expect(Math.max(...tiers)).toBeGreaterThan(1);
  });

  it('plants nothing in water, and nothing whose sweep reaches it', () => {
    const { state } = build(777, HEXIA, 1);
    const W = state.template.width, H = state.template.height;
    const wet = (x: number, y: number): boolean =>
      state.cells[y]?.[x]?.terrain?.type === TerrainType.Water;
    for (const o of state.objects.values()) {
      const category = categoryOf(o);
      if (category !== ItemCategory.Tree && category !== ItemCategory.Flora) continue;
      const x = Math.floor(o.position.x), y = Math.floor(o.position.y);
      // The flat trait's window: the cell, one column right and one row below. The references have
      // no plant breaking it.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]] as const) {
        if (x + dx >= W || y + dy >= H) continue;
        expect(wet(x + dx, y + dy), `${o.catalogId} at ${x},${y} sweeps water`).toBe(false);
      }
    }
  });
});

describe('determinism', () => {
  it('sculpts the same terrain for the same inputs, and different terrain for a different seed', () => {
    for (const template of [HEXIA, TAFA]) {
      const a = sculpt(4242, template, 0.65);
      const b = sculpt(4242, template, 0.65);
      expect([...a.terrain.tier]).toEqual([...b.terrain.tier]);
      expect([...a.terrain.water]).toEqual([...b.terrain.water]);
      expect(a.water).toEqual(b.water);
    }
    const one = sculpt(1, HEXIA, 0.65), two = sculpt(2, HEXIA, 0.65);
    expect([...one.terrain.water]).not.toEqual([...two.terrain.water]);
  });
});
