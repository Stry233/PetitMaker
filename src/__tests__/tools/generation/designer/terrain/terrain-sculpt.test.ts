// The SCULPTOR: the ground the design stands on, realized from the composition's plates. Two kinds
// of claim are pinned here.
//
// The SHAPE claims are read off the pure sculpt (`sculptTerrain` takes the three stages' plans and
// gives a TerrainPlan back): the ground a cell ends at is the composition's own tier, a flight's
// landings are carved where stage B declared them, and the water speaks the grammar the reference
// maps read — bodies at every tier, falls with capped ends, and dry beds between the bars of a
// comb rather than planting standing in water.
//
// The LEGALITY claims are read off a COMMITTED map, because that is the only place they mean
// anything: the sculpt draws only shapes the water and base-support rules already accept, so the
// finished state must re-validate with no violations and no refused layer — a repaired-away terrace
// would pass a rule check while failing the design.
import { describe, it, expect, vi } from 'vitest';

// Synchronous generation batch; tens of seconds on an idle machine.
vi.setConfig({ testTimeout: 60_000 });
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { CommandExecutor } from '../../../../../core/commands/command-executor';
import { EventBus } from '../../../../../core/commands/event-bus';
import { createGrid, createPlazaObject, flatIndex } from '../../../../../core/model/grid-model';
import { detectWaterfalls } from '../../../../../core/model/waterfall-geometry';
import {
  ItemCategory, TerrainType,
  type Command, type EditorEvents, type GridState, type MapTemplate,
} from '../../../../../core/model/types';
import { createDefaultRegistry } from '../../../../../rules';
import { categoryOf } from '../../../../../state/catalog';
import { planAnchors } from '../../../../../tools/generation/designer/places/anchors';
import { cellTiers, planComposition } from '../../../../../tools/generation/designer/composition/composition';
import { planDistricts } from '../../../../../tools/generation/designer/places/districts';
import { planKitGround } from '../../../../../tools/generation/designer/dressing';
import { generateDesigned, type DesignedOutcome } from '../../../../../tools/generation/designer/pipeline';
import { planStreets } from '../../../../../tools/generation/designer/streets/streets';
import { sculptTerrain, type TerrainSculpt } from '../../../../../tools/generation/designer/terrain/terrain-sculpt';
import { terraceShape, TERRACE_FILL_MAX } from '../../../../../tools/generation/designer/eval';

const HEXIA = MAP_TEMPLATES['hexia']!;
const TAFA = MAP_TEMPLATES['tafa']!;
const SEEDS = [12345, 777, 42, 2026, 7];

/** The pure sculpt for one seed: the three planning stages, then the ground they stand on. No map is
 *  touched, which is the whole point — every stage is data in, data out. */
function sculpt(seed: number, template: MapTemplate, richness: number): TerrainSculpt {
  const composition = planComposition(seed, template, richness);
  const streets = planStreets(seed, template, composition, richness);
  const plan = planDistricts(seed, template, composition, streets, richness).design;
  return sculptTerrain({
    template, composition, streets, plan, anchors: planAnchors(seed, plan), seed, richness,
    ground: planKitGround(plan, seed, richness),
  });
}

interface Run { state: GridState; outcome: DesignedOutcome; violations: unknown[] }

/** One designed map, built the way the app builds one: a silent stroke group, committed at the end
 *  so the post-stroke rules judge the finished state. */
function build(seed: number, template: MapTemplate, richness = 0.5): Run {
  const state: GridState = {
    template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
  };
  const plaza = createPlazaObject(template);
  if (plaza) state.objects.set(plaza.id, plaza);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), () => null);
  let outcome: DesignedOutcome | undefined;
  exec.runSilently(() => {
    outcome = generateDesigned({
      state, execute: (c: Command) => exec.execute(c), reg: exec.getRegistry(),
      seed, richness, maxElevation: 8,
    });
  });
  return { state, outcome: outcome!, violations: exec.commitStrokeGroup(exec.getUndoStackSize()) };
}

