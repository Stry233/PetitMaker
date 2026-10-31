// @vitest-environment jsdom
/**
 * Placing many objects as a person does: the map's own pointer machine over a mounted canvas for the
 * strokes and clicks, the bar's keys through the commands they run, the shelf's cards through the
 * press a Ctrl+click makes, and the toasts a person reads. The map is a spec world the editor store
 * holds; a cell is ten screen pixels.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { placeItem, plateau } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { toggleItemPick } from '../../../editor/editing/object-shelf';
import { useEditorStore } from '../../../state/store';
import { armedItemOf, armedPicksOf } from '../../../state/editing/edit-mode';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import { surfaceElevationAt } from '../../../state/object-geometry';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import type { BuildShape } from '../../../state/editing/vocabulary';

const ROSE = 'flower-rose';
const DAISY = 'flower-daisy';
const CABIN = 'building-forest-cabin';
const noop = (): void => {};
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let unsync: (() => void) | null = null;
let toasts: string[] = [];
let stopToasts: (() => void) | null = null;
let clock = 1000;
const mouse = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });
/** One press from `from` through `path`, released at its last cell. */
function press(from: MacroCoord, ...path: MacroCoord[]): void {
  canvas.dispatchEvent(mouse('pointerdown', { button: 0, buttons: 1, ...screen(from) }));
  for (const c of path) window.dispatchEvent(mouse('pointermove', { buttons: 1, ...screen(c) }));
  window.dispatchEvent(mouse('pointerup', { button: 0, buttons: 0, ...screen(path[path.length - 1] ?? from) }));
}
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: noop } as unknown as CommandContext);
const s = () => useEditorStore.getState();
const placedOf = (w: SpecWorld, id: string): PlacedObject[] => [...w.state.objects.values()].filter((o) => o.catalogId === id);
const at = (w: SpecWorld, c: MacroCoord) => [...w.state.objects.values()].find((o) => o.position.x === c.x && o.position.y === c.y && !o.locked);
const spots = (objects: readonly PlacedObject[]) => objects.map((o) => `${o.position.x},${o.position.y}`).sort();

/** Open `w` in the editor with `item` armed on the shelf, the live tool manager over it. */
function open(w: SpecWorld, item: string | null = ROSE): void {
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [] });
  s().setEditMode({ mode: 'object', arm: item ? { kind: 'item', itemId: item } : { kind: 'none' } });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  manager.syncArming();
}

/** Paint chosen with `shape` and `spacing`. */
function paint(shape: BuildShape, spacing = 0): void {
  s().setObjectBrush('paint');
  s().setObjectPaintShape(shape);
  s().setObjectPaintSpacing(spacing);
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
  toasts = [];
  stopToasts = setToastPresenter((text) => { toasts.push(text); });
  // A curve's double-click reads each release's own time; every event here lands a millisecond apart.
  clock = 1000;
  Object.defineProperty(MouseEvent.prototype, 'timeStamp', { configurable: true, get: () => clock++ });
});

afterEach(() => {
  unsync?.();
  unsync = null;
  stopToasts?.();
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  delete (MouseEvent.prototype as { timeStamp?: number }).timeStamp;
});

