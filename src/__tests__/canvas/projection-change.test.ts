/** A map-following overlay hears the camera, the window, a view swap and, by choice, map edits. */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { getActiveView, onProjectionChange, setActiveView } from '../../canvas/active-view';
import { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../../core/model/types';

afterEach(() => { setActiveView(null); });

function fire(bus: EventBus<EditorEvents>): void {
  bus.emit('viewport-changed', { zoom: 1 });
  window.dispatchEvent(new Event('resize'));
  setActiveView(getActiveView());
  bus.emit('cells-changed', { cells: [] });
  bus.emit('objects-changed', {});
}

describe('onProjectionChange', () => {
  it('follows the camera, the window, the view and terrain edits by default, without arguments', () => {
    const bus = new EventBus<EditorEvents>();
    const fn = vi.fn();
    const off = onProjectionChange(bus, fn);
    fire(bus);
    expect(fn).toHaveBeenCalledTimes(4);
    for (const call of fn.mock.calls) expect(call).toEqual([]);
    off();
    fire(bus);
    expect(fn).toHaveBeenCalledTimes(4);
  });

  it('adds object edits or leaves terrain edits out on request', () => {
    const bus = new EventBus<EditorEvents>();
    const withObjects = vi.fn();
    const withoutCells = vi.fn();
    const offs = [onProjectionChange(bus, withObjects, { objects: true }), onProjectionChange(bus, withoutCells, { cells: false })];
    fire(bus);
    for (const off of offs) off();
    expect(withObjects).toHaveBeenCalledTimes(5);
    expect(withoutCells).toHaveBeenCalledTimes(3);
  });
});
