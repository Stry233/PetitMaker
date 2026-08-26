/**
 * The build checklist is read by someone rebuilding a map by hand, so being SHORT is the failure
 * mode: an item it omits is an item that never gets built. These probes therefore check the list
 * against the map itself, on a real generated island, rather than against a fixture of what the
 * list is expected to say.
 */
import { describe, it, expect } from 'vitest';
// @ts-ignore - node:fs is untyped here (no @types/node); the test reads the shipped map JSONs.
import { readFileSync } from 'node:fs';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { PLAZA_ID } from '../../core/model/constants';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import {
  CommandType, ItemCategory, TerrainType,
  type Command, type EditorEvents, type GenerateConfig, type GridState, type MapTemplate, type PlaceObjectCommand,
} from '../../core/model/types';
import { createDefaultRegistry } from '../../rules/index';
import { buildChecklist } from '../../state/build-checklist';
import { getRoadMaterials } from '../../state/catalog';
import { getMapStats } from '../../state/map-stats';
import { getObjectIndex, roadLookup } from '../../state/object-index';
import { clearAllObjects, clearAllTerrain, generateTerrain } from '../../tools/generation/terrain-generator';

function realState(file: string): GridState {
  const template = JSON.parse(readFileSync(`src/config/maps/${file}`, 'utf8')) as MapTemplate;
  const cells = createGrid(template);
  const objects = new Map();
  const plaza = createPlazaObject(template);
  if (plaza) objects.set(plaza.id, plaza);
  return { template, cells, objects, lockedLayers: new Set() };
}

/** A generated island on a shipped map: real terrain at several layers, real water, and the whole
 *  island generator's output (buildings, trees, flora, facilities, crossings, roads). */
function generated(): { state: GridState; exec: CommandExecutor } {
  const state = realState('hexia.json');
  const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
  const config: GenerateConfig = {
    algorithm: 'designed', mode: 'mixed', corridorWidth: 1, maxElevation: 5, seed: 7, region: null,
  };
  const run = (c: Command) => exec.execute(c);
  const start = exec.getUndoStackSize();
  clearAllObjects(state, run);
  clearAllTerrain(state, run);
  generateTerrain(config, state, run, exec.getRegistry());
  exec.commitStrokeGroup(start);
  return { state, exec };
}

describe('build checklist against a real generated map', () => {
  const { state } = generated();
  const list = buildChecklist(state);
  const counts = getObjectIndex(state).countByCatalog;

  it('the map under test is worth checking: terrain at several layers, and a populated island', () => {
    expect(state.objects.size, 'objects placed').toBeGreaterThan(50);
    expect(list.layers.length, 'more than one terrain layer').toBeGreaterThan(1);
    expect(list.layers.some((l) => l.water > 0), 'the island has water').toBe(true);
    expect(list.roadTotal, 'the island has roads').toBeGreaterThan(0);
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
    for (const [id, n] of counts) {
      if (id === PLAZA_ID) continue;
      expect(listed.get(id), `${id} missing from the checklist`).toBe(n);
    }
    // …and nothing invented: every listed id is actually on the map.
    for (const [id, n] of listed) expect(counts.get(id), `${id} listed but not placed`).toBe(n);
  });

  it('nothing falls between the sections: the counts add up to every object on the map', () => {
    const placed = list.groups.reduce((n, g) => n + g.total, 0);
    expect(placed + list.roadTotal + (list.hasPlaza ? 1 : 0) + list.unresolved).toBe(state.objects.size);
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

  it('the locked plaza is named as part of the map, never as a material', () => {
    expect(state.objects.has(PLAZA_ID), 'the map under test has a plaza').toBe(true);
    expect(list.hasPlaza).toBe(true);
    const ids = [...list.groups.flatMap((g) => g.items), ...list.roads].map((i) => i.catalogId);
    expect(ids).not.toContain(PLAZA_ID);
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
    // Somewhere off the island: the assertion is about the checklist reading the index, so the
    // objects go in directly rather than through a placement the terrain would refuse.
    let n = 0;
    for (const material of getRoadMaterials()) {
      const cmd: PlaceObjectCommand = {
        type: CommandType.PlaceObject, timestamp: 0, loadValue: material.loadValue,
        object: {
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

describe('an empty map', () => {
  it('lists nothing but still names the plaza the map came with', () => {
    const state = realState('hexia.json');
    const list = buildChecklist(state);
    expect(list.groups.every((g) => g.items.length === 0)).toBe(true);
    expect(list.roads).toEqual([]);
    expect(list.layers).toEqual([]);
    expect(list.hasPlaza).toBe(true);
    expect(list.unresolved).toBe(0);
  });
});
