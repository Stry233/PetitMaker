/**
 * The build checklist is read by someone rebuilding a map by hand, so being short is the failure
 * mode: an item it omits is an item that never gets built. These probes therefore check the list
 * against the map itself, on a real generated planet, rather than against a fixture of what the
 * list is expected to say.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createGrid } from '../../core/model/grid-model';
import { templateLandmarkObjects } from '../../core/model/landmarks';
import { CommandType, TerrainType, type Command, type GridState, type MapTemplate, type PlaceObjectCommand } from '../../core/model/types';
import { defaultConfig, type GenerateConfig } from '../../tools/generation/recipe';
import { buildChecklist } from '../../state/build-checklist';
import { getRoadMaterials } from '../../state/catalog';
import { getMapStats } from '../../state/map-stats';
import { getObjectIndex } from '../../state/object-index';
import { clearAllObjects, clearAllTerrain, generateTerrain } from '../../tools/generation';
import { LANDMARKS } from '../../core/game/profile';
import { ANCHOR_LANDMARK } from '../_support/anchor';
import { makeExecutor } from '../_support/map-state';
import { ItemCategory } from '../../config/catalog/categories';

function realState(file: string): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map();
  for (const landmark of templateLandmarkObjects(template)) objects.set(landmark.id, landmark);
  return { template, cells, objects, objectsVersion: 0, cellsVersion: 0, lockedLayers: new Set() };
}

/** A generated planet on a shipped map: real terrain at several layers, real water, and the whole
 *  planet generator's output (buildings, trees, flora, facilities, crossings, roads). */
function generated(): { state: GridState; exec: CommandExecutor } {
  const state = realState('hexia.json');
  const exec = makeExecutor(state);
  const config: GenerateConfig = defaultConfig('designed', { maxElevation: 5, seed: 7 });
  const run = (c: Command) => exec.execute(c);
  const start = exec.beginStroke();
  clearAllObjects({ state, execute: run });
  clearAllTerrain({ state, execute: run });
  generateTerrain({ state, execute: run, reg: exec.getRegistry() }, config);
  start.commit();
  return { state, exec };
}

describe('build checklist against a real generated map', () => {
  const { state } = generated();
  const list = buildChecklist(state);
  const counts = getObjectIndex(state).countByCatalog;

  it('the map under test is worth checking: terrain at several layers, and a populated planet', () => {
    expect(state.objects.size, 'objects placed').toBeGreaterThan(50);
    expect(list.layers.length, 'more than one terrain layer').toBeGreaterThan(1);
    expect(list.layers.some((l) => l.water > 0), 'the planet has water').toBe(true);
    expect(list.roadTotal, 'the planet has roads').toBeGreaterThan(0);
    const withItems = list.groups.filter((g) => g.items.length > 0).map((g) => g.category);
    expect(withItems, 'buildings placed').toContain(ItemCategory.Building);
    expect(withItems, 'trees placed').toContain(ItemCategory.Tree);
    expect(withItems, 'flora placed').toContain(ItemCategory.Flora);
  });

  it('every object type on the map is listed once, at the count the index holds', () => {
    const listed = new Map<string, number>();
    for (const group of list.groups) {
      for (const item of group.items) {
        expect(listed.has(item.catalogId), `${item.catalogId} listed twice`).toBe(false);
        listed.set(item.catalogId, item.count);
      }
    }
    for (const item of list.roads) {
      expect(listed.has(item.catalogId), `${item.catalogId} listed twice`).toBe(false);
      listed.set(item.catalogId, item.count);
    }
    for (const item of list.landmarks) {
      expect(listed.has(item.catalogId), `${item.catalogId} listed twice`).toBe(false);
      listed.set(item.catalogId, item.count);
    }
    for (const [id, n] of counts) expect(listed.get(id), `${id} missing from the checklist`).toBe(n);
    // …and nothing invented: every listed id is actually on the map.
    for (const [id, n] of listed) expect(counts.get(id), `${id} listed but not placed`).toBe(n);
  });

  it('nothing falls between the sections: the counts add up to every object on the map', () => {
    const placed = list.groups.reduce((n, g) => n + g.total, 0);
    expect(placed + list.roadTotal + list.landmarkTotal + list.unresolved).toBe(state.objects.size);
    expect(list.unresolved, 'the shipped catalog names everything the generator places').toBe(0);
  });

  it('a group total is the sum of its own items', () => {
    for (const group of list.groups) {
      expect(group.total).toBe(group.items.reduce((n, i) => n + i.count, 0));
    }
    expect(list.roadTotal).toBe(list.roads.reduce((n, i) => n + i.count, 0));
  });

  it('per-layer cell counts equal the map, and run lowest layer first', () => {
    const stats = getMapStats(state);
    for (const layer of list.layers) {
      expect(layer.blocks, `layer ${layer.layer} block count`).toBe(stats.cellsByLayer[layer.layer] ?? 0);
      expect(layer.water, `layer ${layer.layer} water count`).toBe(stats.waterByLayer[layer.layer] ?? 0);
    }
    for (let i = 1; i < list.layers.length; i++) {
      expect(list.layers[i]!.layer).toBeGreaterThan(list.layers[i - 1]!.layer);
    }
    // No empty row: a layer is listed because it carries something.
    for (const layer of list.layers) expect(layer.blocks + layer.water).toBeGreaterThan(0);
  });

  it('the per-layer counts match a plain walk of the grid, independent of map-stats', () => {
    const blocks: number[] = [];
    const water: number[] = [];
    for (let y = 0; y < state.template.height; y++) {
      for (let x = 0; x < state.template.width; x++) {
        const terrain = state.cells[y]?.[x]?.terrain;
        if (!terrain || terrain.type === TerrainType.None) continue;
        if (terrain.type === TerrainType.Water) water[terrain.elevation] = (water[terrain.elevation] ?? 0) + 1;
        for (let l = 1; l <= terrain.elevation; l++) blocks[l] = (blocks[l] ?? 0) + 1;
      }
    }
    for (const layer of list.layers) {
      expect(layer.blocks, `layer ${layer.layer}`).toBe(blocks[layer.layer] ?? 0);
      expect(layer.water, `layer ${layer.layer} water`).toBe(water[layer.layer] ?? 0);
    }
    // Nothing the walk found is missing from the list.
    for (let l = 0; l < Math.max(blocks.length, water.length); l++) {
      if ((blocks[l] ?? 0) + (water[l] ?? 0) === 0) continue;
      expect(list.layers.some((row) => row.layer === l), `layer ${l} missing`).toBe(true);
    }
  });

  it('the landmarks are listed in their own section, never as a material', () => {
    expect(state.objects.has(ANCHOR_LANDMARK.id), 'the map under test has a plaza').toBe(true);
    expect(list.landmarks.map((i) => i.catalogId)).toEqual(LANDMARKS.map((l) => l.id));
    const ids = [...list.groups.flatMap((g) => g.items), ...list.roads].map((i) => i.catalogId);
    for (const landmark of LANDMARKS) expect(ids).not.toContain(landmark.id);
  });

  it('the six placeable categories are always present, in build order', () => {
    expect(list.groups.map((g) => g.category)).toEqual([
      ItemCategory.Building, ItemCategory.Tree, ItemCategory.Flora,
      ItemCategory.Facility, ItemCategory.Bridge, ItemCategory.Ramp,
    ]);
    for (const group of list.groups) {
      for (const item of group.items) {
        expect(item.name.en, `${item.catalogId} has no name to show`).toBeTruthy();
      }
    }
  });
});

