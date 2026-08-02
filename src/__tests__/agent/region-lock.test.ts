/**
 * A painted region is a boundary the agent cannot cross.
 *
 * The check sits in `runStroke`, the single chokepoint every write tool goes through, and it runs
 * AFTER each command applies — the bridge and ramp traits snap position during validation, so where
 * a command finally lands is only knowable once it has run.
 */
import { describe, it, expect } from 'vitest';
import { commandCells, runStroke } from '../../agent/tools/tools-common';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { createDefaultRegistry } from '../../rules/index';
import { CommandType, TerrainType } from '../../core/model/types';
import type { Command, EditorEvents, MacroCoord, PlacedObject } from '../../core/model/types';
import type { AgentToolDeps } from '../../agent/tools';
import { makeState } from '../rules/_helpers';

/** A 4x4 region in the top-left of a 12x12 map. */
const REGION: MacroCoord[] = [];
for (let y = 1; y <= 4; y++) for (let x = 1; x <= 4; x++) REGION.push({ x, y });

function world(region: MacroCoord[]) {
  const state = makeState(12, 12);
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry());
  const deps = {
    getState: () => state, getExecutor: () => executor, getRegion: () => region,
  } as unknown as AgentToolDeps;
  return { state, executor, deps };
}

const paint = (...cells: MacroCoord[]): Command => ({
  type: CommandType.PaintTerrain, timestamp: 0, cells, terrainType: TerrainType.Mountain, elevation: 1,
});

describe('with no region painted', () => {
  it('lets the agent work anywhere', () => {
    const { state, deps } = world([]);
    const r = runStroke(deps, [paint({ x: 9, y: 9 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(false);
    expect(state.cells[9]![9]!.terrain).not.toBeNull();
  });
});

describe('with a region painted', () => {
  it('applies an edit wholly inside it', () => {
    const { state, deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 2, y: 2 }, { x: 3, y: 3 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(false);
    expect(state.cells[2]![2]!.terrain).not.toBeNull();
  });

  it('refuses an edit that reaches outside, and applies NOTHING', () => {
    // All-or-nothing on purpose: a half-applied edit makes undo restore a state the user never saw.
    const { state, executor, deps } = world(REGION);
    const before = executor.getUndoStackSize();
    const r = runStroke(deps, [paint({ x: 2, y: 2 }, { x: 9, y: 9 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(true);
    expect(state.cells[2]![2]!.terrain).toBeNull();
    expect(state.cells[9]![9]!.terrain).toBeNull();
    expect(executor.getUndoStackSize()).toBe(before);
  });

  it('rolls back EARLIER commands in the same call when a later one strays', () => {
    const { state, deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 2, y: 2 }), paint({ x: 8, y: 2 })], (n) => `ok ${n}`);
    expect(r.isError).toBe(true);
    expect(state.cells[2]![2]!.terrain).toBeNull();
  });

  it('tells the model where it strayed and what the bounds are, so it can re-plan', () => {
    const { deps } = world(REGION);
    const r = runStroke(deps, [paint({ x: 9, y: 7 })], (n) => `ok ${n}`);
    expect(r.content).toContain('OUT OF REGION');
    expect(r.content).toContain('(9,7)');
    expect(r.content).toContain('(1,1)-(4,4)');
  });
});

describe('commandCells', () => {
  const obj = (x: number, y: number): PlacedObject => ({
    id: 'o1', catalogId: 'building-bamboo-cabin', position: { x, y }, rotation: 0, elevation: 0,
  });

  it('counts an object by its whole FOOTPRINT, not its anchor', () => {
    // A building whose corner is inside and whose body is outside is outside.
    const cells = commandCells({
      type: CommandType.PlaceObject, timestamp: 0, object: obj(4, 4), loadValue: 0,
    } as Command);
    expect(cells.length).toBeGreaterThan(1);
    expect(cells).toContainEqual({ x: 4, y: 4 });
    expect(cells.some((c) => c.x > 4 || c.y > 4)).toBe(true);
  });

  it('counts a removal by footprint too, so the agent cannot reach out and delete', () => {
    const cells = commandCells({
      type: CommandType.RemoveObject, timestamp: 0, objectId: 'o1', removedObject: obj(6, 6),
    } as Command);
    expect(cells).toContainEqual({ x: 6, y: 6 });
  });

  it('reads terrain commands as their own cell list', () => {
    expect(commandCells(paint({ x: 1, y: 2 }, { x: 3, y: 4 })))
      .toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  });
});
