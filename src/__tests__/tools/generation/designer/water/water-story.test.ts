// The water story: pond shapes read off the pure shape functions, and the course carved on a bare
// terraced staircase so its source, bends, widths and falls can be checked without a designed map.
// Committing through the live rules is what proves the falls (V-WTR-02 caps, V-WTR-03 landings).
import { describe, it, expect } from 'vitest';
import { MAP_TEMPLATES } from '../../../../../config/maps';
import { flatIndex } from '../../../../../core/grid/rect';
import { TerrainType, type MacroCoord, type MapTemplate } from '../../../../../core/model/types';
import { createDefaultRegistry } from '../../../../../rules';
import { applyPlanToScratch } from '../../../../../tools/generation/terrain-plan/repair';
import type { TerrainPlan } from '../../../../../tools/generation/terrain-plan/types';
import { paintableMask } from '../../../../../tools/generation/designer/planet';
import { carveWaterStory } from '../../../../../tools/generation/designer/water/water-story';
import { pondCells } from '../../../../../tools/generation/designer/water/story-model';
import type { PondShape, WaterStory } from '../../../../../tools/generation/designer/water/story-model';
import type { DesignPlan } from '../../../../../tools/generation/designer/types';

const HEXIA = MAP_TEMPLATES['hexia']!;
const SEEDS = [12345, 777, 42, 2026, 7, 31337];

/** A bare plan over the template: no places, so the course is judged on the ground alone. */
function emptyPlan(template: MapTemplate): DesignPlan {
  return {
    seedInfo: { seed: 0, richness: 1, templateId: template.id },
    hubArea: { x: 0, y: 0, w: 0, h: 0 },
    backingBand: { x: 0, y: 0, w: 0, h: 0 },
    regions: [], unplaced: [],
  };
}

/**
 * The buildable land terraced in bands from tier 3 down to 0 along y. It stops at 3 because
 * V-MTN-03 passes at and below layer 3; a layer-4 plateau running to the coast would fail it.
 */
function staircase(template: MapTemplate): { t: TerrainPlan; grass: Uint8Array; flat: Uint8Array } {
  const W = template.width, H = template.height;
  const grass = paintableMask(template);
  const t: TerrainPlan = { width: W, height: H, tier: new Int8Array(W * H), water: new Int8Array(W * H).fill(-1) };
  for (let y = 0; y < H; y++) {
    const tier = Math.max(0, 3 - Math.floor(y / Math.max(1, Math.floor(H / 4))));
    for (let x = 0; x < W; x++) {
      const i = flatIndex(x, y, W);
      if (grass[i]) t.tier[i] = tier;
    }
  }
  return { t, grass, flat: new Uint8Array(W * H) };
}

function carve(seed: number, richness = 1): { story: WaterStory | null; t: TerrainPlan; grass: Uint8Array } {
  const { t, grass, flat } = staircase(HEXIA);
  const story = carveWaterStory({ t, grass, flat, plan: emptyPlan(HEXIA), richness, seed });
  return { story, t, grass };
}

/** The longest run of the spine that keeps one heading, in cells (a fall moves the head two cells
 *  at once) and how many times the heading changes. */
function spineShape(spine: readonly MacroCoord[]): { straight: number; bends: number } {
  let run = 0, longest = 0, bends = 0;
  let last: string | null = null;
  for (let k = 1; k < spine.length; k++) {
    const a = spine[k - 1]!, b = spine[k]!;
    const dx = b.x - a.x, dy = b.y - a.y;
    const step = `${Math.sign(dx)},${Math.sign(dy)}`;
    const cells = Math.max(Math.abs(dx), Math.abs(dy));
    if (step === last) run += cells; else { bends++; run = cells; }
    longest = Math.max(longest, run);
    last = step;
  }
  return { straight: longest, bends };
}

describe('the pond shapes', () => {
  const SHAPES: PondShape[] = ['lozenge', 'u-moat', 'islet', 'diamond'];

  it('draws every shape symmetric about both axes of its own box', () => {
    for (const shape of SHAPES) {
      for (const [w, h] of [[9, 7], [11, 11], [7, 5]] as const) {
        const rect = { x: 3, y: 4, w, h };
        const cells = new Set(pondCells(shape, rect).map((c) => `${c.x},${c.y}`));
        expect(cells.size, `${shape} ${w}x${h}`).toBeGreaterThan(0);
        for (const key of cells) {
          const [x, y] = key.split(',').map(Number) as [number, number];
          const mx = rect.x * 2 + rect.w - 1 - x;
          expect(cells.has(`${mx},${y}`), `${shape} ${w}x${h} mirrors ${key} across x`).toBe(true);
        }
      }
    }
  });

  it('leaves dry ground standing inside the islet pond and inside the U-moat', () => {
    for (const shape of ['islet', 'u-moat'] as const) {
      const rect = { x: 0, y: 0, w: 11, h: 9 };
      const cells = new Set(pondCells(shape, rect).map((c) => `${c.x},${c.y}`));
      expect(cells.has('5,4'), `${shape} centre`).toBe(false);
    }
  });

  it('keeps a lozenge off the corners of its box, so it is never a rectangle', () => {
    const rect = { x: 0, y: 0, w: 11, h: 9 };
    const cells = new Set(pondCells('lozenge', rect).map((c) => `${c.x},${c.y}`));
    for (const corner of ['0,0', '10,0', '0,8', '10,8']) {
      expect(cells.has(corner), corner).toBe(false);
    }
  });
});

