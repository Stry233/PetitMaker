/**
 * `objects-changed` held across one executor operation that issues many commands (a transaction, a
 * rollback, an undo or redo, a commit's revert) and published when the outermost one closes.
 *
 * A listener that does work proportional to the map or the selection on every `objects-changed`
 * would otherwise cost commands times that work: a 500-object group move is 1,000 commands. Held
 * changes merge in order into as few events as keep the event's contract, that a listener applying
 * an event's removals before its additions reaches the map as it stands: a change merges into the
 * one before it only when both carry the same cause and it neither removes nor adds an id that one
 * already names. `cells-changed` and every other event pass straight through, so a listener that
 * repairs the map as cells change (the planet session's shore) still runs inside the operation.
 */
import type { EventBus, EventSink } from './event-bus';
import type { KernelEvents } from './events';
import type { PlacedObject } from '../model/types';

type ObjectsChanged = KernelEvents['objects-changed'];

interface HeldChange {
  removed: string[];
  added: PlacedObject[];
  removedIds: Set<string>;
  addedIds: Set<string>;
  cause: string | undefined;
}

export interface ObjectChangeHold {
  /** What the executor emits through: `objects-changed` is held while a hold is open. */
  readonly sink: EventSink<KernelEvents>;
  /** Runs `fn` with `objects-changed` held, publishing the held changes when the outermost hold
   *  closes, a throw included. */
  hold<T>(fn: () => T): T;
}

export function holdObjectChanges(bus: EventBus<KernelEvents>): ObjectChangeHold {
  let depth = 0;
  let held: HeldChange[] = [];

  const keep = (change: ObjectsChanged): void => {
    const removed = change.removed ?? [];
    const added = change.added ?? [];
    const last = held[held.length - 1];
    // Removing what the last one added, or naming an id twice on one side, would not survive the
    // removals-first reading; adding back what it removed (a move) does.
    const merges = last !== undefined && last.cause === change.cause
      && !removed.some((id) => last.addedIds.has(id) || last.removedIds.has(id))
      && !added.some((o) => last.addedIds.has(o.id));
    if (merges) {
      last.removed.push(...removed);
      last.added.push(...added);
      for (const id of removed) last.removedIds.add(id);
      for (const o of added) last.addedIds.add(o.id);
      return;
    }
    held.push({
      removed: [...removed], added: [...added],
      removedIds: new Set(removed), addedIds: new Set(added.map((o) => o.id)), cause: change.cause,
    });
  };

  const publish = (): void => {
    const out = held;
    held = [];
    for (const c of out) {
      bus.emit('objects-changed', {
        ...(c.removed.length > 0 ? { removed: c.removed } : {}),
        ...(c.added.length > 0 ? { added: c.added } : {}),
        ...(c.cause !== undefined ? { cause: c.cause } : {}),
      });
    }
  };

  return {
    sink: {
      emit(event, data) {
        if (event === 'objects-changed' && depth > 0) keep(data as ObjectsChanged);
        else bus.emit(event, data);
      },
    },
    hold(fn) {
      depth++;
      try {
        return fn();
      } finally {
        depth--;
        if (depth === 0) publish();
      }
    },
  };
}
