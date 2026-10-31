// @vitest-environment jsdom
/**
 * The magnifier over a touch press, through the map's own pointer machine over a mounted canvas and
 * the rendered loupe. A cell is ten screen pixels from the open ground's corner at the screen's top
 * left, and the object bar covers every screen row from `BAR_TOP` down.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world } from '../_world';
import { objectsOf } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { hideLoupe, showLoupe, type LoupeSource } from '../../../view/shared/overlay/loupe';
import { MapLoupe } from '../../../ui/chrome/floating/MapLoupe';
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
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const source: LoupeSource = { canvas: document.createElement('canvas'), requestFrame: noop };
/** The open ground's top-left cell, which the screen's top left shows. */
let origin: MacroCoord = { x: 0, y: 0 };
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: origin.x + sx / 10, y: origin.y + sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: (x - origin.x) * 10, y: (y - origin.y) * 10, scale: 10 }),
  },
  overlay, camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
  showLoupe: (at: { x: number; y: number }) => showLoupe(source, at),
  hideLoupe,
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let bar: HTMLElement;
let rerender: (ui: React.ReactElement) => void;
let unsync: (() => void) | null = null;
let registeredManager: ToolManager | null = null;
/** The screen point at the centre of cell `c` of the open ground, counted from its corner. */
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });

function event(target: EventTarget, type: string, p: { clientX: number; clientY: number }, pointerType = 'touch', pointerId = 1): void {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, ...p });
  Object.defineProperties(e, { pointerType: { value: pointerType }, pointerId: { value: pointerId } });
  act(() => { target.dispatchEvent(e); });
}
const down = (c: MacroCoord, type?: string, id?: number) => event(canvas, 'pointerdown', screen(c), type, id);
const move = (c: MacroCoord, type?: string) => event(window, 'pointermove', screen(c), type);
const up = (c: MacroCoord, type?: string) => event(window, 'pointerup', screen(c), type);
const loupe = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-testid="map-loupe"]');

/** The loupe's circle, read from where it is laid out. */
function circle(el: HTMLElement): { cx: number; cy: number; r: number } {
  const r = parseFloat(el.style.width) / 2;
  return { cx: parseFloat(el.style.left) + r, cy: parseFloat(el.style.top) + r, r };
}

/** Hit testing as the browser does it: the topmost element at the point that takes pointer input. */
function elementAt(x: number, y: number): Element {
  const el = loupe();
  if (el) {
    const { cx, cy, r } = circle(el);
    if (Math.hypot(x - cx, y - cy) <= r) {
      const taker = [el, ...el.querySelectorAll<HTMLElement>('*')].reverse().find((part) => part.style.pointerEvents !== 'none');
      if (taker) return taker;
    }
  }
  return y < BAR_TOP ? canvas : bar;
}

/** Open ground in the editor, armed as `arming` says. */
function open(arming: Parameters<typeof armedEditMode>[0]) {
  const w = world();
  origin = w.openGround(16, 16);
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], activeLayer: 1, ...armedEditMode(arming) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  registeredManager = manager;
  manager.syncArming();
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  return w;
}

/** Holds or lets go of the multi-select key; the key tracker reads live key events. */
function holdMultiSelect(held: boolean): void {
  act(() => { window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' })); });
}

function arm(itemId: string): void {
  act(() => { useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId } }); });
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  setActiveView(view);
  const r = render(<><Canvas /><div data-testid="bar" /><MapLoupe /></>);
  rerender = r.rerender;
  canvas = r.getByTestId('canvas');
  bar = r.getByTestId('bar');
  document.elementFromPoint = elementAt;
});

