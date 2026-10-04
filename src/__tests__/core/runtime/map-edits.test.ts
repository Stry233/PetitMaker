/** One subscription hears every map edit, undo and redo included, and can coalesce to a frame. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import { onMapEdited } from '../../../core/runtime/map-edits';
import { CommandType, TerrainType, type EditorEvents } from '../../../core/model/types';
import { createDefaultRegistry } from '../../../rules/index';
import { createExecutor } from '../../../state/executor';
import { makeState } from '../../rules/_helpers';

afterEach(() => { vi.useRealTimers(); });

function world() {
  const state = makeState();
  const bus = new EventBus<EditorEvents>();
  const executor = createExecutor(state, createDefaultRegistry(), bus);
  const paint = () => {
    const start = executor.getUndoStackSize();
    executor.execute({ type: CommandType.PaintTerrain, timestamp: 0, cells: [{ x: 2, y: 2 }], terrainType: TerrainType.Mountain, elevation: 1 });
    executor.commitStroke(start);
  };
  return { bus, executor, paint };
}

describe('onMapEdited', () => {
  it('hears an edit, its undo and its redo, and stops once unsubscribed', () => {
    const { bus, executor, paint } = world();
    const fn = vi.fn();
    const off = onMapEdited(bus, fn);
    paint();
    const afterEdit = fn.mock.calls.length;
    expect(afterEdit).toBeGreaterThan(0);
    executor.undo();
    expect(fn.mock.calls.length).toBe(afterEdit + 1);
    executor.redo();
    expect(fn.mock.calls.length).toBe(afterEdit + 2);
    bus.emit('objects-changed', {});
    expect(fn.mock.calls.length).toBe(afterEdit + 3);
    off();
    paint();
    expect(fn.mock.calls.length).toBe(afterEdit + 3);
  });

  it('collapses a frame of edits into one call and drops a pending frame on unsubscribe', () => {
    vi.useFakeTimers({ toFake: ['requestAnimationFrame', 'cancelAnimationFrame'] });
    const { bus, paint } = world();
    const fn = vi.fn();
    const off = onMapEdited(bus, fn, { frame: true });
    paint();
    paint();
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersToNextFrame();
    expect(fn).toHaveBeenCalledTimes(1);
    paint();
    off();
    vi.advanceTimersToNextFrame();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
