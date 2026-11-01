/** The road network macro on generated relief: a second press with nothing changed lays nothing. Runs a full generation. */
import { describe, expect, it } from 'vitest';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { createGridState } from '../../../../core/model/template';
import { CommandType, TerrainType, type Command, type GridState, type MacroCoord } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { getMapTemplate } from '../../../../config/maps';
import { createDefaultRegistry } from '../../../../rules';
import { categoryOf, getCatalogItem } from '../../../../state/catalog';
import { getObjectIndex } from '../../../../state/object-index';
import { clearAllObjects } from '../../../../tools/generation';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import { applyMacro } from '../../../../tools/macros';
import { generateObjectId } from '../../../../core/model/object-id';
import { createExecutor } from '../../../../state/executor';
import { generateWith } from '../../../_support/generation';
import { ItemCategory } from '../../../../config/catalog/categories';

describe('smart construction on generated terrain', () => {
  // Generated terrain exposes orphan crossings that a repeated network call could otherwise add.
  it('a re-press with nothing changed says so, on terrain that could grow crossings', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGridState(template).cells, objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = (templateLandmarkObjects(template)[0] ?? null);
    expect(plaza, 'the scenario needs the plaza standing').not.toBeNull();
    state.objects.set(plaza!.id, plaza!);

    const exec = createExecutor(state, createDefaultRegistry());
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const config: GenerateConfig = defaultConfig('designed', { maxElevation: 8, seed: 7 });
    generateWith(state, exec, config);
    // Terrain only: the test plants its own two houses below. The locked plaza stays.
    clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
    const raised = state.cells.flat().filter((c) => (c.terrain?.elevation ?? 0) > 0).length;
    expect(raised, 'the fixture has to have relief for this test to mean anything').toBeGreaterThan(1000);

    // Two houses on level open ground in the hub's region, so both are servable. The spots are found
    // at runtime because they depend on the generator's output.
    const a = analyzeTerrain(state, null);
    const W = a.width;
    const hubRegion = a.rankedRegions[0]!;
    const spots: (MacroCoord & { elevation: number })[] = [];
    const house = getCatalogItem('building-boat-cabin')!;
    // A cell's dry level: its mountain layer, 0 on bare ground, -1 under water.
    const level = (x: number, y: number): number => {
      const t = state.cells[y]![x]!.terrain;
      return !t ? 0 : t.type === TerrainType.Mountain ? t.elevation : -1;
    };
    for (let y = 4; y < template.height - 8; y += 6) {
      for (let x = 4; x < template.width - 8; x += 6) {
        if ((a.region[y * W + x] ?? -1) !== hubRegion) continue;
        const elevation = level(x, y);
        let open = elevation >= 0;
        // The house plus the flat trait's +1 right/bottom margin and a spare cell, all at one level.
        for (let dy = 0; dy < house.height + 2; dy++) for (let dx = 0; dx < house.width + 2; dx++) {
          if (a.open[(y + dy) * W + (x + dx)] !== 1 || level(x + dx, y + dy) !== elevation) open = false;
        }
        if (open) spots.push({ x, y, elevation });
      }
    }
    expect(spots.length, 'no open ground in the hub region to stand a house on').toBeGreaterThan(1);
    // Two different cabins: a landmark building is capped at one on the map (V-PLACE-MAX).
    for (const [i, s] of [spots[0]!, spots[spots.length - 1]!].entries()) {
      const catalogId = ['building-boat-cabin', 'building-forest-cabin'][i]!;
      const obj = { id: generateObjectId(), catalogId, position: { x: s.x, y: s.y }, rotation: 0 as const, elevation: s.elevation };
      const r = exec.execute({ type: CommandType.PlaceObject, object: obj });
      expect(r.success, `house@${s.x},${s.y}: ${r.errors?.[0]?.message ?? ''}`).toBe(true);
    }

    const first = applyMacro(ctx, 'roads', { seed: 3 });
    expect(first.changes, first.reason ?? '').toBeGreaterThan(0);
    const count = (cat: ItemCategory): number => [...state.objects.values()].filter((o) => categoryOf(o) === cat).length;
    const roadsBefore = count(ItemCategory.Road);
    const crossingsBefore = count(ItemCategory.Bridge) + count(ItemCategory.Ramp);

    for (const seed of [4, 5, 6]) {
      const again = applyMacro(ctx, 'roads', { seed });
      expect(again.changes, `press at seed ${seed} laid ${again.changes}`).toBe(0);
      expect(again.code).toBe('already-connected');
    }
    // No pavement and no crossing was added.
    expect(count(ItemCategory.Road)).toBe(roadsBefore);
    expect(count(ItemCategory.Bridge) + count(ItemCategory.Ramp)).toBe(crossingsBefore);

    // Every crossing has pavement within reach of one end, so presses leave no orphan ramps.
    const { roadByCell } = getObjectIndex(state);
    for (const o of state.objects.values()) {
      const cat = categoryOf(o);
      if (cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
      let paved = false;
      for (let dy = -2; dy <= 3 && !paved; dy++) {
        for (let dx = -2; dx <= 3 && !paved; dx++) {
          if (roadByCell.has(`${o.position.x + dx},${o.position.y + dy}`)) paved = true;
        }
      }
      expect(paved, `${o.catalogId}@${o.position.x},${o.position.y} stands with no pavement at either end`).toBe(true);
    }
  }, 120_000);
});
