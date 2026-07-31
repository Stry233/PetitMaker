/**
 * What the POINTER MACHINE publishes to the cursor controller: the pan/orbit drag, and the
 * positional "over the already-selected object" fact.
 *
 * Both are facts only the machine knows, so they cannot be unit-tested through a tool. These
 * drive the real handlers over a real container element and read the resolved CSS back off it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import {
  __resetCursorController, registerCursorSurface, setToolCursor,
} from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../ui/cursors/cursor-css';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';

/** `leftDragPans` is the VIEW CAPABILITY the machine branches on: true/undefined = the view pans
 *  left-drag itself through the tool layer (2D), false = the machine pans it (the 3D editor). */
function makeView(opts: { canOrbit?: boolean; leftDragPans?: boolean } = {}) {
  const camera = {
    pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn(),
    ...(opts.canOrbit ? { orbit: vi.fn() } : {}),
  };
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
  };
  const view = {
    projection: {
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay, camera, applyCameraTransform: vi.fn(),
    ...(opts.leftDragPans === undefined ? {} : { leftDragPans: opts.leftDragPans }),
  } as unknown as ActiveView;
  return { view, camera, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. `pointerType`
 *  is not a MouseEvent field, so it is defined on the instance where a touch is being faked. */
function pointer(type: string, init: MouseEventInit & { pointerType?: string }): MouseEvent {
  const { pointerType, ...rest } = init;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...rest });
  if (pointerType) Object.defineProperty(e, 'pointerType', { value: pointerType });
  return e;
}

/** Mount, and hand the container to the controller as the cursor surface (useCursor's job in
 *  the app; this suite is about what the pointer machine publishes, not about ownership). */
function mount(tool: 'hand-open' | 'select'): HTMLElement {
  const { getByTestId } = render(<Host />);
  const el = getByTestId('canvas');
  registerCursorSurface(el);
  setToolCursor(tool);
  return el;
}

beforeEach(() => {
  __resetCursorController();
  setStoreState({
    activeTool: ToolType.Hand, gridState: makeState(20, 20),
    selectedItemId: null, contextMenu: null, selection: [], selectingRegion: false,
  });
});
afterEach(() => { cleanup(); setActiveView(null); __resetCursorController(); });

describe('every path that pans closes the hand', () => {
  it('closes it for the 2D Hand LEFT-drag, which the tool layer pans', () => {
    // The primary 2D pan gesture. HandTool deliberately does not track its own grip, so if the
    // machine does not report this drag, nothing ever closes the hand.
    const { view } = makeView({ leftDragPans: true });
    setActiveView(view);
    const el = mount('hand-open');
    expect(el.style.cursor).toBe(cursorCss('hand-open'));

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 130, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
  });

  it('closes it for the 3D left-drag, which the MACHINE pans, and reports it exactly once', () => {
    const { view, camera } = makeView({ canOrbit: true, leftDragPans: false });
    setActiveView(view);
    const el = mount('hand-open');

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));
    // One owner of the pan: the machine pans here, and the 2D branch must not also fire.
    window.dispatchEvent(pointer('pointermove', { button: 0, buttons: 1, clientX: 130, clientY: 100 }));
    expect(camera.pan).toHaveBeenCalledTimes(1);
    expect(camera.pan).toHaveBeenCalledWith(-30, 0);

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 130, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
  });

  it('does NOT claim a pan for an idle placer in a view that pans left-drag through the tool', () => {
    // ToolManager only pans for the Hand tool, so an idle placer's left-drag in 2D moves nothing:
    // reporting a pan there would show a closed hand over a gesture that does not pan.
    const { view } = makeView({ leftDragPans: true });
    setActiveView(view);
    setStoreState({ activeTool: ToolType.ObjectPlacer });
    const el = mount('select');

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 100, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('select'));
  });
});

describe('a drag survives the pointer leaving the canvas', () => {
  it('keeps the closed hand while a button is still held', () => {
    // Orbiting to the window edge, or space-panning across a floating panel, is ONE gesture.
    const { view } = makeView({ canOrbit: true, leftDragPans: false });
    setActiveView(view);
    const el = mount('hand-open');

    el.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 100, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('orbit'));
    el.dispatchEvent(pointer('pointerleave', { buttons: 2, clientX: 0, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('orbit'));
  });

  it('clears it on a leave with no button held, which means the gesture is over', () => {
    const { view } = makeView({ canOrbit: true, leftDragPans: false });
    setActiveView(view);
    const el = mount('hand-open');

    el.dispatchEvent(pointer('pointerdown', { button: 2, buttons: 2, clientX: 100, clientY: 100 }));
    el.dispatchEvent(pointer('pointerleave', { buttons: 0, clientX: 0, clientY: 100 }));
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
  });
});

describe('move is published from where the pointer IS', () => {
  const OBJ: PlacedObject = {
    id: 'tree-1', catalogId: 'tree-apple', position: { x: 5, y: 5 },
    rotation: 0, elevation: 0,
  };

  function withSelectedObject() {
    const gs = makeState(20, 20);
    gs.objects.set(OBJ.id, OBJ);
    bumpObjectsVersion(gs, { added: [OBJ] });
    setStoreState({
      gridState: gs, activeTool: ToolType.ObjectPlacer, selectedItemId: null,
      selection: [{ kind: 'object', id: OBJ.id }],
    });
  }

  it('is move over the selected object and select everywhere else on the same map', () => {
    const { view } = makeView({ leftDragPans: true });
    setActiveView(view);
    withSelectedObject();
    const el = mount('select');

    el.dispatchEvent(pointer('pointermove', { clientX: 55, clientY: 55 })); // macro (5,5)
    expect(el.style.cursor).toBe(cursorCss('move'));

    el.dispatchEvent(pointer('pointermove', { clientX: 155, clientY: 155 })); // macro (15,15)
    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('resets on pointerleave', () => {
    const { view } = makeView({ leftDragPans: true });
    setActiveView(view);
    withSelectedObject();
    const el = mount('select');

    el.dispatchEvent(pointer('pointermove', { clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('move'));
    el.dispatchEvent(pointer('pointerleave', { buttons: 0, clientX: 0, clientY: 0 }));
    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('resets on the touch path, since touch has no cursor to promise anything to', () => {
    const { view } = makeView({ leftDragPans: true });
    setActiveView(view);
    withSelectedObject();
    const el = mount('select');

    el.dispatchEvent(pointer('pointermove', { clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('move'));
    el.dispatchEvent(pointer('pointermove', { clientX: 55, clientY: 55, pointerType: 'touch' }));
    expect(el.style.cursor).toBe(cursorCss('select'));
  });
});
