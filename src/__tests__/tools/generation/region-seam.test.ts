/**
 * A RUN CONFINED TO A REGION, AND THE GROUND AROUND IT.
 *
 * The reported symptom: build a picture over the whole planet, paint a region across part of it,
 * generate into the region — and nothing happens, however many times it is pressed.
 *
 * The cause is at the SEAM. The terrain outside the region leans on the cells inside it: a mountain
 * one cell beyond the boundary at layer 6 wants a full 3x3 of mass at layer 3 under it, and some of
 * those nine cells are inside; an elevated pond is capped by mountain at exactly its own layer, and a
 * cap can be inside. The run's own clearing takes them, so the map is illegal at a cell the run never
 * touched — a POST-stroke violation, which unwinds the stroke until the state is clean, which means
 * unwinding the clearing itself. The whole run is handed back, and the map is exactly as it was.
 *
 * `core/seam.ts` settles that before the commit by giving the outside its ground back, so these tests
 * hold two things at once: the run LANDS (the region changed), and the map around it is untouched and
 * legal.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node)
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import {
  createGrid, createPlazaObject, getCell, isBuildableZone,
} from '../../../core/model/grid-model';
import { TerrainType } from '../../../core/model/types';
import type {
  EditorEvents, GenerateConfig, GridState, MacroCoord, MapTemplate, PlacedObject, Stencil,
} from '../../../core/model/types';
import { roadLookup } from '../../../state/object-index';
import { catalogLoadValue } from '../../../state/catalog';
import {
  __resetCandidateCache, clearGenerated, forgetGenerationScope, generateCandidate, generateMap,
} from '../../../kit/operations/generate';
import { readRegionBase, repairRegionSeam } from '../../../tools/generation/core';
import { clearAllTerrain } from '../../../tools/generation/terrain-generator';
import type { KitContext } from '../../../kit/context';
import { makeState, setTerrain } from '../../rules/_helpers';

function realState(): GridState {
  const template = JSON.parse(readFileSync('src/config/maps/hexia.json', 'utf8')) as MapTemplate;
  const objects = new Map<string, PlacedObject>();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells: createGrid(template), objects, lockedLayers: new Set() };
}

function ctxOf(state: GridState): KitContext {
  const executor = new CommandExecutor(
    state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state), catalogLoadValue,
  );
  return { state, executor, registry: executor.getRegistry() };
}

/** A picture the size of the map: diagonal bands of tone, so the colour read lands a range of tiers
 *  (which is what puts tall mass on both sides of any boundary a region is painted along). */
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
  return {
    algorithm: 'stencil', mode: 'mixed', maxElevation: 8, seed: 1, region: null,
    stencilPlan: {
      read: 'color', origin: { x: 0, y: 0 }, stencil: bandStencil(width, height), water: 'none',
    },
  } as unknown as GenerateConfig;
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
    forgetGenerationScope();
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
      config: {
        algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 0.7, seed: 42, region,
      } as GenerateConfig,
      region,
    });

    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBeGreaterThan(0);
    expect(terrainOf(state, (x, y) => inside.has(`${x},${y}`))).not.toBe(before.in);
    expect(terrainOf(state, (x, y) => !inside.has(`${x},${y}`))).toBe(before.out);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
    // A run that built its planet has nothing to explain.
    expect(outcome.scopeEmpty).toBeUndefined();
  }, 240000);

  it('holds for a planet of the generator\'s own, water and all', async () => {
    __resetCandidateCache();
    forgetGenerationScope();
    const state = realState();
    const ctx = ctxOf(state);
    await generateMap(ctx, {
      config: {
        algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 1, seed: 7, region: null,
      } as GenerateConfig,
      region: null,
    });

    const region = centreRegion(state, 20);
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const beforeOut = terrainOf(state, (x, y) => !inside.has(`${x},${y}`));

    const outcome = await generateMap(ctx, {
      config: {
        algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 0.7, seed: 42, region,
      } as GenerateConfig,
      region,
    });

    expect(outcome.violations).toEqual([]);
    expect(outcome.placed).toBeGreaterThan(0);
    expect(terrainOf(state, (x, y) => !inside.has(`${x},${y}`))).toBe(beforeOut);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
  }, 240000);

  it('lands the same map whether the run is replayed from a candidate or built again', async () => {
    const recipe = (region: MacroCoord[]): GenerateConfig => ({
      algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 0.7, seed: 42, region,
    } as GenerateConfig);

    const landed: string[] = [];
    for (const viaCandidate of [false, true]) {
      __resetCandidateCache();
      forgetGenerationScope();
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
    forgetGenerationScope();
    const state = realState();
    const ctx = ctxOf(state);
    await generateMap(ctx, { config: pictureRecipe(state), region: null });

    const region = centreRegion(state, 14);
    const inside = new Set(region.map((c) => `${c.x},${c.y}`));
    const before = terrainOf(state, (x, y) => inside.has(`${x},${y}`));

    const outcome = clearGenerated(ctx, { region });
    expect(outcome.violations).toEqual([]);
    expect(outcome.removedCells).toBeGreaterThan(0);
    // Most of the region is gone; what stands is the seam the ground outside needs.
    expect(terrainOf(state, (x, y) => inside.has(`${x},${y}`))).not.toBe(before);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);
  }, 240000);
});

