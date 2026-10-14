import { describe, it, expect } from 'vitest';
import { generateTerrain, clearAllTerrain, clearAllObjects } from '../../../tools/generation';
import { TerrainType, CommandType } from '../../../core/model/types';
import type { Command, GridState, ValidationResult, PlacedObject } from '../../../core/model/types';
import { makeState, setTerrain, makeExecutor } from '../../_support/map-state';
import { getCell, createDefaultTerrainCell } from '../../../core/model/grid-model';
import { createDefaultRegistry } from '../../../rules';
import { defaultConfig } from '../../../tools/generation/recipe';

function simpleExecutor(state: GridState) {
  return (cmd: Command): ValidationResult => {
    if (cmd.type === CommandType.PaintTerrain) {
      for (const c of cmd.cells) {
        const cell = getCell(state.cells, c.x, c.y);
        if (cell) {
          if (cmd.terrainType === TerrainType.Mountain && cmd.elevation === 0) {
            cell.terrain = null;
          } else {
            cell.terrain = createDefaultTerrainCell(cmd.terrainType, cmd.elevation);
          }
        }
      }
    }
    if (cmd.type === CommandType.EraseTerrain) {
      for (const c of cmd.cells) {
        const cell = getCell(state.cells, c.x, c.y);
        if (cell) cell.terrain = null;
      }
    }
    return { success: true, errors: [] };
  };
}

describe('generateTerrain dispatch + clearAllTerrain', () => {
  it('clearAllTerrain removes every terrain cell a run laid', () => {
    const N = 40;
    const state = makeState(N, N);
    // The maze carves walls over the whole map, so there is a mountainous plan to clear. It does
    // not consult the rules itself, which is what lets this file drive the dispatch through a fake
    // executor and keep `clearAllTerrain` as its subject.
    const { placed } = generateTerrain(
      { state, execute: simpleExecutor(state), reg: createDefaultRegistry() },
      defaultConfig('maze', { maxElevation: 3, seed: 99 }));
    expect(placed).toBeGreaterThan(0);

    const cleared = clearAllTerrain({ state, execute: simpleExecutor(state) });
    expect(cleared).toBeGreaterThan(0);

    // Verify no terrain remains
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const cell = getCell(state.cells, x, y);
        expect(cell?.terrain).toBeNull();
      }
    }
  });
});

describe('clearAllObjects', () => {
  const obj = (id: string, x: number, y: number): PlacedObject =>
    ({ id, catalogId: id, position: { x, y }, rotation: 0, elevation: 0 });

  it('removes every placed object — tiles AND placements', () => {
    const state = makeState(20, 20);
    for (const o of [
      obj('road-1', 5, 5),  // a tile/road surface
      obj('tree-apple-1', 7, 7),      // a placement
      obj('building-stall-1', 9, 9),
    ]) state.objects.set(o.id, o);

    const executor = makeExecutor(state);
    const removed = clearAllObjects({ state, execute: (cmd) => executor.execute(cmd) });

    expect(removed).toBe(3);
    expect(state.objects.size).toBe(0);
  });

  it('a grouped Clear (objects + terrain) undoes in a single step', () => {
    const state = makeState(20, 20);
    setTerrain(state, 5, 5, TerrainType.Mountain, 1);
    setTerrain(state, 6, 5, TerrainType.Mountain, 1);
    for (const o of [
      obj('road-1', 5, 5),
      obj('tree-apple-1', 7, 7),
    ]) state.objects.set(o.id, o);

    const executor = makeExecutor(state);
    const start = executor.beginStroke();
    clearAllObjects({ state, execute: (cmd) => executor.execute(cmd) }); // objects first
    clearAllTerrain({ state, execute: (cmd) => executor.execute(cmd) });
    start.commit();

    expect(state.objects.size).toBe(0);
    expect(getCell(state.cells, 5, 5)?.terrain).toBeNull();

    // One undo restores both the terrain and every object.
    executor.undo();
    expect(state.objects.size).toBe(2);
    expect(getCell(state.cells, 5, 5)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(start.size).toBe(0); // collapsed to a single entry
  });
});
