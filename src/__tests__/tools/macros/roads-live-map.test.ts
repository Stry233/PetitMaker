/**
 * The roads macro on a REAL map: hexia, its locked plaza standing, two houses placed by hand.
 *
 * This is the scenario the button exists for, and it laid nothing for as long as the network seed
 * was marked from the plaza's own FRACTIONAL rect — `forEachFootprintCell` visited half-cell
 * coordinates, the seed became grid indices no integer lookup finds, and every route "failed to
 * reach the network". A square test map without a plaza could never see it.
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

describe('roads on a live map', () => {
  it('connects two hand-placed houses past the fractional plaza', () => {
    const template = getMapTemplate('hexia');
    const state = {
      template, cells: createGrid(template), objects: new Map(), lockedLayers: new Set(),
    } as unknown as GridState;
    const plaza = createPlazaObject(template);
    expect(plaza, 'the scenario needs the plaza standing').not.toBeNull();
    state.objects.set(plaza!.id, plaza!);
    // The plaza's sub-block rect is the whole point of this fixture.
    expect(Number.isInteger(plaza!.position.x)).toBe(false);

    const exec = new CommandExecutor(state, new EventBus<EditorEvents>(), createDefaultRegistry(), roadLookup(state));
    const ctx = { state, executor: exec, registry: exec.getRegistry() };
    const place = (catalogId: string, x: number, y: number): void => {
      const obj = { id: generateObjectId(), catalogId, position: { x, y }, rotation: 0 as const, elevation: 0 };
      expect(exec.execute({ type: CommandType.PlaceObject, timestamp: 1, object: obj, loadValue: 0 }).success).toBe(true);
    };
    place('building-myhouse', 40, 40);
    place('building-stall', 55, 48);

    const outcome = applyMacro(ctx, 'roads', { seed: 3 });
    expect(outcome.changes, outcome.reason ?? '').toBeGreaterThan(0);
    const roads = [...state.objects.values()].filter((o) => categoryOf(o) === ItemCategory.Road);
    expect(roads.length, 'the network is paved, not merely reported').toBeGreaterThan(0);
  });
});
