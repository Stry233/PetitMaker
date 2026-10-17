/**
 * `objects-changed` held across a multi-command executor operation: a transaction, a rollback, an
 * undo or redo publish their object changes once they close, merged only where a listener applying
 * each event's removals before its additions still reaches the map as it stands.
 */
import { describe, expect, it } from 'vitest';
import { EventBus } from '../../../core/commands/event-bus';
import type { KernelEvents } from '../../../core/commands/events';
import { holdObjectChanges } from '../../../core/commands/held-object-changes';
import { placeObjectCommand, removeObjectCommand } from '../../../core/model/command-build';
import type { GridState, PlacedObject } from '../../../core/model/types';
import { bareExecutor } from '../../_support/kernel';
import { makeObject, makeState } from '../../_support/map-state';

type Change = KernelEvents['objects-changed'];

function recorder(bus: EventBus<KernelEvents>): { changes: Change[]; order: string[] } {
  const changes: Change[] = [];
  const order: string[] = [];
  bus.on('objects-changed', (e) => { changes.push(e); order.push('objects-changed'); });
  bus.on('cells-changed', () => order.push('cells-changed'));
  return { changes, order };
}

/** What a listener holds after applying every change, removals first, as a renderer does. */
function mirrorOf(start: Iterable<PlacedObject>, changes: readonly Change[]): Map<string, PlacedObject> {
  const m = new Map([...start].map((o) => [o.id, o]));
  for (const c of changes) {
    for (const id of c.removed ?? []) m.delete(id);
    for (const o of c.added ?? []) m.set(o.id, o);
  }
  return m;
}

const sameObjects = (a: Map<string, PlacedObject>, state: GridState) =>
  a.size === state.objects.size && [...state.objects.values()].every((o) => JSON.stringify(a.get(o.id)) === JSON.stringify(o));

describe('holdObjectChanges', () => {
  const a = makeObject('a', 1, 1), b = makeObject('b', 2, 2);

  it('passes changes straight through while no hold is open', () => {
    const bus = new EventBus<KernelEvents>();
    const { changes } = recorder(bus);
    const hold = holdObjectChanges(bus);
    hold.sink.emit('objects-changed', { added: [a] });
    expect(changes).toEqual([{ added: [a] }]);
  });

  it('publishes a hold as one change when the outermost hold closes', () => {
    const bus = new EventBus<KernelEvents>();
    const { changes, order } = recorder(bus);
    const hold = holdObjectChanges(bus);
    hold.hold(() => {
      hold.sink.emit('objects-changed', { removed: ['a'] });
      hold.hold(() => hold.sink.emit('objects-changed', { removed: ['b'] }));
      hold.sink.emit('cells-changed', { cells: [] });
      hold.sink.emit('objects-changed', { added: [a] });
      hold.sink.emit('objects-changed', { added: [b] });
      expect(changes).toEqual([]);
    });
    expect(changes).toEqual([{ removed: ['a', 'b'], added: [a, b] }]);
    // Cells are never held: a listener that repairs the map as cells change still runs in time.
    expect(order).toEqual(['cells-changed', 'objects-changed']);
  });

  it('starts a new change where merging would misread the order', () => {
    const bus = new EventBus<KernelEvents>();
    const { changes } = recorder(bus);
    const hold = holdObjectChanges(bus);
    hold.hold(() => {
      hold.sink.emit('objects-changed', { added: [a] });
      // Removing what was just added: removals-first would add it back.
      hold.sink.emit('objects-changed', { removed: ['a'] });
      // Adding one id twice.
      hold.sink.emit('objects-changed', { added: [b] });
      hold.sink.emit('objects-changed', { added: [{ ...b, rotation: 90 }] });
    });
    expect(changes).toEqual([{ added: [a] }, { removed: ['a'], added: [b] }, { added: [{ ...b, rotation: 90 }] }]);
  });

  it('keeps changes of different causes apart', () => {
    const bus = new EventBus<KernelEvents>();
    const { changes } = recorder(bus);
    const hold = holdObjectChanges(bus);
    hold.hold(() => {
      hold.sink.emit('objects-changed', { removed: ['a'], cause: 'turn' });
      hold.sink.emit('objects-changed', { removed: ['b'] });
    });
    expect(changes).toEqual([{ removed: ['a'], cause: 'turn' }, { removed: ['b'] }]);
  });

  it('publishes what it held when the body throws', () => {
    const bus = new EventBus<KernelEvents>();
    const { changes } = recorder(bus);
    const hold = holdObjectChanges(bus);
    expect(() => hold.hold(() => {
      hold.sink.emit('objects-changed', { removed: ['a'] });
      throw new Error('boom');
    })).toThrow('boom');
    expect(changes).toEqual([{ removed: ['a'] }]);
  });
});

describe('the executor holds object changes across one operation', () => {
  function seeded(n: number) {
    const state = makeState(40, 40);
    const objects = Array.from({ length: n }, (_, i) => makeObject(`o${i}`, i, 0));
    for (const o of objects) state.objects.set(o.id, { ...o, position: { ...o.position } });
    const bus = new EventBus<KernelEvents>();
    const rec = recorder(bus);
    return { state, objects, bus, rec, ex: bareExecutor(state, { bus }) };
  }

  it('announces a transaction of many commands once, and a mirror of it matches the map', () => {
    const { state, objects, rec, ex } = seeded(20);
    const start = [...state.objects.values()];
    ex.transaction({}, (tx) => {
      for (const o of objects) ex.execute(removeObjectCommand(o));
      for (const o of objects) ex.execute(placeObjectCommand({ ...o, position: { x: o.position.x, y: 5 } }));
      tx.commit();
    });
    expect(rec.changes).toHaveLength(1);
    expect(sameObjects(mirrorOf(start, rec.changes), state)).toBe(true);
    expect(state.objects.get('o3')?.position).toEqual({ x: 3, y: 5 });

    const before = [...state.objects.values()];
    rec.changes.length = 0;
    ex.undo();
    expect(rec.changes).toHaveLength(1);
    expect(sameObjects(mirrorOf(before, rec.changes), state)).toBe(true);
    expect(state.objects.get('o3')?.position).toEqual({ x: 3, y: 0 });
  });

  it('announces a rolled-back transaction as its net change', () => {
    const { state, objects, rec, ex } = seeded(5);
    const start = [...state.objects.values()];
    ex.transaction({}, (tx) => {
      for (const o of objects) ex.execute(removeObjectCommand(o));
      tx.rollback();
    });
    expect(sameObjects(mirrorOf(start, rec.changes), state)).toBe(true);
    expect(state.objects.size).toBe(5);
  });

  it('announces each command at once outside a transaction', () => {
    const { objects, rec, ex } = seeded(3);
    const tx = ex.beginStroke();
    for (const o of objects) {
      ex.execute(removeObjectCommand(o));
      expect(rec.changes.at(-1)).toEqual({ removed: [o.id] });
    }
    tx.commit();
    expect(rec.changes).toHaveLength(3);
  });
});
