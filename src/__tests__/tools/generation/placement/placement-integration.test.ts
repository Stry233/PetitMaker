import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { EventBus } from '../../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../../rules/index';
import { makeState } from '../../../rules/_helpers';
import { generateTerrain } from '../../../../tools/generation/terrain-generator';
import { populate } from '../../../../tools/generation/placement';
import { toGenConfig } from '../../../../tools/generation';
import { ItemCategory, type EditorEvents, type GenerateConfig } from '../../../../core/model/types';
import { getCatalogByCategory, getCatalogItem, isDecoration } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { roadLookup } from '../../../../state/object-index';

function gen(settlement: number, nature: number, seed: number, size = 48, region: { x: number; y: number }[] | null = null) {
  const state = makeState(size, size);
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed, region, settlement, nature };
  const start = exec.getUndoStackSize();
  generateTerrain(config, state, (c) => exec.execute(c));
  populate(toGenConfig(config), state, (c) => exec.execute(c), exec.getRegistry());
  const postViol = exec.commitStrokeGroup(start).length;
  const objs = [...state.objects.values()].filter((o) => !o.locked);
  return { postViol, objs };
}
const SEEDS = [1, 7, 13, 42, 77, 99, 128, 256];
const idsOf = (cat: ItemCategory) => new Set(getCatalogByCategory(cat).map((r) => r.id));
const roadIds = idsOf(ItemCategory.Road);
const crossingIds = new Set([...idsOf(ItemCategory.Bridge), ...idsOf(ItemCategory.Ramp)]);
const isBuilding = (id: string) => { const c = getCatalogItem(id)?.category; return c === ItemCategory.Building || c === ItemCategory.Facility; };

describe('populate (terrain + placement, real executor)', () => {
  it('every populated map is rule-clean (no post-stroke violations)', () => {
    for (const s of SEEDS) expect(gen(0.7, 0.6, s).postViol, `seed ${s}`).toBe(0);
  });
  it('empty sliders → no objects', () => {
    for (const s of SEEDS) expect(gen(0, 0, s).objs.length).toBe(0);
  });
  it('settlement↑ → ≥ buildings; nature↑ → ≥ vegetation (summed)', () => {
    const b = (set: number) => SEEDS.reduce((n, s) => n + gen(set, 0, s).objs.filter((o) => isBuilding(o.catalogId)).length, 0);
    expect(b(1)).toBeGreaterThan(b(0.3));
    const v = (nat: number) => SEEDS.reduce((n, s) => n + gen(0, nat, s).objs.filter(isDecoration).length, 0);
    expect(v(1)).toBeGreaterThan(v(0.3));
  });
  it('a settled map has roads connecting it (network ran)', () => {
    const roads = SEEDS.reduce((n, s) => n + gen(1, 0, s).objs.filter((o) => roadIds.has(o.catalogId)).length, 0);
    expect(roads).toBeGreaterThan(0);
  });
  it('no tree/flower is ever placed on a paved road cell (generator avoids roads)', () => {
    const footprintCells = (o: Parameters<typeof objectRect>[0]) => {
      const r = objectRect(o);
      const cells: string[] = [];
      for (let y = Math.floor(r.y); y < Math.ceil(r.y + r.h); y++)
        for (let x = Math.floor(r.x); x < Math.ceil(r.x + r.w); x++) cells.push(`${x},${y}`);
      return cells;
    };
    for (const s of SEEDS) {
      const { objs } = gen(0.9, 0.9, s, 64);
      const road = new Set<string>();
      for (const o of objs) if (roadIds.has(o.catalogId)) for (const c of footprintCells(o)) road.add(c);
      for (const o of objs) {
        if (!isDecoration(o)) continue;
        for (const c of footprintCells(o)) {
          expect(road.has(c), `seed ${s}: ${o.catalogId} sits on a road at ${c}`).toBe(false);
        }
      }
    }
  });

  it('deterministic for a (seed, config)', () => {
    const key = (o: { catalogId: string; position: { x: number; y: number } }) => `${o.catalogId}@${o.position.x},${o.position.y}`;
    expect(gen(0.7, 0.6, 7).objs.map(key)).toEqual(gen(0.7, 0.6, 7).objs.map(key));
  });
  it('buildings are DISTRIBUTED across the map (hamlet network), not gathered in one blob', () => {
    // Across the seed sweep, the span of building positions should be a large fraction of the map — a
    // single clustered village would keep them within a few cells of each other.
    let wide = 0;
    for (const s of SEEDS) {
      const homes = gen(1, 0, s, 80).objs.filter((o) => isBuilding(o.catalogId));
      if (homes.length < 4) continue;
      const xs = homes.map((o) => o.position.x), ys = homes.map((o) => o.position.y);
      const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
      if (span > 30) wide++;
    }
    expect(wide, 'most seeds spread buildings widely').toBeGreaterThan(SEEDS.length / 2);
  });
  it('a selected region confines placement (objects stay in the region, not the whole map)', () => {
    const region: { x: number; y: number }[] = [];
    for (let y = 20; y < 55; y++) for (let x = 20; x < 55; x++) region.push({ x, y }); // a 35x35 box on an 80x80 map
    const inSet = new Set(region.map((c) => `${c.x},${c.y}`));
    for (const s of [42, 7, 200]) {
      const objs = gen(0.8, 0.6, s, 80, region).objs;
      if (objs.length < 5) continue; // some seeds have little buildable terrain in the box
      const outside = objs.filter((o) => !inSet.has(`${o.position.x},${o.position.y}`)).length;
      // Footprints can straddle the boundary by a cell, but the bulk must be inside (was ~95% OUTSIDE before).
      expect(outside / objs.length, `seed ${s} mostly in-region`).toBeLessThan(0.15);
    }
  });
  it('cancellation: a flipped signal bails populate early (places nothing); a clear signal completes', async () => {
    const cfg: GenerateConfig = { algorithm: 'random', mode: 'mixed', corridorWidth: 1, maxElevation: 6, seed: 42, region: null, settlement: 0.8, nature: 0.7 };
    const run = async (cancelled: boolean) => {
      const state = makeState(80, 80);
      const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
      generateTerrain(cfg, state, (c) => exec.execute(c));
      return (await populate(toGenConfig(cfg), state, (c) => exec.execute(c), exec.getRegistry(), { cancelled })).placed;
    };
    expect(await run(true), 'cancelled before the first stage → nothing placed').toBe(0);
    expect(await run(false), 'not cancelled → fully populates').toBeGreaterThan(0);
  });
  it('crossings (bridges/ramps) build across full-size mixed maps where terrain allows, all rule-clean', () => {
    const big = [11, 23, 42, 64, 88, 100, 137, 200];
    let crossings = 0;
    for (const s of big) {
      const r = gen(0.7, 0.6, s, 80);
      expect(r.postViol, `seed ${s} rule-clean`).toBe(0);
      crossings += r.objs.filter((o) => crossingIds.has(o.catalogId)).length;
    }
    expect(crossings, 'bridges+ramps placed across the seed sweep').toBeGreaterThan(0);
  });
});
