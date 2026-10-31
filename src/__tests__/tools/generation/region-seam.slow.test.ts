/**
 * A region run over ground the outside leans on: a mountain's 3x3 base or an elevated pond's cap can
 * stand inside the region, and clearing it would leave the outside illegal and revert the whole run.
 * `terrain-plan/seam.ts` gives that ground back before the commit, so the run lands while the map
 * around it stays untouched and legal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { getCell } from '../../../core/model/grid-model';
import { templateLandmarkObjects } from '../../../core/model/landmarks';
import { isBuildableZone } from '../../../core/game/zones';
import { createGridState } from '../../../core/model/template';
import { TerrainType } from '../../../core/model/types';
import type { GridState, MacroCoord, MapTemplate, PlacedObject } from '../../../core/model/types';
import { defaultConfig, type GenerateConfig, type Stencil } from '../../../tools/generation/recipe';
import { __resetCandidateCache, generateCandidate } from '../../../tools/generation/run/candidates';
import { clearGenerated, generateMap } from '../../../editor/operations/generate';
import { readRegionBase, repairRegionSeam } from '../../../tools/generation/terrain-plan';
import { clearAllTerrain } from '../../../tools/generation';
import type { EditContext } from '../../../core/commands/edit-context';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';

function realState(): GridState {
  const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
  const objects = new Map<string, PlacedObject>();
  const plaza = (templateLandmarkObjects(template)[0] ?? null);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells: createGridState(template).cells, objects, objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

function ctxOf(state: GridState): EditContext {
  const executor = makeExecutor(state);
  return { state, executor, registry: executor.getRegistry() };
}

/** A map-sized picture of diagonal tone bands, so the colour read puts a range of tiers, tall mass
 *  included, on both sides of any region boundary. */
function bandStencil(w: number, h: number): Stencil {
  const coverage = new Uint8Array(w * h).fill(255);
  const color = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.floor((((x * 0.7 + y * 0.3) / 6) % 8)) * 32;
      color[y * w + x] = (v << 16) | (v << 8) | v;
    }
  }
  return { width: w, height: h, coverage, color };
}

function pictureRecipe(state: GridState): GenerateConfig {
  const { width, height } = state.template;
  return defaultConfig('stencil', { maxElevation: 8, seed: 1, stencilPlan: {
      read: 'color', origin: { x: 0, y: 0 }, stencil: bandStencil(width, height), water: 'none',
    } });
}

/** The buildable cells of a square centred on (cx, cy). */
function square(state: GridState, cx: number, cy: number, half: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let y = cy - half; y <= cy + half; y++) for (let x = cx - half; x <= cx + half; x++) {
    const c = getCell(state.cells, x, y);
    if (c && isBuildableZone(c.zone)) out.push({ x, y });
  }
  return out;
}

/** Every cell's terrain as one string, over the cells a predicate picks. */
function terrainOf(state: GridState, pick: (x: number, y: number) => boolean): string {
  const parts: string[] = [];
  for (let y = 0; y < state.template.height; y++) {
    for (let x = 0; x < state.template.width; x++) {
      if (!pick(x, y)) continue;
      const t = getCell(state.cells, x, y)?.terrain;
      parts.push(t ? `${t.type}:${t.elevation}` : '-');
    }
  }
  return parts.join('|');
}

const centreRegion = (state: GridState, half: number): MacroCoord[] =>
  square(state, Math.floor(state.template.width / 2), Math.floor(state.template.height / 2), half);