describe('the ground is the composition, realized', () => {
  it('stands every cell at its plate tier, on both templates', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS) {
        const composition = planComposition(seed, template, 1);
        const tiers = cellTiers(template, composition);
        const s = sculpt(seed, template, 1);
        let cells = 0, agreed = 0;
        for (let i = 0; i < tiers.length; i++) {
          if (tiers[i]! <= 0) continue;
          cells++;
          // Water carries its own level, a flight's landing is a tier the plan asked for, and a
          // composed place stands ONE above its block's floor on purpose; every other cell stands
          // exactly where the composition put it.
          const level = s.terrain.water[i]! >= 0 ? s.terrain.water[i]! : s.terrain.tier[i]!;
          if (level === tiers[i] || level === tiers[i]! + 1) agreed++;
        }
        expect(cells, `${template.id}/${seed}`).toBeGreaterThan(200);
        expect(agreed / cells, `${template.id}/${seed}: cells at their plate's tier`)
          .toBeGreaterThan(0.9);
      }
    }
  });

  it('carves every flight landing at the tier the street plan declared', () => {
    for (const seed of SEEDS) {
      const composition = planComposition(seed, HEXIA, 1);
      const streets = planStreets(seed, HEXIA, composition, 1);
      const plan = planDistricts(seed, HEXIA, composition, streets, 1).design;
      const s = sculptTerrain({
        template: HEXIA, composition, streets, plan, anchors: planAnchors(seed, plan), seed,
        richness: 1, ground: planKitGround(plan, seed, 1),
      });
      for (const flight of streets.flights) {
        for (const landing of flight.landings) {
          for (let y = landing.rect.y; y < landing.rect.y + landing.rect.h; y++) {
            for (let x = landing.rect.x; x < landing.rect.x + landing.rect.w; x++) {
              const i = flatIndex(x, y, HEXIA.width);
              if (s.terrain.tier[i] === 0 && landing.tier > 0
                && HEXIA.zones[y]?.[x] !== 2) continue;   // off the buildable island
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
      expect(s.wall.peak).toBeLessThanOrEqual(8);
      peak = s.wall.peak;
    }
  });

  it('honours a lowered ceiling', () => {
    const composition = planComposition(42, HEXIA, 1, 3);
    const streets = planStreets(42, HEXIA, composition, 1);
    const plan = planDistricts(42, HEXIA, composition, streets, 1).design;
    const s = sculptTerrain({
      template: HEXIA, composition, streets, plan, anchors: planAnchors(42, plan), seed: 42,
      richness: 1,
    });
    // NOT PASSED A CEILING OF ITS OWN. The composition was drawn under one and the sculptor reads it
    // off the plan, so a caller that caps the composition caps the map: the passes that ADD a tier —
    // a place's terrace, a door's backing, a shop's ring — are held to the plan's own ask.
    expect(s.wall.peak).toBeLessThanOrEqual(3);
    expect(Math.max(...s.terrain.tier)).toBeLessThanOrEqual(3);
    expect(Math.max(...s.terrain.water)).toBeLessThanOrEqual(3);
  });

  it('never puts water under a building or its doorstep', () => {
    for (const template of [HEXIA, TAFA]) {
      const composition = planComposition(31337, template, 1);
      const streets = planStreets(31337, template, composition, 1);
      const plan = planDistricts(31337, template, composition, streets, 1).design;
      const anchors = planAnchors(31337, plan);
      const s = sculptTerrain({
        template, composition, streets, plan, anchors, seed: 31337, richness: 1,
        ground: planKitGround(plan, 31337, 1),
      });
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
  // TOFU TERRAIN is a raised terrace drawn as a full rectangle with a ruled seam where two plates
  // meet. Two passes answer it — the corner chamfers `liftRect` gives a lift, and the bite
  // `erodeSeams` takes out of a seam where nothing is built — and what is pinned here is the shape
  // they leave and the legality they keep.
  it('leaves the median terrace off its own bounding box', () => {
    for (const template of [HEXIA, TAFA]) {
      for (const seed of SEEDS.slice(0, 3)) {
        const { state } = build(seed, template, 1);
        const shape = terraceShape(state);
        expect(shape.components, `${template.id}/${seed}`).toBeGreaterThan(20);
        expect(shape.medianFill, `${template.id}/${seed}: median box fill`)
          .toBeLessThanOrEqual(TERRACE_FILL_MAX);
        // And the map is not made of boxes: the share at the box fill is well under all of it.
        expect(shape.boxyShare, `${template.id}/${seed}: boxy share`).toBeLessThan(0.7);
      }
    }
  });

  it('erodes a seam only where nothing is built against it', () => {
    // Pavement, doorsteps and the figure's panel are reserved before the bite is taken, so a paved
    // cell can never stand on ground the erosion moved: read on the finished map, every road tile
    // stands on ONE level with its own 2x2 window, which is what a coating validates.
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
        // The island's water is spent on a COURSE, its fountain courts, the cascades and a few
        // accents rather than on beds cut into every terrace, so the count is a small share of the
        // ground. What is pinned is that a full-richness map is WET: measured 567-936 cells on hexia
        // and 707-1080 on tafa over these seeds.
        expect(water, `${template.id}/${seed}`).toBeGreaterThan(450);
        // A fall is cut where a terrace step offers a run with caps at both ends, so how many a map
        // carries is its composition's to say: a plate map with few long steps carries a handful, a
        // terraced one carries dozens. What is pinned is that the water FALLS somewhere.
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
    // The course and its arrival, the courts, the cascades off the terrace steps, and the accents
    // beside them: that is the whole inventory of a map's water.
    expect([...kinds].sort()).toEqual(expect.arrayContaining(['accent', 'fall', 'fountain', 'pond', 'story']));
    // The story is the island's water. A map whose ground carries none is left dry rather than
    // sprinkled, so this is a majority claim and not an every-seed one.
    expect(stories, `${stories} of ${SEEDS.length} seeds carry a story`).toBeGreaterThan(SEEDS.length / 2);
  });

  it('carries water on the upper terraces as well as the low ground', () => {
    const s = sculpt(12345, HEXIA, 1);
    const tiers = new Set<number>();
    for (const f of s.water) tiers.add(f.tier);
    // The style target carries water on every one of its nine layers, its share roughly doubling
    // above elevation 3. One mechanism covers every layer here, so a rich map spreads.
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
      // The flat trait's own window: the cell plus one column right and one row below. The reference
      // maps hold zero plants breaking it, and so must ours.
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
