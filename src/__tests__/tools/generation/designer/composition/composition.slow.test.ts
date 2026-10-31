// The composition planner: every buildable cell sits on exactly one plate, a plate is one connected
// surface, no two neighbouring plates stand more than V-MTN-03's window apart, and a batch of seeds
// varies in archetype and in the side its mass falls on.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { type MapTemplate } from '../../../../../core/model/types';
import { CellZone } from '../../../../../core/game/zones';
import { anchorTier, cellTiers, paintableMask, hubRect, landMask } from '../../../../../tools/generation/designer/planet';
import { footprintTerrain } from '../../../../../core/grid/footprint';
import {
  PLATE_STEP_MAX, PLATE_TOTAL_MAX, planComposition, type CompositionPlan,
} from '../../../../../tools/generation/designer/composition/composition';
import { PLATE_COUNT_BAND, plateAdjacency } from '../../../../../tools/generation/designer/composition/plates';
import { compositionVariety, type CompositionSample } from '../../../../_support/design-eval';
import { ELEVATION_MAX } from '../../../../../core/game/profile';
import { templateAnchor } from '../../../../../core/model/landmarks';

const TEMPLATES: MapTemplate[] = [MAP_TEMPLATES.hexia!, MAP_TEMPLATES.tafa!];
/** Twenty unrelated seeds, so a batch reading is not one arithmetic sequence. */
const SEEDS = [7, 42, 777, 1024, 2026, 12345, 31337, 90210, 555, 8181,
  313, 64007, 22, 4096, 199, 71, 8888, 3141, 27182, 60103];

function landCellsOf(template: MapTemplate): number {
  return landMask(template).reduce((n, cell) => n + cell, 0);
}

/** Is every cell of the plate reachable from its first cell without leaving the plate? */
function isConnected(cells: readonly number[], W: number): boolean {
  const set = new Set(cells);
  const seen = new Set<number>([cells[0]!]);
  const stack = [cells[0]!];
  while (stack.length) {
    const p = stack.pop()!;
    const x = p % W, y = (p / W) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const j = (y + dy) * W + (x + dx);
      if (!set.has(j) || seen.has(j)) continue;
      seen.add(j); stack.push(j);
    }
  }
  return seen.size === cells.length;
}

/** A plan reduced to plain values, for equality between two runs of the same arguments. */
function digest(plan: CompositionPlan): string {
  return JSON.stringify({
    archetype: plan.archetype, axis: plan.axis, crossAxis: plan.crossAxis ?? null,
    peak: plan.peakTier, hubPlateId: plan.hubPlateId,
    mass: [Math.round(plan.massCentroid.x * 100), Math.round(plan.massCentroid.y * 100)],
    plates: plan.plates.map((p) => [p.id, p.tier, p.cells.length, p.rect.x, p.rect.y, p.rect.w, p.rect.h]),
  });
}

describe('the plaza hub', () => {
  // The template's plaza sits on the half grid, so a rounded rect would leave the hub's edge cells out.
  it('is the whole macro cells the template\'s plaza touches', () => {
    for (const template of TEMPLATES) {
      const r = hubRect(template), p = templateAnchor(template)!;
      expect(r.x, template.id).toBe(Math.floor(p.x));
      expect(r.y, template.id).toBe(Math.floor(p.y));
      expect(r.x + r.w, template.id).toBeGreaterThanOrEqual(p.x + p.width);
      expect(r.y + r.h, template.id).toBeGreaterThanOrEqual(p.y + p.height);
      expect(r.w, template.id).toBeLessThan(p.width + 2);
      expect(r.h, template.id).toBeLessThan(p.height + 2);
    }
  });
});

describe('plate coverage', () => {
  for (const template of TEMPLATES) {
    it(`covers every buildable cell of ${template.id} exactly once`, () => {
      const land = landCellsOf(template);
      for (const richness of [0, 0.5, 1]) {
        for (const seed of SEEDS.slice(0, 6)) {
          const plan = planComposition({ seed, template, richness });
          // Counted, not asserted per cell, so 16k cells do not cost 16k assertions.
          const hits = new Uint8Array(template.width * template.height);
          let covered = 0, twice = 0, offLand = 0, unmapped = 0;
          for (const plate of plan.plates) {
            for (const i of plate.cells) {
              if (hits[i]) twice++; else covered++;
              hits[i] = 1;
              const x = i % template.width, y = (i / template.width) | 0;
              if (template.zones[y]?.[x] !== CellZone.Grass) offLand++;
              if (plan.plateOf[i] !== plate.id) unmapped++;
            }
          }
          expect({ twice, offLand, unmapped }).toEqual({ twice: 0, offLand: 0, unmapped: 0 });
          expect(covered).toBe(land);
          let mapped = 0;
          for (let i = 0; i < plan.plateOf.length; i++) if (plan.plateOf[i]! >= 0) mapped++;
          expect(mapped).toBe(land);
        }
      }
    });

    it(`cuts ${template.id} into connected plates within the count band`, () => {
      for (const richness of [0, 0.5, 1]) {
        for (const seed of SEEDS.slice(0, 6)) {
          const plan = planComposition({ seed, template, richness });
          expect(plan.plates.length).toBeGreaterThanOrEqual(PLATE_COUNT_BAND.min);
          expect(plan.plates.length).toBeLessThanOrEqual(PLATE_TOTAL_MAX);
          for (const plate of plan.plates) {
            expect(plate.cells.length).toBeGreaterThan(0);
            expect(isConnected(plate.cells, template.width)).toBe(true);
          }
        }
      }
    });
  }
});