describe('a region run over ground the outside leans on', () => {
  it('lands its planet instead of reverting, and leaves the map around it alone', async () => {
    __resetCandidateCache();
    const state = realState();
    const ctx = ctxOf(state);
    await generateMap(ctx, { config: pictureRecipe(state), region: null });

    const region = centreRegion(state, 14);
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const before = {
      in: terrainOf(state, (x, y) => inside.has(`${x},${y}`)),
      out: terrainOf(state, (x, y) => !inside.has(`${x},${y}`)),
    };

    const outcome = await generateMap(ctx, {
      config: defaultConfig('designed', { maxElevation: 8, richness: 0.7, seed: 42, region }),
      region,
    });

    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBeGreaterThan(0);
    expect(terrainOf(state, (x, y) => inside.has(`${x},${y}`))).not.toBe(before.in);
    expect(terrainOf(state, (x, y) => !inside.has(`${x},${y}`))).toBe(before.out);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
    expect(outcome.scopeEmpty).toBeUndefined();
  }, 240000);

  it('holds for a planet of the generator\'s own, water and all', async () => {
    __resetCandidateCache();
    const state = realState();
    const ctx = ctxOf(state);
    await generateMap(ctx, {
      config: defaultConfig('designed', { maxElevation: 8, richness: 1, seed: 7 }),
      region: null,
    });

    const region = centreRegion(state, 20);
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const beforeOut = terrainOf(state, (x, y) => !inside.has(`${x},${y}`));

    const outcome = await generateMap(ctx, {
      config: defaultConfig('designed', { maxElevation: 8, richness: 0.7, seed: 42, region }),
      region,
    });

    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBeGreaterThan(0);
    expect(terrainOf(state, (x, y) => !inside.has(`${x},${y}`))).toBe(beforeOut);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
  }, 240000);

  it('lands the same map whether the run is replayed from a candidate or built again', async () => {
    const recipe = (region: MacroCoord[]): GenerateConfig => defaultConfig('designed', { maxElevation: 8, richness: 0.7, seed: 42, region });

    const landed: string[] = [];
    for (const viaCandidate of [false, true]) {
      __resetCandidateCache();
      const state = realState();
      const ctx = ctxOf(state);
      await generateMap(ctx, { config: pictureRecipe(state), region: null });
      const region = centreRegion(state, 14);
      const candidate = viaCandidate
        ? await generateCandidate(ctx, { config: recipe(region), region })
        : null;
      const outcome = await generateMap(ctx, { config: recipe(region), region, candidate });
      expect(outcome.violations).toEqual([]);
      landed.push(terrainOf(state, () => true));
    }
    expect(landed[0]).toBe(landed[1]);
  }, 300000);

  it('takes a Clear back without the map outside its scope reverting it', async () => {
    __resetCandidateCache();
    const state = realState();
    const ctx = ctxOf(state);
    await generateMap(ctx, { config: pictureRecipe(state), region: null });

    const region = centreRegion(state, 14);
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const before = terrainOf(state, (x, y) => inside.has(`${x},${y}`));

    const outcome = clearGenerated(ctx, { region });
    expect(outcome.violations).toEqual([]);
    expect(outcome.removedCells).toBeGreaterThan(0);
    // What stands in the region is the seam the ground outside needs.
    expect(terrainOf(state, (x, y) => inside.has(`${x},${y}`))).not.toBe(before);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
  }, 240000);
});

/**
 * A scoped run that builds nothing says why: `'reclaimed'` when the seam claimed the whole region
 * for the ground around it (reported to the user), `'empty'` when the design put nothing on free
 * ground. The classification is the seam's, so the picture recipe stands in for any generator.
 */
