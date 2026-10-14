/**
 * The drag-to-move session with no view behind it: the grab offset follows the pointer, the
 * preview draws the drop the release would make, a plural selection moves as one group, and a
 * refused drop reports and leaves the map alone.
 */
import { describe, it, expect, vi } from 'vitest';
import { ObjectDragSession, type ObjectDragPort, type ObjectDragView } from '../../../../tools/pointer/objects/drag-session';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import type { GridState, PlacedObject, Refusal } from '../../../../core/model/types';
import type { BlockRef } from '../../../../state/selection';
import { makeExecutor, makeState } from '../../../_support/map-state';
import { point } from '../../../_support/grid';

const tree = (id: string, x: number, y: number): PlacedObject => ({ id, catalogId: 'tree-apple', position: { x, y }, rotation: 0, elevation: 0 });

function world(objects: PlacedObject[], selection: BlockRef[]) {
  const state: GridState = makeState(20, 20);
  for (const o of objects) state.objects.set(o.id, { ...o });
  bumpObjectsVersion(state, { added: objects });
  const executor = makeExecutor(state);
  let selected = selection;
  const refusals: Refusal[] = [];
  const port: ObjectDragPort = {
    state: () => state,
    executor: () => executor,
    selection: () => selected,
    setSelection: (blocks) => { selected = blocks; },
    report: (refusal) => { if (refusal) refusals.push(refusal); },
  };
  const view = { overlay: { showGhost: vi.fn(), showObjectMove: vi.fn() }, plopObject: vi.fn() } satisfies ObjectDragView;
  return { state, executor, port, view, refusals, selection: () => selected };
}

describe('ObjectDragSession', () => {
  it('moves a lone object by the pointer, keeping the cell it was grabbed by', () => {
    const w = world([tree('a', 5, 5)], [{ kind: 'object', id: 'a' }]);
    const session = new ObjectDragSession(w.port);
    expect(session.begin('a', point({ x: 5.5, y: 5.5 }), { x: 5, y: 5 })).toBe(true);
    session.preview(w.view, point({ x: 9.5, y: 7.5 }));
    expect(w.view.overlay.showObjectMove).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a', position: { x: 9, y: 7 } })], true);
    session.commit(w.view, point({ x: 9.5, y: 7.5 }));
    expect(w.state.objects.get('a')!.position).toEqual({ x: 9, y: 7 });
    expect(w.selection()).toEqual([{ kind: 'object', id: 'a' }]);
    expect(session.objectId).toBeNull();
    expect(w.executor.historyDepth()).toBe(1);
  });

  it('previews once per cell the pointer reaches', () => {
    const w = world([tree('a', 5, 5)], [{ kind: 'object', id: 'a' }]);
    const session = new ObjectDragSession(w.port);
    session.begin('a', point({ x: 5.2, y: 5.2 }), { x: 5, y: 5 });
    session.preview(w.view, point({ x: 8.1, y: 5.1 }));
    session.preview(w.view, point({ x: 8.7, y: 5.9 }));
    expect(w.view.overlay.showObjectMove).toHaveBeenCalledTimes(1);
  });

  it('moves a plural selection as one group with a landing cue per member', () => {
    const w = world([tree('a', 2, 2), tree('b', 4, 2)], [{ kind: 'object', id: 'a' }, { kind: 'object', id: 'b' }]);
    const session = new ObjectDragSession(w.port);
    session.begin('a', point({ x: 2.5, y: 2.5 }), { x: 2, y: 2 });
    session.preview(w.view, point({ x: 2.5, y: 8.5 }));
    const [members, valid] = w.view.overlay.showObjectMove.mock.calls[0]!;
    expect(valid).toBe(true);
    expect(members.map((m: PlacedObject) => m.position)).toEqual([{ x: 2, y: 8 }, { x: 4, y: 8 }]);
    session.commit(w.view, point({ x: 2.5, y: 8.5 }));
    expect(w.state.objects.get('a')!.position).toEqual({ x: 2, y: 8 });
    expect(w.state.objects.get('b')!.position).toEqual({ x: 4, y: 8 });
    expect(w.view.plopObject).toHaveBeenCalledTimes(2);
  });

  it('reports a refused drop and leaves the object where it stood', () => {
    const w = world([tree('a', 5, 5), tree('b', 9, 5)], [{ kind: 'object', id: 'a' }]);
    const session = new ObjectDragSession(w.port);
    session.begin('a', point({ x: 5.5, y: 5.5 }), { x: 5, y: 5 });
    session.preview(w.view, point({ x: 9.5, y: 5.5 }));
    expect(w.view.overlay.showObjectMove).toHaveBeenLastCalledWith([expect.anything()], false);
    session.commit(w.view, point({ x: 9.5, y: 5.5 }));
    expect(w.refusals).toHaveLength(1);
    expect(w.state.objects.get('a')!.position).toEqual({ x: 5, y: 5 });
    expect(w.executor.historyDepth()).toBe(0);
  });

  it('commits nothing after a cancel, and begins nothing on an object that is gone', () => {
    const w = world([tree('a', 5, 5)], [{ kind: 'object', id: 'a' }]);
    const session = new ObjectDragSession(w.port);
    expect(session.begin('missing', null, { x: 0, y: 0 })).toBe(false);
    session.begin('a', null, { x: 5, y: 5 });
    session.cancel();
    session.commit(w.view, point({ x: 9.5, y: 9.5 }));
    expect(w.state.objects.get('a')!.position).toEqual({ x: 5, y: 5 });
  });
});
