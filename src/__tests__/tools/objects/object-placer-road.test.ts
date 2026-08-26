import { describe, it, expect } from 'vitest';
import { ObjectPlacerTool } from '../../../tools/objects/object-placer';
import { objectRect } from '../../../state/object-geometry';
import { placementOverlapRule } from '../../../rules/placement-overlap';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { createDefaultRegistry } from '../../../rules/index';
import {
  CommandType, type EditorEvents, type MacroCoord, type PlaceObjectCommand,
} from '../../../core/model/types';
import { makeState } from '../../rules/_helpers';
import { makeToolCtx, objectsByCatalog } from '../_tool-ctx';
import { roadLookup } from '../../../state/object-index';

const m = (x: number, y: number): MacroCoord => ({ x, y });
const exec = (s: any) => new CommandExecutor(s, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(s));
const addRoad = (state: any, x: number, y: number, id = `road-${x}-${y}`) =>
  state.objects.set(id, { id, catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation: 0 });
const addStall = (state: any, x: number, y: number, id = `blocker-${x}-${y}`) =>
  state.objects.set(id, { id, catalogId: 'building-stall', position: { x, y }, rotation: 0, elevation: 0 });

// A building placed over a road removes the road. The removal must be tied to the placement: it happens
// ONLY if the placement is legal, and the two undo together as one step (never leave the road gone with
// no building on top).
describe('ObjectPlacerTool: placing over a road', () => {
  it('legal placement strips the road and places the building as ONE undo step', () => {
    const state = makeState(20, 20);
    const ex = exec(state);
    addRoad(state, 5, 5);
    const tool = new ObjectPlacerTool();
    const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: 'building-stall' });
    const before = ex.getUndoStackSize();

    tool.onPointerDown(m(5, 5), m(5, 5), ctx);

    expect(objectsByCatalog(state, 'path-overgrown-dirt'), 'road coated over').toHaveLength(0);
    expect(objectsByCatalog(state, 'building-stall'), 'building placed').toHaveLength(1);
    expect(ex.getUndoStackSize(), 'road removal + placement = ONE undo entry').toBe(before + 1);

    ex.undo();
    expect(objectsByCatalog(state, 'path-overgrown-dirt'), 'undo restores the road').toHaveLength(1);
    expect(objectsByCatalog(state, 'building-stall'), 'undo removes the building').toHaveLength(0);
  });

  it('rejected placement leaves the road untouched (no orphaned removal)', () => {
    const state = makeState(20, 20);
    const ex = exec(state);
    addRoad(state, 5, 5);
    addStall(state, 5, 5); // a real building already here → V-PLACE-OVERLAP rejects the new one
    const tool = new ObjectPlacerTool();
    const ctx = makeToolCtx(state, ex, 1, 1, { armedItem: 'building-stall' });
    const before = ex.getUndoStackSize();

    tool.onPointerDown(m(5, 5), m(5, 5), ctx);

    expect(objectsByCatalog(state, 'path-overgrown-dirt'), 'road survives a rejected placement').toHaveLength(1);
    expect(objectsByCatalog(state, 'building-stall'), 'only the pre-existing blocker remains').toHaveLength(1);
    expect(ex.getUndoStackSize(), 'nothing committed').toBe(before);
  });
});

// The overlap rule treats a surface coating as coat-over-able: it never blocks placement (so the ghost
// reads valid over a road), while a real object still blocks.
describe('V-PLACE-OVERLAP: surface coatings do not block', () => {
  const placeStallAt = (x: number, y: number): PlaceObjectCommand => ({
    type: CommandType.PlaceObject, timestamp: 0,
    object: { id: 'new', catalogId: 'building-stall', position: { x, y }, rotation: 0, elevation: 0 },
    loadValue: 0,
  });

  it('a road under the footprint is not an overlap', () => {
    const state = makeState(20, 20);
    addRoad(state, 5, 5);
    expect(placementOverlapRule.validate(placeStallAt(5, 5), state)).toHaveLength(0);
  });

  it('a real object under the footprint still blocks', () => {
    const state = makeState(20, 20);
    addStall(state, 5, 5);
    expect(placementOverlapRule.validate(placeStallAt(5, 5), state).length).toBeGreaterThan(0);
  });

  it('objectRect is exported for the rule to measure footprints', () => {
    expect(objectRect({ id: 'x', catalogId: 'building-stall', position: { x: 1, y: 1 }, rotation: 0, elevation: 0 } as any)).toBeTruthy();
  });
});