describe('what a region run reports when it built nothing', () => {
  /** A legal plateau: a tier-8 core in rings at 5 and 2, the steepest V-MTN-03 allows (a cell at N
   *  wants its 3x3 at N-3). */
  function plateau(state: GridState, x1: number, y1: number, x2: number, y2: number): void {
    for (const [pad, tier] of [[2, 2], [1, 5], [0, 8]] as const) {
      for (let y = y1 - pad; y <= y2 + pad; y++) {
        for (let x = x1 - pad; x <= x2 + pad; x++) setTerrain(state, x, y, TerrainType.Mountain, tier);
      }
    }
  }

  /** A picture over exactly the given square, every cell covered (or none of them). */
  function picture(region: MacroCoord[], covered: boolean): GenerateConfig {
    const xs = region.map((c) => c.x), ys = region.map((c) => c.y);
    const origin = { x: Math.min(...xs), y: Math.min(...ys) };
    const w = Math.max(...xs) - origin.x + 1, h = Math.max(...ys) - origin.y + 1;
    return defaultConfig('stencil', { maxElevation: 8, seed: 3, region, stencilPlan: {
        read: 'color', origin, water: 'none',
        stencil: {
          width: w, height: h,
          coverage: new Uint8Array(w * h).fill(covered ? 255 : 0),
          color: new Uint32Array(w * h).fill(0x404040),
        },
      } });
  }

  it('names the ground when the region was owed to the terrain around it', async () => {
    __resetCandidateCache();
    const state = makeState(30, 30);
    plateau(state, 8, 8, 21, 21);
    const ctx = ctxOf(state);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);

    const region = square(state, 15, 15, 2);   // deep inside the massif, all four sides leaning in
    const outcome = await generateMap(ctx, { config: picture(region, true), region });

    expect(outcome.scopeEmpty).toBe('reclaimed');
    expect(outcome.violations).toEqual([]);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);

    // The same recipe on ground nothing leans on builds and reports nothing.
    __resetCandidateCache();
    const free = makeState(30, 30);
    const freeCtx = ctxOf(free);
    const built = await generateMap(freeCtx, { config: picture(region, true), region });
    expect(built.placed).toBeGreaterThan(0);
    expect(built.scopeEmpty).toBeUndefined();
  }, 60000);

  it('ties the notice to what stands, on a real planet run inside a massif', async () => {
    // What the designed run builds here may change; the notice must stay silent while anything of the
    // run stands in the region and read 'reclaimed' when nothing does.
    __resetCandidateCache();
    const state = realState();
    const ctx = ctxOf(state);
    const at = { x: 0, y: 0 };
    for (let y = 0; y + 25 < state.template.height; y++) {
      const row = square(state, at.x, y + 12, 12);
      if (row.length === 25 * 25) { at.x = 0; at.y = y + 12; break; }
      for (let x = 12; x + 13 < state.template.width; x++) {
        if (square(state, x, y + 12, 12).length === 25 * 25) { at.x = x; at.y = y + 12; break; }
      }
      if (at.x > 0) break;
    }
    expect(at.x).toBeGreaterThan(0);
    for (const [half, tier] of [[12, 2], [10, 5], [8, 8]] as const) {
      for (const c of square(state, at.x, at.y, half)) setTerrain(state, c.x, c.y, TerrainType.Mountain, tier);
    }
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);

    const region = square(state, at.x, at.y, 2);
    const was = new Map(region.map((c) => {
      const t = getCell(state.cells, c.x, c.y)?.terrain;
      return [`${c.x},${c.y}`, t ? `${t.type}:${t.elevation}` : '-'] as const;
    }));
    // An elevation cap below what the plateau's top needs, so the outside claims the whole region.
    const outcome = await generateMap(ctx, {
      config: defaultConfig('designed', { maxElevation: 4, richness: 0.7, seed: 42, region }),
      region,
    });
    expect(outcome.violations).toEqual([]);

    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const stands = region.some((c) => {
      const t = getCell(state.cells, c.x, c.y)?.terrain;
      const [type, tier] = (was.get(`${c.x},${c.y}`) ?? '-').split(':');
      return !!t && (t.elevation > Number(tier ?? 0) || `${t.type}` !== type);
    }) || [...state.objects.values()].some((o) => inside.has(`${o.position.x},${o.position.y}`));

    expect(outcome.scopeEmpty === undefined).toBe(stands);
    if (!stands) expect(outcome.scopeEmpty).toBe('reclaimed');
  }, 120000);

  it('reads a region the run was free to build in and did not as the quiet case', async () => {
    __resetCandidateCache();
    const state = makeState(30, 30);
    const ctx = ctxOf(state);

    const region = square(state, 15, 15, 2);   // flat ground, nothing around it leaning in
    const outcome = await generateMap(ctx, { config: picture(region, false), region });

    expect(outcome.scopeEmpty).toBe('empty');
    expect(outcome.placed).toBe(0);
  }, 60000);
});

