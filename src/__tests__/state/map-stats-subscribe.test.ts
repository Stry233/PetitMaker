/**
 * `subscribeMapStats`'s rAF coalescing, exercised against a deterministic fake rAF queue
 * (id-keyed, so cancellation is real rather than merely spied-on).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { bumpCellsVersion, getCell } from '../../core/model/grid-model';
import { EventBus } from '../../core/commands/event-bus';
import { TerrainType, type EditorEvents, type GridState } from '../../core/model/types';
import { getMapStats, subscribeMapStats } from '../../state/map-stats';
import { makeState } from '../rules/_helpers';

function raise(state: GridState, x: number, y: number, elevation: number): void {
  const cell = getCell(state.cells, x, y)!;
  cell.terrain = { type: TerrainType.Mountain, elevation };
  bumpCellsVersion(state);
}

let queue: Map<number, FrameRequestCallback>;
let nextId: number;

function flush(): void {
  const due = [...queue.values()];
  queue.clear();
  for (const cb of due) cb(0);
}

beforeEach(() => {
  queue = new Map();
  nextId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = ++nextId;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { queue.delete(id); });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('subscribeMapStats', () => {
  it('coalesces a burst of changes into exactly one callback, reflecting all of them', () => {
    const bus = new EventBus<EditorEvents>();
    const state = makeState();
    const received: number[] = [];
    const unsub = subscribeMapStats(bus, () => state, (stats) => received.push(stats.cellsByLayer[1] ?? 0));

    raise(state, 1, 1, 1);
    bus.emit('cells-changed', { cells: [{ x: 1, y: 1 }] });
    raise(state, 2, 2, 1);
    bus.emit('cells-changed', { cells: [{ x: 2, y: 2 }] });
    raise(state, 3, 3, 1);
    bus.emit('objects-changed', {});

    expect(queue.size).toBe(1); // one rAF for the whole burst, not one per emission
    flush();

    expect(received).toEqual([3]); // exactly one callback, carrying every raise in the burst
    unsub();
  });

  it('unsubscribe cancels an already-scheduled rAF and stops further callbacks', () => {
    const bus = new EventBus<EditorEvents>();
    const state = makeState();
    const cb = vi.fn();
    const unsub = subscribeMapStats(bus, () => state, cb);

    bus.emit('cells-changed', { cells: [] });
    expect(queue.size).toBe(1);

    unsub();
    expect(queue.size).toBe(0); // the pending frame was cancelled, not merely ignored

    flush();
    expect(cb).not.toHaveBeenCalled();
  });

  it('reads state at fire time: a map swapped in after subscribing is what the callback sees', () => {
    const bus = new EventBus<EditorEvents>();
    let state: GridState | null = makeState();
    const seen: number[] = [];
    const unsub = subscribeMapStats(bus, () => state, (stats) => seen.push(stats.cellsByLayer[1] ?? 0));

    const replacement = makeState();
    raise(replacement, 5, 5, 2);
    state = replacement; // simulates initMap/loadMap installing a new grid mid-subscription
    bus.emit('cells-changed', { cells: [{ x: 5, y: 5 }] });
    flush();

    expect(seen).toEqual([1]); // reflects the replacement grid's raised cell, not the original (empty) one
    unsub();
  });

  it('skips the frame when getState returns null (no map loaded)', () => {
    const bus = new EventBus<EditorEvents>();
    const cb = vi.fn();
    const unsub = subscribeMapStats(bus, () => null, cb);

    bus.emit('cells-changed', { cells: [] });
    flush();

    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it('two subscribers in one frame cost only one derivation walk (the second is a memo hit)', () => {
    const bus = new EventBus<EditorEvents>();
    const state = makeState();

    const unsubA = subscribeMapStats(bus, () => state, () => {});
    const unsubB = subscribeMapStats(bus, () => state, () => {});

    raise(state, 4, 4, 2);
    bus.emit('cells-changed', { cells: [{ x: 4, y: 4 }] });
    expect(queue.size).toBe(2); // each subscription runs its own independent rAF

    // Count derivation WORK directly: walkTerrain reads one row per map height. A Proxy over
    // `cells` counts those reads, so a second walk inside the same frame would double the tally
    // no matter which subscriber's rAF callback runs first.
    let rowReads = 0;
    const realCells = state.cells;
    state.cells = new Proxy(realCells, {
      get(target, prop, receiver) {
        if (typeof prop === 'string' && /^\d+$/.test(prop)) rowReads++;
        return Reflect.get(target, prop, receiver);
      },
    });

    flush();

    expect(rowReads).toBe(state.template.height); // exactly one walk's worth of row reads, not two
    expect(getMapStats(state).cellsByLayer[1]).toBe(1);

    unsubA();
    unsubB();
  });
});