describe('road surfaces', () => {
  it('every material is listed, by material, when every one is laid', () => {
    const { state } = generated();
    const before = buildChecklist(state);
    // Somewhere off the map: the assertion is about the checklist reading the index, so the
    // objects go in directly rather than through a placement the terrain would refuse.
    let n = 0;
    for (const material of getRoadMaterials()) {
      const cmd: PlaceObjectCommand = {
        type: CommandType.PlaceObject,         object: {
          id: `checklist-road-${n}`, catalogId: material.id,
          position: { x: 1 + n, y: 1 }, rotation: 0, elevation: 0,
        },
      };
      state.objects.set(cmd.object.id, cmd.object);
      n++;
    }
    // The index cannot trust a mutation it was not told about, so it rebuilds — which is exactly
    // what a checklist read must survive.
    const after = buildChecklist(state);
    expect(after.roads.map((r) => r.catalogId)).toEqual(
      expect.arrayContaining(getRoadMaterials().map((m) => m.id)),
    );
    expect(after.roadTotal).toBe(before.roadTotal + getRoadMaterials().length);
    for (const material of getRoadMaterials()) {
      const row = after.roads.find((r) => r.catalogId === material.id);
      expect(row, `${material.id} missing`).toBeDefined();
      expect(row!.count).toBeGreaterThan(0);
    }
  });
});

describe('an empty built-in map', () => {
  for (const file of ['hexia.json', 'tafa.json']) {
    it(`${file} lists nothing placed but names every landmark the map came with`, () => {
      const state = realState(file);
      const list = buildChecklist(state);
      expect(list.groups.every((g) => g.items.length === 0)).toBe(true);
      expect(list.roads).toEqual([]);
      expect(list.layers).toEqual([]);
      expect(list.landmarks.map((i) => [i.catalogId, i.count])).toEqual(LANDMARKS.map((l) => [l.id, 1]));
      expect(list.landmarkTotal).toBe(LANDMARKS.length);
      expect(list.unresolved).toBe(0);
      const placed = list.groups.reduce((n, g) => n + g.total, 0);
      expect(placed + list.roadTotal + list.landmarkTotal + list.unresolved).toBe(state.objects.size);
      expect(list.objectTotal).toBe(state.objects.size);
    });
  }
});