describe('plate adjacency', () => {
  it('counts a plate met only at a corner, which V-MTN-03 reads over the 3x3', () => {
    // Four plates meeting at one point, the `+` junction of two cuts landing on one coordinate; the
    // two diagonal pairs touch nowhere else.
    const W = 8;
    const plateOf = new Int16Array(W * 8).fill(-1);
    const plates = [0, 1, 2, 3].map((id) => ({
      id, rect: { x: 0, y: 0, w: 4, h: 4 }, cells: [] as number[], tier: 0, relief: 0,
    }));
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        const id = (y < 4 ? 0 : 2) + (x < 4 ? 0 : 1);
        plateOf[y * W + x] = id;
        plates[id]!.cells.push(y * W + x);
      }
    }
    const pairs = plateAdjacency(plates, plateOf, W, 8).map(([a, b]) => `${a}-${b}`);
    expect(pairs).toContain('0-3');
    expect(pairs).toContain('1-2');
    expect(pairs.length).toBe(6);
  });

  it('bounds a corner-only pair on a real plan like an edge pair', () => {
    let corners = 0;
    for (const template of TEMPLATES) {
      const { width: W, height: H } = template;
      for (const seed of SEEDS.slice(0, 10)) {
        const plan = planComposition({ seed, template, richness: 1 });
        // Pairs that touch on a diagonal and nowhere else, found without the planner's own adjacency.
        const edge = new Set<string>(), diagonal = new Set<string>();
        for (let y = 0; y < H; y++) {
          for (let x = 0; x < W; x++) {
            const id = plan.plateOf[y * W + x]!;
            if (id < 0) continue;
            for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]] as const) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
              const other = plan.plateOf[ny * W + nx]!;
              if (other < 0 || other === id) continue;
              const key = `${Math.min(id, other)}-${Math.max(id, other)}`;
              (dx !== 0 && dy !== 0 ? diagonal : edge).add(key);
            }
          }
        }
        for (const key of diagonal) {
          if (edge.has(key)) continue;
          corners++;
          const [a, b] = key.split('-').map(Number) as [number, number];
          expect(Math.abs(plan.plates[a]!.tier - plan.plates[b]!.tier)).toBeLessThanOrEqual(PLATE_STEP_MAX);
        }
      }
    }
    // The diagonal-only case occurs, so the pass is not vacuous.
    expect(corners).toBeGreaterThan(0);
  });
});

describe('tier legality', () => {
  for (const template of TEMPLATES) {
    it(`steps at most ${PLATE_STEP_MAX} tiers between neighbouring plates on ${template.id}`, () => {
      for (const richness of [0.25, 0.6, 1]) {
        for (const seed of SEEDS.slice(0, 6)) {
          const plan = planComposition({ seed, template, richness });
          for (const plate of plan.plates) {
            expect(plate.tier).toBeGreaterThanOrEqual(0);
            expect(plate.tier).toBeLessThanOrEqual(ELEVATION_MAX);
          }
          for (const [a, b] of plateAdjacency(plan.plates, plan.plateOf, template.width, template.height)) {
            expect(Math.abs(plan.plates[a]!.tier - plan.plates[b]!.tier)).toBeLessThanOrEqual(PLATE_STEP_MAX);
          }
        }
      }
    });
  }

  it('stands the plaza plate at the ground the template lays under the plaza and rises away from it', () => {
    for (const template of TEMPLATES) {
      expect(anchorTier(template), template.id).toBe(1);
      let rose = 0;
      for (const seed of SEEDS) {
        const plan = planComposition({ seed, template, richness: 1 });
        const hub = plan.plates[plan.hubPlateId]!.tier;
        expect(hub, `${template.id}/${seed}`).toBe(anchorTier(template));
        if (Math.max(...plan.plates.map((p) => p.tier)) > hub) rose++;
      }
      // A rich map is not a flat one: every seed at richness 1 carries mass above the plaza.
      expect(rose, template.id).toBe(SEEDS.length);
    }
  });

  it('keeps the plaza plate at layer 0 where nothing is laid under the plaza', () => {
    for (const base of TEMPLATES) {
      const template: MapTemplate = { ...base, terrain: new Uint8Array(base.width * base.height) };
      expect(anchorTier(template)).toBe(0);
      for (const seed of SEEDS.slice(0, 6)) {
        const plan = planComposition({ seed, template, richness: 1 });
        expect(plan.plates[plan.hubPlateId]!.tier, `${base.id}/${seed}`).toBe(0);
      }
    }
  });

  it('plans the ground the plaza rests on at the plaza plate\'s tier, and paints none of it', () => {
    for (const template of TEMPLATES) {
      const plan = planComposition({ seed: 42, template, richness: 0.6 });
      const tiers = cellTiers(template, plan);
      const paintable = paintableMask(template);
      const anchor = templateAnchor(template)!;
      const held = footprintTerrain({ x: anchor.x, y: anchor.y, w: anchor.width, h: anchor.height });
      for (let y = held.y; y < held.y + held.h; y++) {
        for (let x = held.x; x < held.x + held.w; x++) {
          const i = y * template.width + x;
          expect(tiers[i], `${template.id} ${x},${y}`).toBe(plan.plates[plan.hubPlateId]!.tier);
          expect(paintable[i], `${template.id} ${x},${y}`).toBe(0);
        }
      }
    }
  });
});

