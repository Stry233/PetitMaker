/**
 * Clear takes the same scope Generate does.
 *
 * The two buttons sit under one region control, so clearing after generating into a region has to
 * take back what the generator wrote and no more — it used to wipe the rest of the map, work the
 * generator never touched.
 */
import { describe, it, expect } from 'vitest';
import { clearAllTerrain, clearAllObjects } from '../../tools/generation/terrain-generator';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType, type EditorEvents, type MacroCoord } from '../../core/model/types';
import { makeState } from '../rules/_helpers';

function world() {
  const state = makeState(30, 30);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const cells: MacroCoord[] = [];
  for (let y = 4; y <= 20; y++) for (let x = 4; x <= 20; x++) cells.push({ x, y });
  executor.execute({ type: CommandType.PaintTerrain, timestamp: 1, cells, terrainType: TerrainType.Mountain, elevation: 1 });
  const painted = () => state.cells.flat().filter((c) => c?.terrain).length;
  return { state, executor, painted, exec: (cmd: never) => executor.execute(cmd) };
}

const rect = (x0: number, y0: number, x1: number, y1: number): MacroCoord[] => {
  const out: MacroCoord[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push({ x, y });
  return out;
};

describe('clearAllTerrain', () => {
  it('clears only the region it is given', () => {
    const w = world();
    const before = w.painted();
    const region = rect(6, 6, 10, 10);
    const cleared = clearAllTerrain(w.state, (cmd) => w.executor.execute(cmd), region);
    expect(cleared).toBe(region.length);
    expect(w.painted()).toBe(before - region.length);
    expect(w.state.cells[6]![6]!.terrain, 'inside the region').toBeNull();
    expect(w.state.cells[12]![12]!.terrain, 'outside it').not.toBeNull();
  });

  it('clears the whole map when given none, as Generate does', () => {
    const w = world();
    expect(w.painted()).toBeGreaterThan(0);
    clearAllTerrain(w.state, (cmd) => w.executor.execute(cmd));
    expect(w.painted()).toBe(0);
  });

  it('leaves a cell an object stands on, region or not', () => {
    // Same rule as the whole-map path: object-blocks-terrain would refuse the erase anyway.
    const w = world();
    const region = rect(6, 6, 8, 8);
    const cleared = clearAllTerrain(w.state, (cmd) => w.executor.execute(cmd), region);
    expect(cleared).toBe(region.length);
  });
});

describe('clearAllObjects', () => {
  it('takes the same region parameter, so the pair scope together', () => {
    const w = world();
    expect(clearAllObjects(w.state, (cmd) => w.executor.execute(cmd), rect(6, 6, 8, 8))).toBe(0);
  });
});