describe('repairRegionSeam', () => {
  const reg = createDefaultRegistry();

  /** Erases the terrain in scope, as a run's clearing does. */
  function clearRegion(state: GridState, region: MacroCoord[]): void {
    const exec = makeExecutor(state, reg);
    clearAllTerrain({ state, execute: (cmd) => exec.execute(cmd) }, { region });
  }

  function executorOf(state: GridState): CommandExecutor {
    return makeExecutor(state, reg);
  }

  it('gives back the 3x3 base of a mountain standing just outside the region', () => {
    // A tier-6 cell at (10,10) on a tier-3 plateau; its base reaches into the region (x >= 11).
    const state = makeState(20, 20);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 3);
    setTerrain(state, 10, 10, TerrainType.Mountain, 6);
    expect(reg.validatePostStroke(state)).toEqual([]);

    const region: MacroCoord[] = [];
    for (let y = 0; y < 20; y++) for (let x = 11; x < 20; x++) region.push({ x, y });
    const base = readRegionBase(state, region);
    clearRegion(state, region);
    expect(reg.validatePostStroke(state).map((v) => v.ruleId)).toContain('V-MTN-03');

    const out = repairRegionSeam({ state, execute: (c) => executorOf(state).execute(c), reg }, base);
    expect(out.violations).toEqual([]);
    // The base cells inside the region came back, and nothing beyond the 3x3.
    for (const [x, y] of [[11, 9], [11, 10], [11, 11]]) {
      expect(getCell(state.cells, x!, y!)?.terrain?.elevation, `${x},${y}`).toBe(3);
    }
    expect(getCell(state.cells, 12, 10)?.terrain).toBeNull();
    expect(out.restored).toBeLessThanOrEqual(6);
  });

  it('gives back the cap an elevated channel outside the region stands behind', () => {
    // Tier-2 water running east across a tier-2 plateau, ground north of it one tier lower: facing that
    // drop, the channel needs a tier-2 mountain cap at each end. The region covers the east cap.
    const state = makeState(20, 20);
    for (let y = 7; y <= 12; y++) for (let x = 6; x <= 13; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    for (let x = 6; x <= 13; x++) setTerrain(state, x, 8, TerrainType.Mountain, 1);
    for (let x = 8; x <= 11; x++) setTerrain(state, x, 9, TerrainType.Water, 2);
    expect(reg.validatePostStroke(state)).toEqual([]);

    const region: MacroCoord[] = [];
    for (let y = 0; y < 20; y++) for (let x = 11; x < 20; x++) region.push({ x, y });
    const base = readRegionBase(state, region);
    clearRegion(state, region);
    expect(reg.validatePostStroke(state).map((v) => v.ruleId)).toContain('V-WTR-02');

    const out = repairRegionSeam({ state, execute: (c) => executorOf(state).execute(c), reg }, base);
    expect(out.violations).toEqual([]);
    expect(getCell(state.cells, 11, 9)?.terrain).toMatchObject({ type: TerrainType.Water, elevation: 2 });
    expect(getCell(state.cells, 12, 9)?.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('edits nothing outside the region, even when the region has nothing to give', () => {
    // A tier-8 block outside the region is illegal on its own and nothing inside can support it.
    const state = makeState(20, 20);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) setTerrain(state, x, y, TerrainType.Mountain, 8);
    const outsideBefore = terrainOf(state, (x) => x < 10);

    const region: MacroCoord[] = [];
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) region.push({ x, y });
    const base = readRegionBase(state, region);
    const out = repairRegionSeam({ state, execute: (c) => executorOf(state).execute(c), reg }, base);

    expect(out.violations.length).toBeGreaterThan(0);
    expect(terrainOf(state, (x) => x < 10)).toBe(outsideBefore);
  });

  it('does nothing at all to a map that is already legal', () => {
    const state = makeState(20, 20);
    for (let y = 8; y <= 12; y++) for (let x = 8; x <= 12; x++) setTerrain(state, x, y, TerrainType.Mountain, 2);
    const region: MacroCoord[] = [];
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) region.push({ x, y });
    const base = readRegionBase(state, region);
    const before = terrainOf(state, () => true);

    const out = repairRegionSeam({ state, execute: (c) => executorOf(state).execute(c), reg }, base);
    expect(out).toMatchObject({ restored: 0, lowered: 0, passes: 0, violations: [] });
    expect(terrainOf(state, () => true)).toBe(before);
  });
});