describe('the course, on a staircase map', () => {
  it('runs from a source to an arrival on every seed', () => {
    for (const seed of SEEDS) {
      const { story } = carve(seed);
      expect(story, `seed ${seed}`).not.toBeNull();
      expect(story!.cells.length, `seed ${seed} cells`).toBeGreaterThan(20);
      expect(['pond', 'sea']).toContain(story!.ending);
      if (story!.ending === 'pond') expect(story!.pond, `seed ${seed} pond`).not.toBeNull();
    }
  });

  it('descends the staircase: the source stands above the arrival, and a fall carries it down', () => {
    for (const seed of SEEDS) {
      const { story } = carve(seed);
      const last = story!.reaches[story!.reaches.length - 1]!;
      expect(story!.source.tier, `seed ${seed}`).toBeGreaterThan(last.tier);
      expect(story!.falls.filter((f) => f.main).length, `seed ${seed} falls`).toBeGreaterThan(0);
      // Every fall lands below the tier it leaves.
      for (const fall of story!.falls) expect(fall.landsAt).toBeLessThan(fall.tier);
    }
  });

  it('bends, and never runs straight for longer than the bound it declares', () => {
    for (const seed of SEEDS) {
      const { story } = carve(seed);
      const { straight, bends } = spineShape(story!.spine);
      expect(straight, `seed ${seed} straight run`).toBeLessThanOrEqual(14);
      expect(bends, `seed ${seed} bends`).toBeGreaterThan(2);
    }
  });

  it('varies its width along the way', () => {
    for (const seed of SEEDS) {
      const { story } = carve(seed);
      const widths = new Set(story!.reaches.flatMap((r) => sectionWidths(r.cells)));
      expect(widths.size, `seed ${seed} widths ${[...widths].join(',')}`).toBeGreaterThan(1);
    }
  });

  it('commits with no violation: the falls are capped and their landings uniform', () => {
    const reg = createDefaultRegistry();
    for (const seed of SEEDS) {
      const { story, t } = carve(seed);
      expect(story, `seed ${seed}`).not.toBeNull();
      const violations = reg.validatePostStroke(applyPlanToScratch(t, HEXIA));
      expect(violations.map((v) => `${v.ruleId}@${v.cells?.[0]?.x},${v.cells?.[0]?.y}`).slice(0, 4),
        `seed ${seed}`).toEqual([]);
    }
  });

  it('lays one connected body: the pond is where the stream arrives, not a pool beside it', () => {
    for (const seed of SEEDS) {
      const { story, t } = carve(seed);
      const water = new Set<number>();
      for (let i = 0; i < t.water.length; i++) if (t.water[i]! >= 0) water.add(i);
      // Flood-fill from the source, 4-connected and elevation-blind, as a water body is read.
      const start = flatIndex(story!.source.at.x, story!.source.at.y, t.width);
      const seen = new Set([start]);
      const stack = [start];
      while (stack.length) {
        const p = stack.pop()!;
        const x = p % t.width, y = (p / t.width) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const j = flatIndex(x + dx, y + dy, t.width);
          if (!water.has(j) || seen.has(j)) continue;
          seen.add(j); stack.push(j);
        }
      }
      expect(seen.size / water.size, `seed ${seed}`).toBeGreaterThan(0.95);
    }
  });

  it('the water story is deterministic per seed', () => {
    for (const seed of [12345, 42]) {
      const a = carve(seed), b = carve(seed);
      expect(a.story!.cells).toEqual(b.story!.cells);
      expect([...a.t.water]).toEqual([...b.t.water]);
    }
  });

  it('runs longer at full richness than at the quiet end', () => {
    for (const seed of SEEDS) {
      const quiet = carve(seed, 0.2), rich = carve(seed, 1);
      if (!quiet.story || !rich.story) continue;
      expect(rich.story.cells.length, `seed ${seed}`).toBeGreaterThanOrEqual(quiet.story.cells.length);
    }
  });

  it('the course never floods a cell the ground kept for something else', () => {
    const { t, grass, flat } = staircase(HEXIA);
    // A reserved band across half the map, as a trunk street leaves.
    for (let y = Math.floor(HEXIA.height / 2); y < Math.floor(HEXIA.height / 2) + 3; y++) {
      for (let x = 0; x < Math.floor(HEXIA.width / 2); x++) flat[flatIndex(x, y, HEXIA.width)] = 1;
    }
    const story = carveWaterStory({ t, grass, flat, plan: emptyPlan(HEXIA), richness: 1, seed: 12345 });
    expect(story).not.toBeNull();
    for (const c of story!.cells) expect(flat[flatIndex(c.x, c.y, HEXIA.width)]).toBe(0);
    for (let i = 0; i < t.water.length; i++) {
      if (t.water[i]! >= 0) expect(flat[i], `cell ${i % HEXIA.width},${(i / HEXIA.width) | 0}`).toBe(0);
    }
  });
});

/** A reach's cell count in each row and each column; a stream of one width gives one value. */
function sectionWidths(cells: readonly MacroCoord[]): number[] {
  const rows = new Map<number, number>(), cols = new Map<number, number>();
  for (const c of cells) {
    rows.set(c.y, (rows.get(c.y) ?? 0) + 1);
    cols.set(c.x, (cols.get(c.x) ?? 0) + 1);
  }
  return [...rows.values(), ...cols.values()];
}

describe('the water the story leaves', () => {
  it('is water terrain at the tier the plan says, once committed', () => {
    const { t } = carve(12345);
    const state = applyPlanToScratch(t, HEXIA);
    for (let i = 0; i < t.water.length; i++) {
      const level = t.water[i]!;
      if (level < 0) continue;
      const cell = state.cells[(i / t.width) | 0]?.[i % t.width];
      if (!cell || cell.zone !== 2) continue;
      expect(cell.terrain?.type).toBe(TerrainType.Water);
      expect(cell.terrain?.elevation).toBe(level);
    }
  });
});
