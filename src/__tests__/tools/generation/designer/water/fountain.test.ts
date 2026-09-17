// THE FOUNTAIN COURT: the grammar first, then what it puts on the ground.
//
// The GRAMMAR claims are the ones that make a court read as artificial rather than as a pond: a
// regular outline, bands that alternate wet and dry from the outside in, a figure the innermost water
// encloses, and mirror symmetry about both axes whatever the seed drew. They are read off the pure
// spec and cell functions.
//
// The GROUND claims are read off a synthetic flat terrace with a street beside it: the court stands
// on ONE tier, keeps its dry court, is composed against pavement, and commits through the LIVE rules
// with no violation — the figure is a mountain standing in water, and that is a claim about a
// finished map.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/model/grid-model';
import type { MacroCoord, MapTemplate } from '../../../../../core/model/types';
import { createDefaultRegistry } from '../../../../../rules';
import { applyPlanToScratch } from '../../../../../tools/generation/core/repair';
import type { TerrainPlan } from '../../../../../tools/generation/core/types';
import { paintableMask } from '../../../../../tools/generation/designer/composition/composition';
import {
  carveFountains, fountainCells, fountainSpec, outlineMetric,
  type FountainCourt, type FountainOutline, type FountainSpec,
} from '../../../../../tools/generation/designer/water/fountain';
import type { DesignPlan, RegionPlan } from '../../../../../tools/generation/designer/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const SEEDS = [12345, 777, 42, 2026, 7, 31337];
const OUTLINES: FountainOutline[] = ['square', 'octagon', 'ring', 'cross'];

/** A place at `rect` that asked for water, so `carveFountains` offers it a court. */
function waterRegion(id: string, rect: { x: number; y: number; w: number; h: number }): RegionPlan {
  return {
    id, kind: 'theme', themeId: 'garden', family: 'nature', anchors: [],
    size: { w: rect.w, h: rect.h }, tags: [], lot: [rect],
    entrySide: 'south', orientation: 'south', water: true,
  };
}

function plan(template: MapTemplate, regions: RegionPlan[]): DesignPlan {
  return {
    seedInfo: { seed: 0, richness: 1, templateId: template.id },
    plazaHub: { x: 80, y: 66, w: 8, h: 8 },
    backingBand: { x: 0, y: 0, w: 0, h: 0 },
    regions, unplaced: [],
  };
}

/** Flat map, one street running down the middle of it: the ground a court is composed on. */
function flatGround(template: MapTemplate): {
  t: TerrainPlan; grass: Uint8Array; flat: Uint8Array; paved: Uint8Array;
} {
  const W = template.width, H = template.height;
  const grass = paintableMask(template);
  const t: TerrainPlan = {
    width: W, height: H, tier: new Int8Array(W * H), water: new Int8Array(W * H).fill(-1),
  };
  const flat = new Uint8Array(W * H), paved = new Uint8Array(W * H);
  for (let y = 20; y < H - 20; y++) {
    for (let x = 78; x < 82; x++) {
      const i = flatIndex(x, y, W);
      if (!grass[i]) continue;
      paved[i] = 1;
      flat[i] = 1;
    }
  }
  return { t, grass, flat, paved };
}

function carve(seed: number, richness = 1): { courts: FountainCourt[]; t: TerrainPlan } {
  const { t, grass, flat, paved } = flatGround(HEXIA);
  const regions = [
    waterRegion('r-0', { x: 60, y: 40, w: 14, h: 14 }),
    waterRegion('r-1', { x: 95, y: 80, w: 14, h: 14 }),
    waterRegion('r-2', { x: 50, y: 95, w: 12, h: 12 }),
  ];
  const courts = carveFountains({
    t, grass, flat, paved, plan: plan(HEXIA, regions), richness, seed, ceiling: 8,
  });
  return { courts, t };
}

