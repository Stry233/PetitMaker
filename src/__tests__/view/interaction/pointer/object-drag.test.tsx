// @vitest-environment jsdom
/**
 * A drop that throws part-way through its commit leaves the map and the history as they were:
 * the lifted object stands where it stood, and no half-made stroke group stays on the stack.
 * A drop also ends the press: the tap it would have been never settles on a later release.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../../view/active-view';
import { __resetCursorController } from '../../../../view/interaction/cursor-controller';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { CommandType, type GridState, type PlacedObject } from '../../../../core/model/types';
import type { CommandExecutor } from '../../../../core/commands/command-executor';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import { ToolType } from '../../../../state/editing/vocabulary';
import { useEditorStore } from '../../../../state/store';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../../_support/tool-manager';
import { makeExecutor, makeState } from '../../../_support/map-state';
import { setStoreState, armedEditMode } from '../../../_support/store';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';

/** 1 cell = 10 screen px. */
function makeView(): ActiveView {
  return {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay: {
      showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(), showSelection: vi.fn(), clearSelection: vi.fn(),
      showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(), showPlacementGhost: vi.fn(), showObjectMove: vi.fn(),
    },
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    plopObject: vi.fn(),
  } as unknown as ActiveView;
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

function pointer(target: EventTarget, type: string, at: { x: number; y: number }): void {
  target.dispatchEvent(new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: at.x, clientY: at.y,
  }));
}

const TREE: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;
const thrown: unknown[] = [];
const onError = (e: ErrorEvent) => { thrown.push(e.error); e.preventDefault(); };

beforeEach(() => {
  __resetCursorController();
  thrown.length = 0;
  window.addEventListener('error', onError);
  gs = makeState(20, 20);
  gs.objects.set(TREE.id, { ...TREE });
  bumpObjectsVersion(gs, { added: [TREE] });
  executor = makeExecutor(gs);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  setActiveView(makeView());
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [{ kind: 'object', id: TREE.id }],
    selectingRegion: false, contextMenu: null, ...armedEditMode({ tool: ToolType.ObjectPlacer, item: null }),
  });
  el = render(<Host />).getByTestId('canvas');
});

afterEach(() => {
  window.removeEventListener('error', onError);
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  vi.restoreAllMocks();
});

function dragTree(): void {
  pointer(el, 'pointerdown', { x: 55, y: 55 });
  pointer(window, 'pointermove', { x: 85, y: 85 });
  pointer(window, 'pointerup', { x: 85, y: 85 });
}

describe('dropping a dragged object', () => {
  it('moves it as one undo step (control)', () => {
    dragTree();
    expect(gs.objects.get(TREE.id)?.position).toEqual({ x: 8, y: 8 });
    expect(executor.historyDepth()).toBe(1);
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: TREE.id }]);
  });

  it('leaves the map and the history unchanged when the commit throws part-way', () => {
    const execute = executor.execute.bind(executor);
    vi.spyOn(executor, 'execute').mockImplementation((cmd) => {
      if (cmd.type === CommandType.PlaceObject) throw new Error('place failed');
      return execute(cmd);
    });
    dragTree();
    expect(thrown).toHaveLength(1);
    expect(gs.objects.get(TREE.id)?.position).toEqual({ x: 5, y: 5 });
    expect(executor.historyDepth()).toBe(0);
    expect(executor.canRedo()).toBe(false);
    vi.restoreAllMocks();
    // The next drop is its own undo step, not folded into a stroke the failed one left open.
    dragTree();
    expect(gs.objects.get(TREE.id)?.position).toEqual({ x: 8, y: 8 });
    expect(executor.historyDepth()).toBe(1);
  });
});

describe('after a drop', () => {
  it('keeps the selection through a later press and release outside the canvas', () => {
    dragTree();
    // A panel control, or the other view's canvas: this machine never sees the press, only the
    // window's release.
    const elsewhere = document.body.appendChild(document.createElement('button'));
    pointer(elsewhere, 'pointerdown', { x: 300, y: 300 });
    pointer(elsewhere, 'pointerup', { x: 300, y: 300 });
    elsewhere.remove();
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: TREE.id }]);
  });
});
