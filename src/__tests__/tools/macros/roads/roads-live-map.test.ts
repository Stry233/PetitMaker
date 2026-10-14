/**
 * The roads macro on a real map: hexia, its locked plaza standing, two houses placed by hand.
 *
 * This is the scenario the button exists for, and it laid nothing for as long as the network seed
 * was marked from the plaza's own fractional rect — `forEachFootprintCell` visited half-cell
 * coordinates, the seed became grid indices no integer lookup finds, and every route "failed to
 * reach the network". A square test map without a plaza could never see it.
 */
import { describe, it, expect, vi } from 'vitest';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { CommandType, type Command, type GridState, type MacroCoord } from '../../../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../../../tools/generation/recipe';
import { createGrid } from '../../../../core/model/grid-model';
import { templateLandmarkObjects } from '../../../../core/model/landmarks';
import { getMapTemplate } from '../../../../config/maps';
import { categoryOf, getCatalogItem } from '../../../../state/catalog';
import { getObjectIndex } from '../../../../state/object-index';
import { objectRect } from '../../../../state/object-geometry';
import { clearAllObjects } from '../../../../tools/generation';
import { analyzeTerrain } from '../../../../tools/placement/analysis';
import { applyMacro } from '../../../../tools/macros';
import { generateObjectId } from '../../../../core/model/object-id';
import { makeExecutor } from '../../../_support/map-state';
import { generateWith } from '../../../_support/generation';
import { ItemCategory } from '../../../../config/catalog/categories';

// Each sweep case generates a whole planet's terrain; a few seconds per case on an idle machine.
vi.setConfig({ testTimeout: 120_000 });

/** Hexia with generated relief and nothing standing but the plaza and two houses on open level
 *  ground in the hub's own region, as far apart as the scan finds. */
function terracedWithHouses(terrainSeed: number): { state: GridState; exec: CommandExecutor } {
  const template = getMapTemplate('hexia');
  const state = {
    template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
  } as unknown as GridState;
  const plaza = templateLandmarkObjects(template)[0]!;
  state.objects.set(plaza.id, plaza);
  const exec = makeExecutor(state);
  const config: GenerateConfig = defaultConfig('designed', { maxElevation: 8, seed: terrainSeed });
  generateWith(state, exec, config);
  clearAllObjects({ state, execute: (c: Command) => exec.execute(c) });
  const a = analyzeTerrain(state, null);
  const W = a.width;
  const hub = a.rankedRegions[0]!;
  const house = getCatalogItem('building-boat-cabin')!;
  const spots: MacroCoord[] = [];
  for (let y = 4; y < template.height - 8; y += 6) {
    for (let x = 4; x < template.width - 8; x += 6) {
      if ((a.region[y * W + x] ?? -1) !== hub) continue;
      let open = true;
      for (let dy = 0; dy < house.height + 2; dy++) for (let dx = 0; dx < house.width + 2; dx++) {
        if (a.open[(y + dy) * W + (x + dx)] !== 1 || state.cells[y + dy]![x + dx]!.terrain) open = false;
      }
      if (open) spots.push({ x, y });
    }
  }
  for (const [i, at] of [spots[0]!, spots[spots.length - 1]!].entries()) {
    const catalogId = ['building-boat-cabin', 'building-forest-cabin'][i]!;
    const obj = { id: generateObjectId(), catalogId, position: at, rotation: 0 as const, elevation: 0 };
    exec.execute({ type: CommandType.PlaceObject, object: obj });
  }
  return { state, exec };
}

describe('roads on a live map', () => {
  it('leaves no ramp or bridge without pavement at either end, over generated terraces and press seeds', () => {
    for (const terrainSeed of [7, 11, 23]) {
      for (const seed of [1, 3, 5]) {
        const { state, exec } = terracedWithHouses(terrainSeed);
        applyMacro({ state, executor: exec, registry: exec.getRegistry() }, 'roads', { seed });
        const { roadByCell } = getObjectIndex(state);
        for (const o of state.objects.values()) {
          const cat = categoryOf(o);
          if (cat !== ItemCategory.Bridge && cat !== ItemCategory.Ramp) continue;
          const r = objectRect(o);
          let paved = false;
          for (let y = Math.floor(r.y) - 2; y <= Math.ceil(r.y + r.h) + 1 && !paved; y++) {
            for (let x = Math.floor(r.x) - 2; x <= Math.ceil(r.x + r.w) + 1 && !paved; x++) {
              if (roadByCell.has(`${x},${y}`)) paved = true;
            }
          }
          expect(paved, `terrain ${terrainSeed}, press ${seed}: ${o.catalogId}@${o.position.x},${o.position.y}`).toBe(true);
        }
      }
    }
  });

  it('connects two hand-placed houses past the fractional plaza', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGrid(template), objects: new Map(), objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set(),
    } as unknown as GridState;
    const laid = templateLandmarkObjects(template)[0] ?? null;
    expect(laid, 'the scenario needs the plaza standing').not.toBeNull();
    // Moved half a cell onto the half grid, where its body is no whole-cell rect.
    const plaza = { ...laid!, position: { x: laid!.position.x - 0.5, y: laid!.position.y - 0.5 } };
    state.objects.set(plaza.id, plaza);
    // The plaza's sub-block rect is the whole point of this fixture.
    expect(Number.isInteger(plaza.position.x)).toBe(false);

    const exec = makeExecutor(state);
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const place = (catalogId: string, x: number, y: number): void => {
      const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0 };
      expect(exec.execute({ type: CommandType.PlaceObject, object: obj }).success).toBe(true);
    };
    place('building-myhouse', 40, 40);
    place('building-stall', 55, 48);

    const outcome = applyMacro(ctx, 'roads', { seed: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    const roads = [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    expect(roads.length, 'the network is paved, not merely reported').toBeGreaterThan(0);
  });
});
