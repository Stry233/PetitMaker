// THE LARGE COMPOSED BODIES, read as shapes and then as cut ground.
//
// The SHAPE claims are what the water ledger's reading rests on, so they are asserted directly off
// the draw: every form mirrors about both axes of its own box, none of them fills it the way a
// dropped rectangle does, and each one carries the dry ground its own accounting class is defined by
// — two or more enclosed islets for a basin and a medallion, one platform for a ring, a 3:1-or-thinner
// profile for a trough. A figure that lost those would pass through the ledger as water belonging to
// no story.
//
// The CUT claims are read on a synthetic flat map: the figures land, they are few and large, no two
// of them are congruent, and the ground commits through the live rules with no violation.
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/model/grid-model';
import type { MacroCoord, MapTemplate, Rect } from '../../../../../core/model/types';
import { createDefaultRegistry } from '../../../../../rules';
import { applyPlanToScratch } from '../../../../../tools/generation/core/repair';
import type { TerrainPlan } from '../../../../../tools/generation/core/types';
import { paintableMask } from '../../../../../tools/generation/designer/composition/composition';
import {
  cutComposedBodies, fitForm, formCells, type ComposedBody, type WaterForm,
} from '../../../../../tools/generation/designer/water/water-forms';
import type { DesignPlan } from '../../../../../tools/generation/designer/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const SEEDS = [12345, 777, 42, 2026, 7, 31337];
const FORMS: WaterForm[] = ['basin', 'ring', 'medallion', 'trough'];

/** How many dry components the figure encloses: ground inside its bounding box that cannot reach the
 *  box border without crossing the body. The water ledger's own hole test, re-implemented here so
 *  the shape claim is checked against the same definition the grader uses. */
function holesOf(cells: readonly MacroCoord[], box: Rect): number {
  const inBody = new Set(cells.map((c) => `${c.x},${c.y}`));
  const seen = new Set<string>();
  const outside = new Set<string>();
  const push = (queue: string[], x: number, y: number): void => {
    const k = `${x},${y}`;
    if (x < box.x || y < box.y || x >= box.x + box.w || y >= box.y + box.h) return;
    if (inBody.has(k) || seen.has(k)) return;
    seen.add(k); queue.push(k);
  };
  const border: string[] = [];
  for (let x = box.x; x < box.x + box.w; x++) { push(border, x, box.y); push(border, x, box.y + box.h - 1); }
  for (let y = box.y; y < box.y + box.h; y++) { push(border, box.x, y); push(border, box.x + box.w - 1, y); }
  for (let head = 0; head < border.length; head++) {
    const [x, y] = border[head]!.split(',').map(Number) as [number, number];
    outside.add(border[head]!);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) push(border, x + dx, y + dy);
  }
  let holes = 0;
  const done = new Set<string>();
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) {
      const k = `${x},${y}`;
      if (inBody.has(k) || outside.has(k) || done.has(k)) continue;
      holes++;
      const stack = [k];
      done.add(k);
      while (stack.length) {
        const [px, py] = stack.pop()!.split(',').map(Number) as [number, number];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nk = `${px + dx},${py + dy}`;
          if (done.has(nk) || inBody.has(nk) || outside.has(nk)) continue;
          if (px + dx < box.x || py + dy < box.y || px + dx >= box.x + box.w || py + dy >= box.y + box.h) continue;
          done.add(nk); stack.push(nk);
        }
      }
    }
  }
  return holes;
}

