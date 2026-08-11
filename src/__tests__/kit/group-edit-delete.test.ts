/**
 * `deleteSelection` is the SINGLE call path behind every "delete this selection" (the keyboard
 * shortcut, SelectionHandles' group button, ContextMenu, DeletePopover): `deleteGroup` with the
 * poof bound in, re-deriving the surviving selection, and `reportDeleteGroup`. Before this, four
 * call sites threaded `poofRemoved` by hand as an OPTIONAL argument — a caller that forgot it lost
 * the removal animation with no type error.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { setActiveView } from '../../canvas/active-view';
import { EventBus } from '../../core/commands/event-bus';
import { PLAZA_ID } from '../../core/model/constants';
import { makeState, makeExecutor } from '../rules/_helpers';
import type { ActiveView } from '../../canvas/view-projection';
import type { EditorEvents, GridState, PlacedObject } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { deleteSelection } from '../../kit/group-edit';

const t = (key: string, params?: Record<string, string | number>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

const tree = (id: string, x: number, y: number): PlacedObject => ({
  id, catalogId: 'tree-apple', position: { x, y }, rotation: 0, elevation: 0,
});

const plaza = (): PlacedObject => ({
  id: PLAZA_ID, catalogId: PLAZA_ID, position: { x: 14, y: 14 }, width: 3, height: 3,
  rotation: 0, elevation: 0, locked: true,
});

function seed(state: GridState, ...objs: PlacedObject[]): void {
  for (const o of objs) state.objects.set(o.id, o);
}

function fakeView(animateRemove: (id: string) => void): ActiveView {
  return {
    projection: { screenToMacro: () => ({ x: 0, y: 0 }), screenToMicro: () => ({ x: 0, y: 0 }), cellToScreen: () => ({ x: 0, y: 0, scale: 1 }), pan: () => {} },
    overlay: {
      showGhost: () => {}, showGhostSpans: () => {}, clearGhost: () => {},
      showSelection: () => {}, clearSelection: () => {},
      showHover: () => {}, clearHover: () => {},
      flashCommit: () => {}, showBuildableRegion: () => {}, clearBuildableRegion: () => {},
      showBand: () => {}, clearBand: () => {},
    },
    applyCameraTransform: () => {},
    camera: { pan: () => {}, zoomStep: () => {}, zoomBy: () => {} },
    animateRemove,
  } as unknown as ActiveView;
}

afterEach(() => {
  setActiveView(null);
  useEditorStore.setState({ selection: [] });
});

describe('deleteSelection', () => {
  it('deletes what it can, plays the poof on every removed member, and selects only the survivors', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, tree('a', 4, 4), tree('b', 6, 6), plaza());
    const poofed: string[] = [];
    setActiveView(fakeView((id) => poofed.push(id)));
    const bus = new EventBus<EditorEvents>();

    const result = deleteSelection(exec, state, bus, t, ['a', 'b', PLAZA_ID]);

    expect(result.deleted).toBe(2);
    expect(result.kept).toBe(1);
    expect(poofed.sort()).toEqual(['a', 'b']);
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: PLAZA_ID }]);
  });

  it('reports the refusal through the event bus rather than the info toast, when nothing could go', () => {
    const state = makeState();
    const exec = makeExecutor(state);
    seed(state, plaza());
    let refused: unknown;
    const bus = new EventBus<EditorEvents>();
    bus.on('validation-failed', (e) => { refused = e; });

    const result = deleteSelection(exec, state, bus, t, [PLAZA_ID]);

    expect(result.deleted).toBe(0);
    expect(refused).toBeDefined();
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: PLAZA_ID }]);
  });
});