describe('the brush bar', () => {
  spec('EDIT-64', 'keys 1 and 2 choose Place and Paint and 5 steps the brush shape while the bar is up', () => {
    const w = world();
    w.openGround(4, 4);
    open(w);
    s().setObjectBrushBar(true);
    expect(s().objectBrushBar).toBe(true);
    const overrides = {};
    expect([effectiveCombo(overrides, 'tool.brush', 'objects'), effectiveCombo(overrides, 'tool.erase', 'objects'), effectiveCombo(overrides, 'tool.shape_cycle', 'objects')]).toEqual(['1', '2', '5']);
    key('tool.erase');
    expect(s().objectBrush).toBe('paint');
    const shapes = [s().objectPaintShape];
    for (let i = 0; i < 5; i++) { key('tool.shape_cycle'); shapes.push(s().objectPaintShape); }
    expect(shapes).toEqual(['free', 'line', 'curve', 'rect', 'circle', 'free']);
    key('tool.brush');
    expect(s().objectBrush).toBe('place');
    expect(armedItemOf(s()), 'the card stays armed').toBe(ROSE);
  });

  spec('EDIT-64', 'the bar closes with the mode or the card it stood for, and the way to place stays chosen', () => {
    const w = world();
    w.openGround(4, 4);
    open(w);
    s().setObjectBrush('paint');
    s().setObjectBrushBar(true);
    key('selection.deselect');
    expect(armedItemOf(s())).toBeNull();
    expect(s().objectBrushBar, 'Escape puts the card down and the bar goes with it').toBe(false);
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: ROSE } });
    s().setObjectBrushBar(true);
    s().setEditMode({ mode: 'mountain' });
    expect(s().objectBrushBar).toBe(false);
    expect(s().objectBrush).toBe('paint');
  });
});

describe('painting', () => {
  spec('EDIT-66', 'a rectangle with spacing 1 lays every other cell from the corner it was dragged from, in one undo step', () => {
    const w = world();
    const o = w.openGround(8, 6);
    open(w);
    paint('rect', 1);
    const before = w.fingerprint();
    press(o, { x: o.x + 2, y: o.y + 1 }, { x: o.x + 4, y: o.y + 2 });
    const expected = [0, 2, 4].flatMap((dx) => [0, 2].map((dy) => `${o.x + dx},${o.y + dy}`)).sort();
    expect(spots(placedOf(w, ROSE))).toEqual(expected);
    expect(toasts).toEqual([]);
    w.undo();
    expect(w.fingerprint(), 'one undo takes the whole rectangle back').toBe(before);
  });

  spec('EDIT-66', 'a rectangle dragged up and to the left lays from its starting corner', () => {
    const w = world();
    const o = w.openGround(8, 6);
    open(w);
    paint('rect', 2);
    const start = { x: o.x + 4, y: o.y + 4 };
    press(start, { x: o.x, y: o.y });
    expect(spots(placedOf(w, ROSE))).toEqual([`${o.x + 1},${o.y + 1}`, `${o.x + 1},${o.y + 4}`, `${o.x + 4},${o.y + 1}`, `${o.x + 4},${o.y + 4}`].sort());
  });

  spec('EDIT-65', 'a freehand drag lays items along its path as it goes, the spacing apart', () => {
    const w = world();
    const o = w.openGround(10, 3);
    open(w);
    paint('free', 1);
    const path = [1, 2, 3, 4, 5, 6].map((dx) => ({ x: o.x + dx, y: o.y }));
    press(o, ...path);
    expect(spots(placedOf(w, ROSE))).toEqual([0, 2, 4, 6].map((dx) => `${o.x + dx},${o.y}`).sort());
  });

  spec('EDIT-65', 'a line lays along the dragged line and a curve along its path once a double-click finishes it', () => {
    const w = world();
    const o = w.openGround(12, 6);
    open(w);
    paint('line', 0);
    press(o, { x: o.x + 4, y: o.y });
    expect(placedOf(w, ROSE)).toHaveLength(5);
    paint('curve', 3);
    const end = { x: o.x + 8, y: o.y + 4 };
    press({ x: o.x, y: o.y + 4 });
    expect(placedOf(w, ROSE), 'a curve lays nothing before it is finished').toHaveLength(5);
    press(end);
    press(end);
    const curve = placedOf(w, ROSE).filter((r) => r.position.y === o.y + 4);
    expect(curve.map((r) => r.position.x).sort((a, b) => a - b)).toEqual([o.x, o.x + 4, o.x + 8]);
  });

  spec('EDIT-67', 'a spot the rules refuse is skipped, the rest laid, and the toast says how many', () => {
    const w = world();
    const o = w.openGround(8, 4);
    const daisy = placeItem(w, DAISY, { x: o.x + 2, y: o.y })!;
    open(w);
    paint('line', 1);
    press(o, { x: o.x + 6, y: o.y });
    expect(spots(placedOf(w, ROSE))).toEqual([0, 4, 6].map((dx) => `${o.x + dx},${o.y}`).sort());
    expect(at(w, daisy.position)?.catalogId, 'the object in the way stays').toBe(DAISY);
    expect(toasts).toEqual(['1 spot could not take an item and was skipped']);
  });

  spec('EDIT-67', 'each item stands on the ground under it, across a cliff', () => {
    const w = world();
    const o = w.openGround(10, 4);
    plateau(w, { x: o.x + 3, y: o.y }, 4, 3, 2);
    open(w);
    paint('line', 0);
    press({ x: o.x, y: o.y + 1 }, { x: o.x + 9, y: o.y + 1 });
    const roses = placedOf(w, ROSE);
    // Spots at the cliff's foot or rim the rules refuse are skipped; every other spot is laid.
    const skipped = 10 - roses.length;
    expect(toasts).toEqual(skipped > 0 ? [`${skipped} spot${skipped > 1 ? 's' : ''} could not take an item and ${skipped > 1 ? 'were' : 'was'} skipped`] : []);
    expect(roses.every((r) => r.elevation === surfaceElevationAt(w.state, r.position.x, r.position.y))).toBe(true);
    expect(new Set(roses.map((r) => r.elevation))).toEqual(new Set([0, 2]));
  });

  spec('EDIT-67', 'a stroke the rules refuse whole lays nothing, leaves no undo step and names the rule', () => {
    const w = world();
    const o = w.openGround(6, 3);
    placeItem(w, DAISY, o);
    open(w);
    paint('free', 0);
    const before = w.fingerprint();
    const depth = w.sandbox.executor.getUndoEntries().length;
    press(o);
    expect(w.fingerprint()).toBe(before);
    expect(w.sandbox.executor.getUndoEntries()).toHaveLength(depth);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).not.toMatch(/skipped/);
  });
});

