// @vitest-environment jsdom
/**
 * One finger on the map in touch mode, through the map's own pointer machine over a mounted
 * canvas: a press waits to learn whether it is a tap, a drag or a long press before it acts. The
 * map is a spec world the editor store holds; a cell is ten screen pixels.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { TerrainType, world, type SpecWorld } from '../_world';
import { objectsOf, placeItem } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { getActiveToolManager, registerToolManager, setActiveView } from '../../../view/active-view';
import { GRIDS } from '../../../core/game/profile';
import { gridCellCentre } from '../../../core/grid/grids';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { useEditorStore } from '../../../state/store';
import { selectedObjectIds } from '../../../state/selection';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

const TREE = 'tree-apple';
const noop = (): void => {};
/** Every overlay call the view received, by method name. */
const drawn: string[] = [];
const overlay = new Proxy({} as ToolOverlay, { get: (_t, name) => () => { drawn.push(String(name)); } });
const pan = vi.fn();
const zoomStep = vi.fn();
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan, zoomStep, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let unsync: (() => void) | null = null;
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });

/** One finger event at cell `c`; `pointerType` is not a MouseEvent field, so it is defined on the instance. */
function finger(target: EventTarget, type: string, c: MacroCoord): void {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...screen(c) });
  Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 1 } });
  act(() => { target.dispatchEvent(event); });
}
const down = (c: MacroCoord) => finger(canvas, 'pointerdown', c);
const move = (c: MacroCoord) => finger(window, 'pointermove', c);
const up = (c: MacroCoord) => finger(window, 'pointerup', c);

const selected = () => selectedObjectIds(useEditorStore.getState().selection);

/** Open `w` in the editor armed as `arming` (the Hand tool by default), the live tool manager over it. */
function open(w: SpecWorld, arming: Parameters<typeof armedEditMode>[0] = { tool: ToolType.Hand }): void {
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode(arming) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
}

/** Two trees on open ground, opened in the editor. */
function twoTrees(): { w: SpecWorld; at: MacroCoord; a: PlacedObject; b: PlacedObject } {
  const w = world();
  const at = w.openGround(10, 6);
  const a = placeItem(w, TREE, { x: at.x + 1, y: at.y + 1 })!;
  const b = placeItem(w, TREE, { x: at.x + 5, y: at.y + 1 })!;
  open(w);
  return { w, at, a, b };
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  pan.mockClear();
  zoomStep.mockClear();
  drawn.length = 0;
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
  document.elementFromPoint = () => canvas;
});

afterEach(() => {
  vi.useRealTimers();
  unsync?.();
  unsync = null;
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('one finger with nothing armed', () => {
  spec('EDIT-45', 'a tap selects on release', () => {
    const { a } = twoTrees();
    down(a.position);
    expect(selected(), 'nothing is selected while the finger is down').toEqual([]);
    up(a.position);
    expect(selected()).toEqual([a.id]);
  });

  spec('EDIT-45', 'in touch mode a drag that starts on an unselected object pans and leaves the selection', () => {
    const { w, a, b } = twoTrees();
    down(b.position);
    up(b.position);
    expect(selected()).toEqual([b.id]);
    const before = w.fingerprint();
    const from = a.position;
    down(from);
    for (let i = 1; i <= 4; i++) move({ x: from.x, y: from.y + i });
    up({ x: from.x, y: from.y + 4 });
    // Camera pans are previous minus current: the map follows the finger from where it landed.
    const panned = pan.mock.calls.reduce((sum, [, dy]) => sum + (dy as number), 0);
    expect(panned).toBe(-40);
    expect(selected()).toEqual([b.id]);
    expect(w.fingerprint(), 'the object stays where it stood').toBe(before);
  });

  spec('EDIT-45', 'a pen drag from an unselected object pans from where the pen landed', () => {
    const { a } = twoTrees();
    const from = a.position;
    const pen = (target: EventTarget, type: string, c: MacroCoord) => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...screen(c) });
      Object.defineProperties(event, { pointerType: { value: 'pen' }, pointerId: { value: 7 } });
      act(() => { target.dispatchEvent(event); });
    };
    pen(canvas, 'pointerdown', from);
    for (let i = 1; i <= 4; i++) pen(window, 'pointermove', { x: from.x, y: from.y + i });
    pen(window, 'pointerup', { x: from.x, y: from.y + 4 });
    const panned = pan.mock.calls.reduce((sum, [, dy]) => sum + (dy as number), 0);
    expect(panned).toBe(-40);
    expect(selected()).toEqual([]);
  });

  spec('EDIT-45', 'a drag that starts on the selection moves it and does not pan', () => {
    const { w, a } = twoTrees();
    down(a.position);
    up(a.position);
    const before = w.fingerprint();
    const from = a.position;
    down(from);
    for (let i = 1; i <= 3; i++) move({ x: from.x, y: from.y + i });
    up({ x: from.x, y: from.y + 3 });
    expect(pan).not.toHaveBeenCalled();
    expect(w.fingerprint()).not.toBe(before);
    expect(w.state.objects.get(a.id)?.position.y).toBeGreaterThan(from.y);
  });

  spec('EDIT-42', 'a long press with nothing on the map under it does nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { w, at, b } = twoTrees();
    down(b.position);
    up(b.position);
    const before = w.fingerprint();
    const ground = { x: at.x + 3, y: at.y + 4 };
    down(ground);
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs + 100); });
    up(ground);
    expect(useEditorStore.getState().contextMenu).toBeNull();
    expect(selected(), 'the selection stands').toEqual([b.id]);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-42', 'a long press on an object opens the menu for it', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { a } = twoTrees();
    down(a.position);
    expect(useEditorStore.getState().contextMenu).toBeNull();
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(useEditorStore.getState().contextMenu?.target).toEqual({ kind: 'object', id: a.id });
    up(a.position);
    expect(useEditorStore.getState().contextMenu, 'the release leaves it open').not.toBeNull();
  });

  spec('EDIT-45', 'a press waiting on the map acts for nothing once another tool is armed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { w, a } = twoTrees();
    const before = w.fingerprint();
    down(a.position);
    act(() => { useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } }); });
    up(a.position);
    expect(selected()).toEqual([]);
    down(a.position);
    act(() => { useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'none' } }); });
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    up(a.position);
    expect(useEditorStore.getState().contextMenu).toBeNull();
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-42', 'a hold timer from an earlier press never fires on a later one', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { a } = twoTrees();
    const hold = GESTURE_TIMING.touch.holdMs;
    down(a.position);
    up(a.position);
    act(() => { vi.advanceTimersByTime(hold - 100); });
    down(a.position);
    act(() => { vi.advanceTimersByTime(200); });
    expect(useEditorStore.getState().contextMenu, 'past the first press\'s hold time').toBeNull();
    act(() => { vi.advanceTimersByTime(hold - 200); });
    expect(useEditorStore.getState().contextMenu?.target).toEqual({ kind: 'object', id: a.id });
    up(a.position);
  });
});