afterEach(() => {
  unsync?.();
  unsync = null;
  act(() => { hideLoupe(); });
  cleanup();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('the magnifier over a touch press', () => {
  spec('EDIT-46', 'a touch press with the brush armed shows the loupe and release hides it', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    expect(loupe()).not.toBeNull();
    const before = circle(loupe()!);
    move({ x: 10, y: 12 });
    expect(circle(loupe()!).cx, 'it follows the finger').toBeGreaterThan(before.cx);
    up({ x: 10, y: 12 });
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'the eraser, edge cut and note tools show it under a finger too', () => {
    for (const tool of [ToolType.Eraser, ToolType.EdgeCut, ToolType.Annotate]) {
      open({ tool });
      down({ x: 6, y: 12 });
      expect(loupe(), tool).not.toBeNull();
      up({ x: 6, y: 12 });
      expect(loupe(), tool).toBeNull();
    }
  });

  spec('EDIT-46', 'a mouse press never shows it, nor a pen, which shows its own hover', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    for (const type of ['mouse', 'pen']) {
      down({ x: 6, y: 12 }, type);
      move({ x: 10, y: 12 }, type);
      expect(loupe(), type).toBeNull();
      up({ x: 10, y: 12 }, type);
    }
  });

  spec('EDIT-46', 'a second finger turns the press into navigation and the loupe goes', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    expect(loupe()).not.toBeNull();
    down({ x: 12, y: 12 }, 'touch', 2);
    expect(loupe()).toBeNull();
    move({ x: 8, y: 12 });
    expect(loupe(), 'navigation never shows it').toBeNull();
  });

  spec('EDIT-46', 'a placement preview shows it, and a release under the loupe still places', () => {
    const w = open({ tool: ToolType.Hand });
    arm(HOUSE);
    down({ x: 4, y: 2 });
    for (const y of [3, 4, 5]) move({ x: 4, y });
    const el = loupe();
    expect(el).not.toBeNull();
    // Near the top of the screen the loupe is held inside it, over the finger itself.
    const { clientX, clientY } = screen({ x: 4, y: 5 });
    const { cx, cy, r } = circle(el!);
    expect(Math.hypot(clientX - cx, clientY - cy)).toBeLessThan(r);
    up({ x: 4, y: 5 });
    expect(objectsOf(w, HOUSE)).toHaveLength(1);
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'a preview whose item changes under it hides the loupe', () => {
    open({ tool: ToolType.Hand });
    arm(HOUSE);
    down({ x: 4, y: 8 });
    for (const y of [9, 10, 11]) move({ x: 4, y });
    expect(loupe()).not.toBeNull();
    arm(TREE);
    move({ x: 4, y: 12 });
    expect(loupe()).toBeNull();
    up({ x: 4, y: 12 });
  });

  spec('EDIT-46', 'the browser cancelling the touch hides the loupe', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    expect(loupe()).not.toBeNull();
    event(window, 'pointercancel', screen({ x: 6, y: 12 }));
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'a blur hides the loupe until the press moves again, and the release still hides it', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(loupe()).toBeNull();
    move({ x: 8, y: 12 });
    expect(loupe(), 'the press lives on').not.toBeNull();
    up({ x: 8, y: 12 });
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'a map view going away mid-press takes the loupe with it', () => {
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    expect(loupe()).not.toBeNull();
    rerender(<><div data-testid="bar" /><MapLoupe /></>);
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'notes in select mode pick rather than lay, so a touch drag there shows no loupe', () => {
    open({ tool: ToolType.Annotate });
    act(() => { setStoreState({ annotationTool: 'none' }); });
    down({ x: 6, y: 12 });
    move({ x: 9, y: 12 });
    expect(loupe()).toBeNull();
    up({ x: 9, y: 12 });
    expect(loupe()).toBeNull();
  });

  spec('EDIT-46', 'a finger lifting while a mouse band holds the release still takes its loupe away', () => {
    // A touchscreen laptop: the finger paints, then the mouse starts a multi-select band, so the
    // band claims the next release, the finger's own included.
    open({ tool: ToolType.TerrainBrush, content: 'mountain' });
    down({ x: 6, y: 12 });
    move({ x: 7, y: 12 });
    expect(loupe()).not.toBeNull();
    holdMultiSelect(true);
    try {
      down({ x: 12, y: 6 }, 'mouse', 2);
      up({ x: 7, y: 12 });
      expect(loupe()).toBeNull();
      event(window, 'pointerup', screen({ x: 12, y: 6 }), 'mouse', 2);
    } finally {
      holdMultiSelect(false);
    }
  });

  spec('EDIT-46', 'notes magnify while they lay or erase, and not while they pick a note or a chip', () => {
    open({ tool: ToolType.Annotate });
    const manager = registeredManager!;
    for (const [annotationTool, magnifies] of [['zone', true], ['erase', true], ['none', false], ['chip', false]] as const) {
      act(() => { setStoreState({ annotationTool }); });
      manager.syncArming();
      expect(manager.getActiveTool()?.magnifies?.(manager.getContext()) ?? false, annotationTool).toBe(magnifies);
    }
  });
});