describe('the fountain grammar', () => {
  it('draws a regular outline: every cell at one distance from the centre is in one band', () => {
    for (const outline of OUTLINES) {
      for (let r = 2; r <= 7; r++) {
        // A level set of the metric is a closed ring: the four axis cells at distance r all exist.
        for (const [dx, dy] of [[r, 0], [-r, 0], [0, r], [0, -r]] as const) {
          expect(outlineMetric(outline, dx, dy), `${outline} r${r}`).toBe(r);
        }
      }
    }
  });

  it('nests wet and dry from the outside in, starting wet', () => {
    for (const seed of SEEDS) {
      for (let r = 2; r <= 7; r++) {
        const spec = fountainSpec(seed, 0, r);
        expect(spec.bands.length, `seed ${seed} r${r}`).toBeGreaterThan(0);
        expect(spec.bands[0]!.water, `seed ${seed} r${r} moat`).toBe(true);
        for (const [k, band] of spec.bands.entries()) {
          expect(band.water, `seed ${seed} r${r} band ${k}`).toBe(k % 2 === 0);
          expect(band.width).toBeGreaterThan(0);
        }
        // The bands cover the levels the FIGURE does not: it takes 0 to `figure` and they take the
        // rest out to the radius.
        expect(spec.bands.reduce((a, b) => a + b.width, 0)).toBe(r - spec.figure);
        // NO WATER BAND IS ONE LEVEL DEEP. A one-level ring of these metrics meets itself only at its
        // diagonals, so a 4-connected decomposition — which is what every reading downstream takes —
        // sees fragments rather than a moat.
        for (const band of spec.bands) if (band.water) expect(band.width, `seed ${seed} r${r}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('mirrors about both of its own axes, whatever the seed drew', () => {
    for (const seed of SEEDS) {
      const spec = fountainSpec(seed, 1, 6);
      const { water, figure } = fountainCells(spec, { x: 40, y: 40 });
      for (const set of [water, figure]) {
        const keys = new Set(set.map((c) => `${c.x},${c.y}`));
        for (const c of set) {
          expect(keys.has(`${80 - c.x},${c.y}`), `seed ${seed} across x at ${c.x},${c.y}`).toBe(true);
          expect(keys.has(`${c.x},${80 - c.y}`), `seed ${seed} across y at ${c.x},${c.y}`).toBe(true);
        }
      }
    }
  });

  it('stands a centre figure at every nesting depth, and the water encloses it', () => {
    // THE FIGURE IS THE INNERMOST THING, so a nesting of even depth stands it on its platform rather
    // than coming back with nothing in the middle. What the water ledger asks of it is not that the
    // figure's own neighbours are wet but that the figure cannot reach the composition's edge without
    // crossing water: that is the hole test, and it is what makes the court read as a court.
    for (const seed of SEEDS) {
      for (let r = 2; r <= 7; r++) {
        const spec = fountainSpec(seed, 2, r);
        const { water, figure } = fountainCells(spec, { x: 40, y: 40 });
        expect(figure.length, `seed ${seed} r${r} has a figure`).toBeGreaterThan(0);
        const wet = new Set(water.map((c) => `${c.x},${c.y}`));
        const seen = new Set(figure.map((c) => `${c.x},${c.y}`));
        const stack = [...seen];
        while (stack.length) {
          const [x, y] = stack.pop()!.split(',').map(Number) as [number, number];
          expect(Math.max(Math.abs(x - 40), Math.abs(y - 40)),
            `seed ${seed} r${r}: the figure reaches ${x},${y} without crossing water`).toBeLessThan(r);
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
            const key = `${x + dx},${y + dy}`;
            if (wet.has(key) || seen.has(key)) continue;
            seen.add(key);
            stack.push(key);
          }
        }
      }
    }
  });

  it('draws the cross with arms: axial out to its span, cut back off the axes', () => {
    // What separates a cruciform basin from the other three: at the same distance from the centre, an
    // axial cell is inside the composition and a diagonal one is outside it.
    for (let r = 4; r <= 7; r++) {
      expect(outlineMetric('cross', r, 0), `axial r${r}`).toBe(r);
      expect(outlineMetric('cross', r, r), `diagonal r${r}`).toBeGreaterThan(r);
      const spec = { outline: 'cross' as const, radius: r, bands: [{ width: r + 1, water: true }], figure: -1 };
      const { water } = fountainCells(spec, { x: 40, y: 40 });
      const wet = new Set(water.map((c) => `${c.x},${c.y}`));
      expect(wet.has(`${40 + r},40`), `arm tip r${r}`).toBe(true);
      expect(wet.has(`${40 + r},${40 + r}`), `corner r${r}`).toBe(false);
    }
  });

  it('keeps every band of a cross 4-CONNECTED, so a reading can see the court (I5.3)', () => {
    // `waterBodies` decomposes 4-connected, so a band that skips a rung as it turns the corner between
    // two arms shatters into four annuli, each thinner than the accent floor — which leaves three of
    // the eighteen gate maps carrying a large court INVISIBLE to `isCourt`, to the
    // one-main-fountain rule and to the arrival reading. The flare is what governs it.
    for (let r = 5; r <= 9; r++) {
      for (const seed of SEEDS) {
        const spec = fountainSpec(seed, 4, r);
        const cross = { ...spec, outline: 'cross' as const };
        const { water } = fountainCells(cross, { x: 40, y: 40 });
        if (water.length === 0) continue;
        // ONE PIECE PER WATER BAND is the claim: a court of two moats is two bodies by design, and the
        // failure mode is each of them falling into the four arcs between the cross's arms.
        const own = new Set(water.map((c) => `${c.x},${c.y}`));
        const seen = new Set<string>();
        let pieces = 0;
        for (const start of own) {
          if (seen.has(start)) continue;
          pieces++;
          const stack = [start];
          seen.add(start);
          while (stack.length) {
            const [x, y] = stack.pop()!.split(',').map(Number) as [number, number];
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
              const key = `${x + dx},${y + dy}`;
              if (!own.has(key) || seen.has(key)) continue;
              seen.add(key);
              stack.push(key);
            }
          }
        }
        const bands = cross.bands.filter((b) => b.water).length;
        expect(pieces, `cross r${r} seed ${seed}: ${water.length} water cells in ${pieces} pieces`)
          .toBeLessThanOrEqual(bands);
      }
    }
  });

  it('varies the instance with the seed: not one layout drawn again and again', () => {
    const drawn = new Set<string>();
    for (const seed of [...SEEDS, 90210, 1024, 4242, 8675309]) {
      const spec = fountainSpec(seed, 0, 6);
      drawn.add(`${spec.outline}/${spec.bands.map((b) => `${b.width}${b.water ? 'w' : 'd'}`).join('-')}`);
    }
    expect(drawn.size).toBeGreaterThan(2);
  });
});

describe('the courts on the ground', () => {
  it('stands one court per place that asked, and at most one large one', () => {
    for (const seed of SEEDS) {
      const { courts } = carve(seed);
      expect(courts.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(courts.filter((c) => c.size === 'large').length, `seed ${seed} large`).toBeLessThanOrEqual(1);
      const byRegion = courts.filter((c) => c.regionId !== '').map((c) => c.regionId);
      expect(new Set(byRegion).size, `seed ${seed} one per region`).toBe(byRegion.length);
    }
  });

  it('is composed against pavement a visitor can walk to', () => {
    const { paved } = flatGround(HEXIA);
    for (const seed of SEEDS) {
      const { courts } = carve(seed);
      for (const court of courts) {
        expect(paved[flatIndex(court.arrival.x, court.arrival.y, HEXIA.width)],
          `seed ${seed} ${court.regionId}`).toBe(1);
      }
    }
  });

  it('keeps a dry court around the water and stands the whole of it on one tier', () => {
    for (const seed of SEEDS) {
      const { courts, t } = carve(seed);
      for (const court of courts) {
        const wet = new Set(court.water.map((c) => `${c.x},${c.y}`));
        const raised = new Set(court.figure.map((c) => `${c.x},${c.y}`));
        for (let y = court.rect.y; y < court.rect.y + court.rect.h; y++) {
          for (let x = court.rect.x; x < court.rect.x + court.rect.w; x++) {
            const i = flatIndex(x, y, t.width);
            const key = `${x},${y}`;
            if (wet.has(key)) expect(t.water[i], key).toBe(court.tier);
            else if (raised.has(key)) expect(t.tier[i], key).toBe(court.tier + 1);
            else expect(t.tier[i], `${key} court`).toBe(court.tier);
          }
        }
      }
    }
  });

  it('borders the water with a dry frame the pipeline can pave', () => {
    for (const seed of SEEDS) {
      const { courts, t } = carve(seed);
      for (const court of courts) {
        expect(court.frame.length, `seed ${seed} ${court.regionId}`).toBeGreaterThan(0);
        const wet = new Set(court.water.map((c) => `${c.x},${c.y}`));
        const raised = new Set(court.figure.map((c) => `${c.x},${c.y}`));
        for (const c of court.frame) {
          const key = `${c.x},${c.y}`;
          expect(wet.has(key), `${key} is water`).toBe(false);
          expect(raised.has(key), `${key} is the figure`).toBe(false);
          expect(c.x >= court.rect.x && c.x < court.rect.x + court.rect.w
            && c.y >= court.rect.y && c.y < court.rect.y + court.rect.h, `${key} inside the court`).toBe(true);
          expect(t.tier[flatIndex(c.x, c.y, t.width)], `${key} tier`).toBe(court.tier);
        }
        // A BORDER, not a scatter: the band is one piece, so paving it draws a ring rather than
        // dropping pavement at four corners of the composition.
        expect(arcCount(court.frame), `seed ${seed} ${court.regionId} frame pieces`).toBe(1);
      }
    }
  });

  it('offers the large court to a place where the plaza cannot stand it, and not to every planet', () => {
    // TWO CLAIMS. With the plaza's own ground taken the court moves to a PLACE rather than the planet
    // losing it — and a planet is OFFERED a large court only on a seeded roll, because a form met on
    // every map reads as predefined however well it is composed. So the claim is that the offer lands
    // wherever it is made, not that it is made every time.
    let offered = 0;
    for (const seed of SEEDS) {
      const { t, grass, flat, paved } = flatGround(HEXIA);
      for (let y = 20; y < 105; y++) {
        for (let x = 45; x < 120; x++) flat[flatIndex(x, y, HEXIA.width)] = 1;
      }
      // A street beside the far place, so the court there has something to be composed against.
      for (let y = 106; y < 130; y++) {
        const i = flatIndex(44, y, HEXIA.width);
        if (grass[i]) { paved[i] = 1; flat[i] = 1; }
      }
      const courts = carveFountains({
        t, grass, flat, paved,
        plan: plan(HEXIA, [waterRegion('far', { x: 22, y: 110, w: 20, h: 18 })]),
        richness: 1, seed, ceiling: 8,
      });
      const large = courts.filter((c) => c.size === 'large').length;
      expect(large, `seed ${seed}`).toBeLessThanOrEqual(1);
      offered += large;
    }
    // Measured over the sixty-run gate: 50% to 70% of full-richness seeds carry one, and the roll is
    // deliberately higher at the quiet end, where a court is the only thing on a garden town built to
    // be arrived at.
    expect(offered, `${offered} of ${SEEDS.length} seeds stood one`).toBeGreaterThan(0);
    expect(offered, `${offered} of ${SEEDS.length} seeds stood one`).toBeLessThan(SEEDS.length);
  });

  it('commits with no violation', () => {
    const reg = createDefaultRegistry();
    for (const seed of SEEDS) {
      const { t } = carve(seed);
      const violations = reg.validatePostStroke(applyPlanToScratch(t, HEXIA));
      expect(violations.map((v) => `${v.ruleId}@${v.cells?.[0]?.x},${v.cells?.[0]?.y}`),
        `seed ${seed}`).toEqual([]);
    }
  });

  it('is deterministic per seed', () => {
    for (const seed of [12345, 42]) {
      expect(cellKeys(carve(seed).courts)).toEqual(cellKeys(carve(seed).courts));
    }
  });

  it('never draws fewer courts at full richness than at the quiet end', () => {
    let quiet = 0, rich = 0;
    for (const seed of SEEDS) {
      quiet += carve(seed, 0.2).courts.length;
      rich += carve(seed, 1).courts.length;
    }
    // The budget rises with richness, but three places asked for water here and the spacing rule
    // holds the count down before the budget does: what richness may never do is take a court away.
    expect(rich, `${rich} at full richness against ${quiet} at the quiet end`)
      .toBeGreaterThanOrEqual(quiet);
    expect(rich).toBeGreaterThan(0);
  });
});

function cellKeys(courts: readonly { water: MacroCoord[]; figure: MacroCoord[] }[]): string[] {
  return courts.flatMap((c) => [...c.water, ...c.figure].map((p) => `${p.x},${p.y}`));
}

/** How many 4-connected pieces a set of cells falls into. */
function arcCount(cells: readonly MacroCoord[]): number {
  const own = new Set(cells.map((c) => `${c.x},${c.y}`));
  const seen = new Set<string>();
  let pieces = 0;
  for (const start of own) {
    if (seen.has(start)) continue;
    pieces++;
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const [x, y] = stack.pop()!.split(',').map(Number) as [number, number];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const key = `${x + dx},${y + dy}`;
        if (!own.has(key) || seen.has(key)) continue;
        seen.add(key);
        stack.push(key);
      }
    }
  }
  return pieces;
}

describe('the spec a caller reads', () => {
  it('never asks for more water than its own span', () => {
    for (const seed of SEEDS) {
      for (let r = 2; r <= 7; r++) {
        const spec: FountainSpec = fountainSpec(seed, 3, r);
        const { water, figure, dry } = fountainCells(spec, { x: 50, y: 50 });
        const total = water.length + figure.length + dry.length;
        expect(total).toBeLessThanOrEqual((2 * r + 1) * (2 * r + 1));
        expect(water.length).toBeGreaterThan(0);
      }
    }
  });
});
