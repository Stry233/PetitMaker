// @vitest-environment jsdom
/**
 * Placing an armed item with one finger, through the map's own pointer machine over a mounted
 * canvas: the item shows under the finger while it is down and lands where the finger lifts. The
 * map is a spec world the editor store holds; a cell is ten screen pixels, and the object bar
 * covers every screen row from `BAR_TOP` down.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { objectsOf, placeItem } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { useEditorStore } from '../../../state/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord } from '../../../core/model/types';

const HOUSE = 'building-myhouse';
const TREE = 'tree-apple';
const BAR_TOP = 1000;
const noop = (): void => {};
const pan = vi.fn();
/** Every overlay call the view received, by method name. */
const drawn: string[] = [];
const overlay = new Proxy({} as ToolOverlay, { get: (_t, name) => () => { drawn.push(String(name)); } });
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let bar: HTMLElement;
let unsync: (() => void) | null = null;
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });

/** One pointer event at screen point `p`; `pointerType` is not a MouseEvent field, so it is defined on the instance. */
function event(target: EventTarget, type: string, p: { clientX: number; clientY: number }, pointerType = 'touch', pointerId = 1): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...p });
  Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: pointerId } });
  act(() => { target.dispatchEvent(e); });
}
const down = (c: MacroCoord, type?: string) => event(canvas, 'pointerdown', screen(c), type);
const move = (c: MacroCoord) => event(window, 'pointermove', screen(c));
const up = (c: MacroCoord, type?: string) => event(window, 'pointerup', screen(c), type);
const overBar = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: BAR_TOP + 20 });

function arm(itemId: string): void {
  act(() => { useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId } }); });
}

/** Open ground with a tree on it, opened in the editor with a house armed. */
function openWithHouse(): { w: SpecWorld; at: MacroCoord; tree: MacroCoord } {
  const w = world();
  const at = w.openGround(16, 16);
  const tree = { x: at.x + 12, y: at.y + 12 };
  placeItem(w, TREE, tree);
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  arm(HOUSE);
  return { w, at, tree };
}

/** A finger dragging from `from` straight down through `steps` cells. */
function dragDown(from: MacroCoord, steps: number): MacroCoord {
  down(from);
  for (let i = 1; i <= steps; i++) move({ x: from.x, y: from.y + i });
  return { x: from.x, y: from.y + steps };
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  drawn.length = 0;
  pan.mockClear();
  setActiveView(view);
  const r = render(<><Canvas /><div data-testid="bar" /></>);
  canvas = r.getByTestId('canvas');
  bar = r.getByTestId('bar');
  document.elementFromPoint = (_x: number, y: number) => (y < BAR_TOP ? canvas : bar);
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

describe('placing with one finger', () => {
  spec('EDIT-41', 'a touch press with a house armed shows its ghost and places nothing until release', () => {
    const { w, at } = openWithHouse();
    const end = dragDown({ x: at.x + 2, y: at.y + 2 }, 3);
    expect(drawn).toContain('showPlacementGhost');
    expect(objectsOf(w, HOUSE)).toHaveLength(0);
    const before = w.fingerprint();
    up(end);
    const houses = objectsOf(w, HOUSE);
    expect(houses).toHaveLength(1);
    expect(houses[0]!.position.y).toBeGreaterThan(at.y + 3);
    expect(w.undo(), 'the placement is one undo step').toBe(true);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-41', 'an item held still under the finger, then released, is placed', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { w, at } = openWithHouse();
    const cell = { x: at.x + 3, y: at.y + 3 };
    down(cell);
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(drawn).toContain('showPlacementGhost');
    expect(objectsOf(w, HOUSE)).toHaveLength(0);
    up(cell);
    expect(objectsOf(w, HOUSE)).toHaveLength(1);
  });

  spec('EDIT-41', 'releasing on a refused cell places nothing', () => {
    const { w, at, tree } = openWithHouse();
    const before = w.fingerprint();
    const from = { x: tree.x, y: at.y + 6 };
    const end = dragDown(from, tree.y - from.y);
    up(end);
    expect(objectsOf(w, HOUSE)).toHaveLength(0);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-41', 'releasing over the object bar places nothing', () => {
    const { w, at } = openWithHouse();
    const before = w.fingerprint();
    const from = { x: at.x + 2, y: at.y + 2 };
    dragDown(from, 2);
    drawn.length = 0;
    event(window, 'pointermove', overBar(from));
    expect(drawn, 'the preview leaves the map').toContain('clearGhost');
    event(window, 'pointerup', overBar(from));
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-41', 'a press waiting with one item places nothing once another item is armed', () => {
    const { w, at } = openWithHouse();
    const before = w.fingerprint();
    const cell = { x: at.x + 3, y: at.y + 3 };
    down(cell);
    arm(TREE);
    up(cell);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-41', 'a drag that changes item mid-preview places nothing', () => {
    const { w, at } = openWithHouse();
    const before = w.fingerprint();
    const end = dragDown({ x: at.x + 2, y: at.y + 2 }, 3);
    arm(TREE);
    drawn.length = 0;
    move(end);
    expect(drawn, 'the stale preview leaves the map').toContain('clearGhost');
    expect(drawn).not.toContain('showPlacementGhost');
    up(end);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-41', 'a second finger after a preview drag pans by the second gesture alone', () => {
    const { w, at } = openWithHouse();
    const before = w.fingerprint();
    const end = dragDown({ x: at.x + 2, y: at.y + 2 }, 3);
    expect(pan).not.toHaveBeenCalled();
    event(canvas, 'pointerdown', screen({ x: end.x + 4, y: end.y }), 'touch', 2);
    move({ x: end.x, y: end.y + 1 });
    // One of two fingers travels 10 px: the pair's midpoint, which the camera follows, moves 5.
    const panned = pan.mock.calls.reduce((sum, [, dy]) => sum + (dy as number), 0);
    expect(panned).toBe(-5);
    for (const id of [1, 2]) event(window, 'pointerup', screen(end), 'touch', id);
    expect(w.fingerprint(), 'navigation places nothing').toBe(before);
  });

  spec('EDIT-41', 'a mouse press still places on the way down', () => {
    const { w, at } = openWithHouse();
    const cell = { x: at.x + 3, y: at.y + 3 };
    down(cell, 'mouse');
    expect(objectsOf(w, HOUSE)).toHaveLength(1);
    up(cell, 'mouse');
    expect(objectsOf(w, HOUSE)).toHaveLength(1);
  });
});
