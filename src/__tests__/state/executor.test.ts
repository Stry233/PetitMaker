/** An executor built for a map answers road questions about that map. */
import { describe, it, expect } from 'vitest';
import { EventBus } from '../../core/commands/event-bus';
import { ItemCategory, type EditorEvents } from '../../core/model/types';
import { createDefaultRegistry } from '../../rules/index';
import { getPlaceableByCategory } from '../../state/catalog';
import { createExecutor } from '../../state/executor';
import { makeState } from '../rules/_helpers';

describe('createExecutor', () => {
  it('binds the roads of its map and the given bus, or a fresh one', () => {
    const state = makeState();
    const road = getPlaceableByCategory(ItemCategory.Road)[0]!.id;
    state.objects.set('r1', { id: 'r1', catalogId: road, position: { x: 3, y: 3 }, rotation: 0, elevation: 0 });
    const bus = new EventBus<EditorEvents>();
    const seen: string[] = [];
    bus.on('history-changed', () => { seen.push('history'); });
    const executor = createExecutor(state, createDefaultRegistry(), bus);
    expect(executor.roadAt(3, 3)?.id).toBe('r1');
    executor.restoreHistory([]);
    expect(seen).toEqual(['history']);
    expect(() => createExecutor(state, createDefaultRegistry()).restoreHistory([])).not.toThrow();
  });
});