describe('one finger with an item armed', () => {
  spec('EDIT-41', 'a still hold shows the item under the finger', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { at } = twoTrees();
    act(() => { useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: TREE } }); });
    const cell = { x: at.x + 3, y: at.y + 4 };
    drawn.length = 0;
    down(cell);
    expect(drawn, 'nothing shows while the press may still be a tap').not.toContain('showGhost');
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(drawn).toContain('showGhost');
    up(cell);
  });
});

describe('a double tap', () => {
  const tap = (c: MacroCoord) => { down(c); up(c); };

  spec('EDIT-48', 'where no object stands it zooms in one step around the finger and leaves the selection as it was', () => {
    const { at, a } = twoTrees();
    tap(a.position);
    const empty = { x: at.x + 8, y: at.y + 4 };
    tap(empty);
    tap(empty);
    const { clientX, clientY } = screen(empty);
    expect(zoomStep.mock.calls).toEqual([[1, clientX, clientY]]);
    expect(selected()).toEqual([a.id]);
  });

  spec('EDIT-48', 'two taps further apart in time than the double-tap window do not zoom', () => {
    vi.useFakeTimers();
    const { at } = twoTrees();
    const empty = { x: at.x + 8, y: at.y + 4 };
    tap(empty);
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.doubleTapMs + 50); });
    tap(empty);
    expect(zoomStep).not.toHaveBeenCalled();
  });

  spec('EDIT-48', 'with an item armed it places as two taps do and does not zoom', () => {
    const w = world();
    const at = w.openGround(12, 8);
    open(w, { tool: ToolType.ObjectPlacer, item: TREE });
    const cell = { x: at.x + 4, y: at.y + 3 };
    tap(cell);
    tap(cell);
    expect(zoomStep).not.toHaveBeenCalled();
    expect(objectsOf(w, TREE).length, 'the first tap placed the tree').toBe(1);
  });

  spec('EDIT-48', 'the window runs from the first lift to the second landing, however long the second press lasts', () => {
    vi.useFakeTimers();
    const { at } = twoTrees();
    const empty = { x: at.x + 8, y: at.y + 4 };
    const gap = GESTURE_TIMING.touch.doubleTapMs - 50;
    tap(empty);
    act(() => { vi.advanceTimersByTime(gap); });
    down(empty);
    act(() => { vi.advanceTimersByTime(100); });
    up(empty);
    expect(zoomStep).toHaveBeenCalledTimes(1);
  });

  spec('EDIT-48', 'on an object it does what two clicks do there and does not zoom', () => {
    const { a } = twoTrees();
    tap(a.position);
    tap(a.position);
    expect(zoomStep).not.toHaveBeenCalled();
    expect(selected(), 'the second tap deselects, as a second click does').toEqual([]);
  });

  spec('EDIT-48', 'with the curve brush it finishes the curve', () => {
    const w = world();
    const at = w.openGround(12, 8);
    open(w, { tool: ToolType.TerrainBrush, shape: 'curve' });
    const from = { x: at.x + 1, y: at.y + 2 }, to = { x: at.x + 9, y: at.y + 2 };
    // The brush resolves the finger on its own grid: aim at the centre of each cell there.
    const tool = getActiveToolManager()!;
    const aim = (c: MacroCoord): MacroCoord => {
      const centre = gridCellCentre(GRIDS[tool.getActiveTool().grid(tool.getContext())], c);
      return { x: centre.x - 0.5, y: centre.y - 0.5 };
    };
    tap(aim(from));
    tap(aim(to));
    expect(w.terrainAt(to), 'a curve paints nothing before it is finished').toBeNull();
    tap(aim(to));
    expect(w.terrainAt(to)).toEqual({ type: TerrainType.Mountain, elevation: 1 });
    expect(zoomStep).not.toHaveBeenCalled();
  });
});