const boxOf = (cells: readonly MacroCoord[]): Rect => {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of cells) {
    x0 = Math.min(x0, c.x); y0 = Math.min(y0, c.y); x1 = Math.max(x1, c.x); y1 = Math.max(y1, c.y);
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

/** A room every form can be drawn in: long past `SPAN.min` and wide enough for the medallion's three
 *  bands, which is the widest ask in the vocabulary. */
const ROOM = { x: 50, y: 50, w: 27, h: 21 };

/** A flat map at one tier: the ground a still figure is cut into. Tier 1 rather than 0, so the
 *  figure is a body on a terrace and the cut has to hold its own rim up. */
function flatIsland(template: MapTemplate, tier = 1): {
  t: TerrainPlan; grass: Uint8Array; flat: Uint8Array;
} {
  const W = template.width, H = template.height;
  const grass = paintableMask(template);
  const t: TerrainPlan = { width: W, height: H, tier: new Int8Array(W * H), water: new Int8Array(W * H).fill(-1) };
  for (let i = 0; i < grass.length; i++) if (grass[i]) t.tier[i] = tier;
  return { t, grass, flat: new Uint8Array(W * H) };
}

function emptyPlan(template: MapTemplate): DesignPlan {
  return {
    seedInfo: { seed: 0, richness: 1, templateId: template.id },
    plazaHub: { x: 0, y: 0, w: 0, h: 0 },
    backingBand: { x: 0, y: 0, w: 0, h: 0 },
    regions: [], unplaced: [],
  };
}

function cut(seed: number, richness = 1, budget = 2000): {
  bodies: ComposedBody[]; t: TerrainPlan;
} {
  const { t, grass, flat } = flatIsland(HEXIA);
  const hub = { x: Math.round(HEXIA.width / 2), y: Math.round(HEXIA.height / 2) };
  const bodies = cutComposedBodies({
    t, grass, flat, plan: emptyPlan(HEXIA), hub, richness, seed, budget,
  });
  return { bodies, t };
}

describe('the shape vocabulary', () => {
  it('draws every form symmetric about both axes of its own box', () => {
    for (const form of FORMS) {
      for (const seed of [1, 2, 3]) {
        const rect = fitForm(form, ROOM)!;
        const cells = formCells(form, rect, seed);
        const box = boxOf(cells);
        const set = new Set(cells.map((c) => `${c.x},${c.y}`));
        for (const c of cells) {
          const mx = box.x * 2 + box.w - 1 - c.x, my = box.y * 2 + box.h - 1 - c.y;
          expect(set.has(`${mx},${c.y}`), `${form}/${seed} mirrors ${c.x},${c.y} across x`).toBe(true);
          expect(set.has(`${c.x},${my}`), `${form}/${seed} mirrors ${c.x},${c.y} across y`).toBe(true);
        }
      }
    }
  });

  it('accounts for itself: islets for the round forms, a thin profile for the trough', () => {
    for (const seed of [1, 2, 3, 4]) {
      for (const form of FORMS) {
        const cells = formCells(form, fitForm(form, ROOM)!, seed);
        const box = boxOf(cells);
        const holes = holesOf(cells, box);
        if (form === 'trough') {
          const long = Math.max(box.w, box.h);
          expect(long, `${form}/${seed}`).toBeGreaterThanOrEqual(10);
          // The ledger reads a body as a course when it is this thin: cells over its own length.
          expect(cells.length / long, `${form}/${seed}`).toBeLessThanOrEqual(3.5);
          continue;
        }
        expect(holes, `${form}/${seed} encloses dry ground`).toBeGreaterThanOrEqual(1);
        if (form !== 'ring') expect(holes, `${form}/${seed}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it('never fills its own box the way a dropped rectangle does', () => {
    for (const form of FORMS) {
      if (form === 'trough') continue;
      const cells = formCells(form, fitForm(form, ROOM)!, 5);
      const box = boxOf(cells);
      expect(cells.length / (box.w * box.h), form).toBeLessThan(0.85);
    }
  });

  it('draws a figure of a few hundred cells, not an accent', () => {
    for (const form of FORMS) {
      const cells = formCells(form, fitForm(form, ROOM)!, 5);
      expect(cells.length, form).toBeGreaterThanOrEqual(60);
    }
  });
});

describe('the figures, cut into a terrace', () => {
  it('lands a few large bodies on every seed', () => {
    for (const seed of SEEDS) {
      const { bodies } = cut(seed);
      expect(bodies.length, `seed ${seed}`).toBeGreaterThanOrEqual(3);
      for (const body of bodies) {
        expect(body.cells.length, `seed ${seed} ${body.form}`).toBeGreaterThanOrEqual(60);
        expect(Math.max(body.rect.w, body.rect.h), `seed ${seed} ${body.form}`).toBeGreaterThanOrEqual(19);
      }
    }
  });

  it('repeats no shape: two figures of one form are drawn at different spans', () => {
    for (const seed of SEEDS) {
      const shapes = cut(seed).bodies.map((b) => `${b.form} ${b.rect.w}x${b.rect.h}`);
      expect(new Set(shapes).size, `seed ${seed}: ${shapes.join(', ')}`).toBe(shapes.length);
    }
  });

  it('commits with no violation: a figure shows no face on its own terrace', () => {
    const reg = createDefaultRegistry();
    for (const seed of SEEDS) {
      const { bodies, t } = cut(seed);
      expect(bodies.length, `seed ${seed}`).toBeGreaterThan(0);
      const violations = reg.validatePostStroke(applyPlanToScratch(t, HEXIA));
      expect(violations.map((v) => `${v.ruleId}@${v.cells?.[0]?.x},${v.cells?.[0]?.y}`).slice(0, 4),
        `seed ${seed}`).toEqual([]);
    }
  });

  it('spends no more than the budget it was given', () => {
    for (const budget of [200, 600, 1500]) {
      const { t, grass, flat } = flatIsland(HEXIA);
      const hub = { x: Math.round(HEXIA.width / 2), y: Math.round(HEXIA.height / 2) };
      const bodies = cutComposedBodies({
        t, grass, flat, plan: emptyPlan(HEXIA), hub, richness: 1, seed: 12345, budget,
      });
      const spent = bodies.reduce((a, b) => a + b.cells.length, 0);
      expect(spent, `budget ${budget}`).toBeLessThanOrEqual(budget);
    }
  });

  it('never floods a cell the ground kept for something else', () => {
    const { t, grass, flat } = flatIsland(HEXIA);
    for (let y = 40; y < 90; y += 3) {
      for (let x = 0; x < HEXIA.width; x++) flat[flatIndex(x, y, HEXIA.width)] = 1;
    }
    const before = [...flat];
    const bodies = cutComposedBodies({
      t, grass, flat, plan: emptyPlan(HEXIA), hub: { x: 84, y: 70 }, richness: 1, seed: 12345,
      budget: 2000,
    });
    for (const body of bodies) {
      for (const c of body.cells) expect(before[flatIndex(c.x, c.y, HEXIA.width)]).toBe(0);
    }
  });

  it('is deterministic per seed, and cuts fewer figures at the quiet end', () => {
    for (const seed of [12345, 42]) {
      const a = cut(seed), b = cut(seed);
      expect(a.bodies.map((x) => `${x.form}@${x.rect.x},${x.rect.y}`))
        .toEqual(b.bodies.map((x) => `${x.form}@${x.rect.x},${x.rect.y}`));
      expect(cut(seed, 0.2).bodies.length, `seed ${seed}`).toBeLessThanOrEqual(a.bodies.length);
    }
  });
});

describe('the figures set into the terrace', () => {
  // The reference's water is CUT INTO its terraces and framed by their edges (calibration §8.3, §8.5),
  // not floated in the middle of an open plate. `fitForm` centres its box in the room it was given, so
  // the pass pushes the box against whichever sides of that room a step RISES on — and only a rise,
  // since a body flush against lower ground shows a face nobody composed.
  it('lays a figure against the riser its room ends at, and never against a drop', () => {
    const { t, grass, flat } = flatIsland(HEXIA);
    const W = HEXIA.width;
    // A hill down the middle of the map: everything east of it stands a tier higher.
    for (let y = 0; y < HEXIA.height; y++) {
      for (let x = Math.round(W / 2); x < W; x++) if (grass[flatIndex(x, y, W)]) t.tier[flatIndex(x, y, W)] = 2;
    }
    const hub = { x: 20, y: Math.round(HEXIA.height / 2) };
    const bodies = cutComposedBodies({
      t, grass, flat, plan: emptyPlan(HEXIA), hub, richness: 1, seed: 4242, budget: 2000,
    });
    expect(bodies.length, 'the pass cut figures at all').toBeGreaterThan(0);
    let against = 0;
    for (const body of bodies) {
      for (const c of body.cells) {
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const i = flatIndex(c.x + dx, c.y + dy, W);
          const surface = t.water[i]! >= 0 ? t.water[i]! : t.tier[i]!;
          // NOTHING BELOW: a face is what the rules would ask for caps at, and no figure here shows one.
          expect(surface, `${body.form} at ${c.x},${c.y} faces lower ground`)
            .toBeGreaterThanOrEqual(body.tier);
          if (t.water[i]! < 0 && t.tier[i]! > body.tier) against++;
        }
      }
    }
    expect(against, 'at least one figure has the step for a rim').toBeGreaterThan(0);
  });
});