describe('the asked height is reached', () => {
  const peakOf = (plan: CompositionPlan): number => Math.max(...plan.plates.map((p) => p.tier));

  for (const template of TEMPLATES) {
    it(`climbs to the cap the caller asked for on ${template.id}`, () => {
      // The cap is reached, not merely permitted.
      for (const cap of [6, 8]) {
        // Three of the twenty seeds fall short at cap 8. Seed 7 draws `low-relief`, whose ceiling is
        // four tiers. Seeds 31337 and 60103 on tafa draw `distributed-massifs` and stop at 7: the
        // crown's last lift needs an inset at which every floor it could stand on erodes away.
        const short = SEEDS.filter((seed) => peakOf(planComposition({ seed, template, richness: 1, maxElevation: cap })) !== cap);
        expect(short.length, `${template.id} cap ${cap}: short on ${short.join(', ')}`)
          .toBeLessThanOrEqual(3);
      }
    });

    it(`never passes the cap on ${template.id}, whatever the richness`, { timeout: 20_000 }, () => {
      for (const cap of [1, 3, 5, 8]) {
        for (const richness of [0.2, 0.5, 1]) {
          for (const seed of SEEDS.slice(0, 8)) {
            expect(peakOf(planComposition({ seed, template, richness, maxElevation: cap }))).toBeLessThanOrEqual(cap);
          }
        }
      }
    });
  }

  it('carries mass on every full-richness seed, the flat archetype included', () => {
    // Seed 7 draws the low-relief archetype, a broad gentle rise.
    for (const template of TEMPLATES) {
      for (const seed of SEEDS) {
        expect(peakOf(planComposition({ seed, template, richness: 1, maxElevation: ELEVATION_MAX })))
          .toBeGreaterThanOrEqual(4);
      }
    }
  });
});

describe('archetype variety', () => {
  it('varies archetype and mass direction over 20 seeds, and the batch check agrees', () => {
    for (const template of TEMPLATES) {
      const plans = SEEDS.map((seed) => planComposition({ seed, template, richness: 0.7 }));
      const archetypes = new Set(plans.map((p) => p.archetype));
      const axes = new Set(plans.map((p) => p.axis));
      expect(archetypes.size).toBeGreaterThanOrEqual(4);
      expect(axes.size).toBe(4);
      // The plan's axis is the direction its mass rises toward, as `sampleComposition` reads it off a
      // finished map.
      const batch: CompositionSample[] = plans.map((p) => ({ archetype: p.archetype, direction: p.axis }));
      const variety = compositionVariety(batch);
      expect(variety.applicable).toBe(true);
      expect(variety.pass).toBe(true);
    }
  });

  it('fails the same check on a batch that walls the same side every time', () => {
    const allNorth: CompositionSample[] = Array.from({ length: 20 }, () => ({
      archetype: 'north-wall', direction: 'north' as const,
    }));
    const variety = compositionVariety(allNorth);
    expect(variety.pass).toBe(false);
    expect(variety.directions).toBe(1);
    expect(variety.dominantDirectionShare).toBe(1);
  });

  it('draws flat compositions at low richness and dramatic ones at high', () => {
    const template = TEMPLATES[0]!;
    const quiet = SEEDS.map((seed) => planComposition({ seed, template, richness: 0.05 }));
    const rich = SEEDS.map((seed) => planComposition({ seed, template, richness: 1 }));
    const flat = (plans: CompositionPlan[]): number => plans.filter((p) => p.archetype === 'low-relief').length;
    expect(flat(quiet)).toBeGreaterThan(flat(rich));
    const peak = (plans: CompositionPlan[]): number =>
      plans.reduce((a, p) => a + Math.max(...p.plates.map((q) => q.tier)), 0) / plans.length;
    expect(peak(rich)).toBeGreaterThan(peak(quiet) + 2);
  });
});

describe('determinism', () => {
  it('plans the same map twice for the same seed, template and richness', () => {
    for (const template of TEMPLATES) {
      for (const seed of SEEDS.slice(0, 5)) {
        expect(digest(planComposition({ seed, template, richness: 0.6 })))
          .toBe(digest(planComposition({ seed, template, richness: 0.6 })));
      }
    }
  });

  it('plans a different map for a different seed', () => {
    const template = TEMPLATES[0]!;
    const digests = new Set(SEEDS.map((seed) => digest(planComposition({ seed, template, richness: 0.6 }))));
    expect(digests.size).toBe(SEEDS.length);
  });
});
