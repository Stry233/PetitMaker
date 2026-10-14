/** Pins the editor layer's undo-depth reading and its rewind to a recorded watermark. */
import { describe, it, expect, vi } from 'vitest';
import { rewindTo, watchUndoDepth } from '../../../editor/operations';
import { EventBus } from '../../../core/commands/event-bus';
import type { CommandExecutor } from '../../../core/commands/command-executor';
import type { EditorEvents } from '../../../state/editing/events';

/** An undo stack of `depth` entries, each undo popping one. */
function stack(depth: number): CommandExecutor {
  let size = depth;
  return {
    historyDepth: () => size,
    undo: () => { if (size === 0) return false; size -= 1; return true; },
  } as unknown as CommandExecutor;
}

describe('rewindTo', () => {
  it('undoes down to the watermark and reports how many undos ran', () => {
    const executor = stack(7);
    expect(rewindTo(executor, 3)).toBe(4);
    expect(executor.historyDepth()).toBe(3);
  });

  it('runs nothing where the stack already stands at or below the watermark', () => {
    expect(rewindTo(stack(2), 3)).toBe(0);
  });
});

describe('watchUndoDepth', () => {
  it('reads the depth after each edit until unsubscribed', () => {
    const bus = new EventBus<EditorEvents>();
    const executor = stack(5);
    const seen = vi.fn();
    const off = watchUndoDepth(bus, executor, seen);
    bus.emit('cells-changed', undefined as never);
    expect(seen).toHaveBeenLastCalledWith(5);
    rewindTo(executor, 2);
    bus.emit('objects-changed', undefined as never);
    expect(seen).toHaveBeenLastCalledWith(2);
    off();
    bus.emit('cells-changed', undefined as never);
    expect(seen).toHaveBeenCalledTimes(2);
  });
});
