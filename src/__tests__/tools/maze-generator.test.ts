import { describe, it, expect } from 'vitest';
import { generateMaze } from '../../tools/generation/maze-generator';
import { CellZone, TerrainType, CommandType, type EditorEvents } from '../../core/model/types';
import type { Command, ValidationResult } from '../../core/model/types';
import { makeState, setZone } from '../rules/_helpers';
import { getCell } from '../../core/model/grid-model';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';

function simpleExecutor(state: ReturnType<typeof makeState>) {
  return (cmd: Command): ValidationResult => {
    if (cmd.type === CommandType.PaintTerrain) {
      for (const c of cmd.cells) {
        const cell = getCell(state.cells, c.x, c.y);
        if (cell) cell.terrain = { type: TerrainType.Mountain, elevation: cmd.elevation };
      }
    }
    return { success: true, errors: [] };
  };
}

describe('Maze generator', () => {
  it('generates maze within an L-shaped region', () => {
    const state = makeState(20, 20);
    const region = [];
    for (let y = 2; y <= 8; y++)
      for (let x = 2; x <= 8; x++)
        region.push({ x, y });
    for (let y = 2; y <= 4; y++)
      for (let x = 9; x <= 12; x++)
        region.push({ x, y });

    const result = generateMaze(state, 42, 1, 1, region, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);

    const regionSet = new Set(region.map(c => `${c.x},${c.y}`));
    for (let y = 0; y < 20; y++) {
      for (let x = 0; x < 20; x++) {
        const cell = getCell(state.cells, x, y);
        if (cell?.terrain && !regionSet.has(`${x},${y}`)) {
          throw new Error(`Mountain placed outside region at (${x},${y})`);
        }
      }
    }
  });

  it('handles disconnected region (fills at least one component)', () => {
    const state = makeState(20, 20);
    const region = [];
    for (let y = 2; y <= 5; y++)
      for (let x = 2; x <= 5; x++)
        region.push({ x, y });
    for (let y = 12; y <= 15; y++)
      for (let x = 12; x <= 15; x++)
        region.push({ x, y });

    const result = generateMaze(state, 42, 1, 1, region, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);
  });

  it('generates maze for full map when no region specified', () => {
    const state = makeState(15, 15);
    const result = generateMaze(state, 42, 1, 1, null, simpleExecutor(state));
    expect(result.placed).toBeGreaterThan(0);
  });

  // Through the REAL rule executor on a map with a non-grass (beach) border: no command is rejected and
  // the committed state is rule-clean at every elevation. Regression for the old bug where edge walls
  // tripped V-ZONE-01 (zone not buildable) and then floated a higher layer onto the bare cell.
  it('produces rule-valid terrain on a bordered map at every elevation (no zone / floating errors)', () => {
    for (const maxElev of [1, 2, 3]) {
      const state = makeState(40, 40);
      for (let i = 0; i < 40; i++) { setZone(state, i, 0, CellZone.Beach); setZone(state, i, 39, CellZone.Beach); setZone(state, 0, i, CellZone.Beach); setZone(state, 39, i, CellZone.Beach); }
      const bus = new EventBus<EditorEvents>();
      let fails = 0;
      bus.on('validation-failed', () => { fails++; });
      const exec = new CommandExecutor(state, bus, createDefaultRegistry());
      const start = exec.getUndoStackSize();
      const { placed, skipped } = generateMaze(state, 42, maxElev, 1, null, (c) => exec.execute(c));
      const postViol = exec.commitStrokeGroup(start).length;
      expect(placed, `maxElev ${maxElev} placed`).toBeGreaterThan(0);
      expect(skipped, `maxElev ${maxElev} skipped`).toBe(0);
      expect(fails, `maxElev ${maxElev} rejected commands`).toBe(0);
      expect(postViol, `maxElev ${maxElev} post-stroke`).toBe(0);
    }
  });
});
