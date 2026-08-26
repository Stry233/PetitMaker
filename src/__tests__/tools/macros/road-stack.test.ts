/**
 * Regression: the roads macro must never stack a second road object on a cell that already
 * carries one — whether the duplicate comes from a widened run's own dilation overlapping itself,
 * or from a later press landing on cells an earlier press already paved. V-PLACE-OVERLAP exempts
 * coatings from the overlap block (a road is meant to be coated OVER), so an unguarded placement
 * validates and stacks silently; only a floating road over a road makes that illegal in-game, and
 * a saved map holding one is corrupt (the share codec refuses it).
 */
import { describe, it, expect } from 'vitest';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { EventBus } from '../../../core/commands/event-bus';
import { CommandType, ItemCategory, type EditorEvents, type GridState } from '../../../core/model/types';
import { createGrid, createPlazaObject } from '../../../core/model/grid-model';
import { getMapTemplate } from '../../../config/maps';
import { createDefaultRegistry } from '../../../rules';
import { categoryOf } from '../../../state/catalog';
import { roadLookup } from '../../../state/object-index';
import { applyMacro } from '../../../tools/macros';
import { generateObjectId } from '../../../core/model/object-id';

/** Every road cell's occupant count, keyed "x,y" — >1 anywhere is the corruption this guards. */
function roadCountsByCell(state: GridState): Map<string, number> {
  const counts = new Map<string, number>();
  for (const o of state.objects.values()) {
    if (categoryOf(o) !== ItemCategory.Road) continue;
    const key = `${o.position.x},${o.position.y}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

function stackedCells(state: GridState): [string, number][] {
  return [...roadCountsByCell(state).entries()].filter(([, n]) => n > 1);
}

describe('roads macro: paving strips the coating it covers', () => {
  it('a widened run never places two road objects on one cell', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = createPlazaObject(template);
    state.objects.set(plaza!.id, plaza!);

    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const place = (catalogId: string, x: number, y: number): void => {
      const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0 };
      expect(exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 }).success).toBe(true);
    };
    place('building-myhouse', 40, 40);
    place('building-stall', 55, 48);

    // A width wider than the router's own 1-cell gauge dilates every fresh road tile into its
    // neighbours — the dilation of one tile routinely overlaps another's, and that overlap is exactly
    // where an unguarded place stacks two coatings on one cell.
    const outcome = applyMacro(ctx, 'roads', { seed: 3, width: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    expect(stackedCells(state)).toEqual([]);
  });

  it('two presses over the same area never leave a cell with more than one road', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = createPlazaObject(template);
    state.objects.set(plaza!.id, plaza!);

    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const place = (catalogId: string, x: number, y: number): void => {
      const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0 };
      expect(exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 }).success).toBe(true);
    };
    place('building-myhouse', 40, 40);
    place('building-stall', 55, 48);

    applyMacro(ctx, 'roads', { seed: 3, width: 2 });
    expect(stackedCells(state)).toEqual([]);
    // Pressing again (a reroll, the shell's own repeated-press grammar): whatever the second pass
    // pours over the first, no cell may end up holding two coatings.
    applyMacro(ctx, 'roads', { seed: 4, width: 2 });
    expect(stackedCells(state)).toEqual([]);
  });
});
