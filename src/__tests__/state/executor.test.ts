/** An executor built for a map answers road questions about that map. */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../core/commands/event-bus';
import { TerrainType } from '../../core/model/types';
import { paintTerrainCommand } from '../../core/model/command-build';
import { type EditorEvents } from '../../state/editing/events';
import { createDefaultRegistry } from '../../rules/index';
import { getPlaceableByCategory } from '../../state/catalog';
import { createExecutor } from '../../state/executor';
import { makeState } from '../_support/map-state';
import { ItemCategory } from '../../config/catalog/categories';

describe('createExecutor', () => {
  it('binds the roads of its map and the given bus, or a fresh one', () => {
    const state = makeState();
    const road = getPlaceableByCategory(ItemCategory.Road)[0]!.id;
    state.objects.set('r1', { id: 'r1', catalogId: road, position: { x: 3, y: 3 }, rotation: 0, elevation: 0 });
    const bus = new EventBus<EditorEvents>();
    const seen: string[] = [];
    bus.on('history-changed', () => { seen.push('history'); });
    const executor = createExecutor(state, createDefaultRegistry(), bus);
    executor.restoreHistory([]);
    expect(seen).toEqual(['history']);
    // Raising the ground under the road carries it up: the policy found it on this map.
    const stroke = executor.beginStroke();
    executor.execute(paintTerrainCommand([{ x: 3, y: 3 }, { x: 4, y: 3 }, { x: 3, y: 4 }, { x: 4, y: 4 }], TerrainType.Mountain, 1));
    stroke.commit();
    expect(state.objects.get('r1')?.elevation).toBe(1);
    expect(() => createExecutor(state, createDefaultRegistry()).restoreHistory([])).not.toThrow();
  });
});