describe('one at a time', () => {
  spec('EDIT-69', 'with Paint chosen, an item the map holds only one of places once as Place does', () => {
    const w = world();
    const o = w.openGround(24, 12);
    open(w, CABIN);
    paint('rect', 0);
    press({ x: o.x + 4, y: o.y + 4 }, { x: o.x + 20, y: o.y + 10 });
    expect(placedOf(w, CABIN)).toHaveLength(1);
  });
});

describe('several cards', () => {
  spec('EDIT-70', 'Ctrl+click picks cards in order; Paint lays them in turn and Place places them in turn', () => {
    const w = world();
    const o = w.openGround(10, 6);
    open(w);
    toggleItemPick(DAISY);
    expect(armedPicksOf(s())).toEqual([ROSE, DAISY]);
    paint('line', 0);
    press(o, { x: o.x + 5, y: o.y });
    const row = [0, 1, 2, 3, 4, 5].map((dx) => at(w, { x: o.x + dx, y: o.y })?.catalogId);
    expect(row).toEqual([ROSE, DAISY, ROSE, DAISY, ROSE, DAISY]);
    s().setObjectBrush('place');
    for (const dx of [0, 2, 4]) press({ x: o.x + dx, y: o.y + 3 });
    expect([0, 2, 4].map((dx) => at(w, { x: o.x + dx, y: o.y + 3 })?.catalogId)).toEqual([ROSE, DAISY, ROSE]);
  });

  spec('EDIT-70', 'Ctrl+click on a picked card takes it out, and a one-of-a-kind item is never picked beside another', () => {
    const w = world();
    w.openGround(4, 4);
    open(w);
    toggleItemPick(DAISY);
    toggleItemPick(ROSE);
    expect(armedPicksOf(s())).toEqual([DAISY]);
    toggleItemPick(CABIN);
    expect(armedPicksOf(s())).toEqual([CABIN]);
    toggleItemPick(ROSE);
    expect(armedPicksOf(s())).toEqual([ROSE]);
  });
});