/**
 * A SCOPED RUN THAT BUILDS NOTHING SAYS WHY.
 *
 * Two presses look identical on screen and mean different things. A region painted deep inside a tall
 * massif is ground the terrain around it stands on: the seam claims every cell of it, hands it back,
 * and the run has nowhere to build, which no seed and no recipe changes. A region over ground the run
 * was free to build on, where the design happened to put nothing, is the quiet case it always was.
 * `Outcome.scopeEmpty` names which, and only the first reaches the user as a notice.
 *
 * The recipe here is the picture path because the classification is the SEAM's reading, not any one
 * generator's: what it needs is a run that clears its scope and tries.
 */
describe('what a region run reports when it built nothing', () => {
  /** A plateau legal on its own: a tier-8 core, then one ring at 5 and one at 2, which is the most
   *  V-MTN-03 allows a step to be (a cell at N wants its 3x3 at N-3). */
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
    return {
      algorithm: 'stencil', mode: 'mixed', maxElevation: 8, seed: 3, region,
      stencilPlan: {
        read: 'color', origin, water: 'none',
        stencil: {
          width: w, height: h,
          coverage: new Uint8Array(w * h).fill(covered ? 255 : 0),
          color: new Uint32Array(w * h).fill(0x404040),
        },
      },
    } as unknown as GenerateConfig;
  }

  it('names the ground when the region was owed to the terrain around it', async () => {
    __resetCandidateCache();
    forgetGenerationScope();
    const state = makeState(30, 30);
    plateau(state, 8, 8, 21, 21);
    const ctx = ctxOf(state);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);

    const region = square(state, 15, 15, 2);   // deep inside the massif, all four sides leaning in
    const outcome = await generateMap(ctx, { config: picture(region, true), region });

    expect(outcome.scopeEmpty).toBe('reclaimed');
    expect(outcome.violations).toEqual([]);
    expect(ctx.registry.validatePostStroke(state)).toEqual([]);

    // The same recipe on ground nothing leans on builds, and says nothing: what the massif changed is
    // the ground, not the press.
    __resetCandidateCache();
    forgetGenerationScope();
    const free = makeState(30, 30);
    const freeCtx = ctxOf(free);
    const built = await generateMap(freeCtx, { config: picture(region, true), region });
    expect(built.placed).toBeGreaterThan(0);
    expect(built.scopeEmpty).toBeUndefined();
  }, 60000);

  it('ties the notice to what stands, on a real planet run inside a massif', async () => {
    // The massif is not the test: what a designed run manages on ground like this is the generator's
    // business and may change (today it terraces the top down and puts a pond on it, which IS
    // something built). What must hold either way is that the notice follows the map — silent while
    // anything of the run stands in the region, and the ground's own reason when nothing does.
    __resetCandidateCache();
    forgetGenerationScope();
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
    const outcome = await generateMap(ctx, {
      config: {
        algorithm: 'designed', mode: 'mixed', maxElevation: 8, richness: 0.7, seed: 42, region,
      } as GenerateConfig,
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
    forgetGenerationScope();
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

  /** A run's clearing, as the operations do it: erase the terrain in scope. */
  function clearRegion(state: GridState, region: MacroCoord[]): void {
    const exec = new CommandExecutor(
      state, new EventBus<EditorEvents>(), reg, roadLookup(state), catalogLoadValue,
    );
    clearAllTerrain(state, (cmd) => exec.execute(cmd), region);
  }

  function executorOf(state: GridState): CommandExecutor {
    return new CommandExecutor(
      state, new EventBus<EditorEvents>(), reg, roadLookup(state), catalogLoadValue,
    );
  }

  it('gives back the 3x3 base of a mountain standing just outside the region', () => {
    // A tier-6 block at (10,10) on a plateau of tier 3: legal, and its base reaches into the region
    // painted over the right-hand half of the map.
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
    // Exactly the base cells inside the region came back, and nothing beyond the 3x3 did.
    for (const [x, y] of [[11, 9], [11, 10], [11, 11]]) {
      expect(getCell(state.cells, x!, y!)?.terrain?.elevation, `${x},${y}`).toBe(3);
    }
    expect(getCell(state.cells, 12, 10)?.terrain).toBeNull();
    expect(out.restored).toBeLessThanOrEqual(6);
  });

  it('gives back the cap an elevated channel outside the region stands behind', () => {
    // A channel of water at tier 2 running east across a tier-2 plateau, with the ground north of it
    // one tier lower: every water cell faces that drop, so the rule wants a mountain at exactly tier 2
    // at each END of the channel (the perpendicular axis). The region is painted over the east end,
    // which is where the cap stands.
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
    // The channel reaches its cap again: water back at (11,9), mountain at exactly tier 2 at (12,9).
    expect(getCell(state.cells, 11, 9)?.terrain).toMatchObject({ type: TerrainType.Water, elevation: 2 });
    expect(getCell(state.cells, 12, 9)?.terrain).toMatchObject({ type: TerrainType.Mountain, elevation: 2 });
  });

  it('edits nothing outside the region, even when the region has nothing to give', () => {
    // A lone tier-8 spike OUTSIDE the region is illegal on its own, and no ground inside the region
    // can support it. The repair must leave it alone rather than reach across the boundary.
    const state = makeState(20, 20);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) setTerrain(state, x, y, TerrainType.Mountain, 8);
    const outsideBefore = terrainOf(state, (x) => x < 10);

    const region: MacroCoord[] = [];
    for (let y = 0; y < 20; y++) for (let x = 10; x < 20; x++) region.push({ x, y });
    const base = readRegionBase(state, region);
    const out = repairRegionSeam({ state, execute: (c) => executorOf(state).execute(c), reg }, base);

    expect(out.violations.length).toBeGreaterThan(0);   // honestly unrepairable, and reported as such
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
