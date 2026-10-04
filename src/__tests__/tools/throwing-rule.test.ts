/** A rule that throws part-way through a tool's stroke leaves the map and the undo stack as they were before that stroke. */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import { CommandType, type Command, type EditorEvents, type GridState, type PlacedObject } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules/index';
import { roadLookup } from '../../state/object-index';
import { deleteGroup } from '../../tools/objects/group-actions';
import { ObjectPlacerTool } from '../../tools/objects/object-placer';
import { MacroTool } from '../../tools/macros/macro-tool';
import type { ToolContext } from '../../tools/runtime/types';
import { makeState } from '../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from './_tool-ctx';

/** A live map whose pre-command rules include one that throws whenever `throws` says so. */
function world(throws: (cmd: Command, state: GridState) => boolean, size = 20) {
  const state = makeState(size, size);
  const registry = createDefaultRegistry();
  registry.register({
    id: 'T-THROW', phase: 'pre-command', appliesTo: [CommandType.PlaceObject, CommandType.RemoveObject],
    validate: (cmd, s) => { if (throws(cmd, s)) throw new Error('rule fault'); return []; },
  });
  const executor = new CommandExecutor(state, new EventBus<EditorEvents>(), registry, roadLookup(state));
  return { state, executor };
}

const house = (id: string, x: number, y: number): PlacedObject => ({ id, catalogId: 'building-cabin', position: { x, y }, rotation: 0, elevation: 0 });

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a throwing rule', () => {
  it('restores every member of a group delete and adds no undo entry', () => {
    const { state, executor } = world((cmd) => cmd.type === CommandType.RemoveObject && cmd.objectId === 'b');
    state.objects.set('a', house('a', 4, 4));
    state.objects.set('b', house('b', 8, 4));
    expect(() => deleteGroup(executor, state, ['a', 'b'])).toThrow('rule fault');
    expect([...state.objects.keys()].sort()).toEqual(['a', 'b']);
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it('brings back the road the placer stripped when the placement throws', () => {
    let placements = 0;
    const { state, executor } = world((cmd) => cmd.type === CommandType.PlaceObject && cmd.object.catalogId === 'building-stall' && ++placements === 2);
    state.objects.set('road', { id: 'road', catalogId: 'path-overgrown-dirt', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 });
    const ctx = makeToolCtx(state, executor, 1, 1, { armedItem: 'building-stall' });
    expect(() => new ObjectPlacerTool().onPointerDown({ x: 5, y: 5 }, { x: 5, y: 5 }, ctx)).toThrow('rule fault');
    expect(placements, 'the probe passed and the placement threw').toBe(2);
    expect(objectsByCatalog(state, 'path-overgrown-dirt')).toHaveLength(1);
    expect(objectsByCatalog(state, 'building-stall')).toHaveLength(0);
    expect(executor.getUndoStackSize()).toBe(0);
  });

  it('ends a planting spray at the faulted burst, keeps the earlier bursts as one step and stops the clock', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let armed = false;
    let live: GridState | null = null;
    const { state, executor } = world((cmd, s) => armed && s === live && cmd.type === CommandType.PlaceObject, 40);
    live = state;
    const ctx: ToolContext = makeToolCtx(state, executor, undefined, undefined, {
      armedMacro: 'patch-tree',
      overlay: { showGhost: vi.fn(), clearGhost: vi.fn() } as unknown as ToolContext['overlay'],
    });
    const tool = new MacroTool();
    tool.onActivate();

    tool.onPointerDown({ x: 10, y: 10 }, { x: 10, y: 10 }, ctx);
    const planted = state.objects.size;
    expect(planted).toBeGreaterThan(0);
    armed = true;
    vi.advanceTimersByTime(400);
    expect(console.error).toHaveBeenCalledTimes(1);
    armed = false;
    vi.advanceTimersByTime(2000);
    tool.onPointerMove({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    tool.onPointerUp({ x: 20, y: 20 }, { x: 20, y: 20 }, ctx);
    expect(state.objects.size, 'nothing planted after the fault').toBe(planted);
    expect(executor.getUndoStackSize()).toBe(1);
    executor.undo();
    expect(state.objects.size).toBe(0);
  });
});
