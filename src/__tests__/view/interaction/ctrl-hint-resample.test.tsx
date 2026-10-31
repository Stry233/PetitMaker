// @vitest-environment jsdom
/**
 * A modifier, a selection change, a tool switch or a new object changes the cursor under a standing
 * pointer without waiting for the mouse to move. `hoverInputs` lists those inputs for both the
 * re-sampling subscription and the recompute gate; these tests send no pointer event after the change.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { __resetCursorController, registerCursorSurface, setToolCursor } from '../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import { installKeyTracking } from '../../../platform/input/held-keys';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { TerrainType, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import type { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { useEditorStore } from '../../../state/store';
import { makeTestToolManager } from '../../_support/tool-manager';
import { makeState, setTerrain } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';

const OBJ_ID = 'o1';

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
  };
  return {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay, camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
  } as unknown as ActiveView;
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
const pointer = (type: string, init: MouseEventInit) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
/** The real listeners `installKeyTracking` puts on window. */
const key = (type: 'keydown' | 'keyup', ctrlKey: boolean) =>
  window.dispatchEvent(new KeyboardEvent(type, { key: 'Control', ctrlKey, bubbles: true }));

let el: HTMLElement;

/** A grid carrying one placeable object at macro (5,5), hovered from screen (55,55). */
function activate(selection: Array<{ kind: 'object'; id: string }> = []): void {
  const gs = makeState(20, 20);
  gs.objects.set(OBJ_ID, {
    id: OBJ_ID, catalogId: 'building-stall', position: { x: 5, y: 5 },
    rotation: 0, elevation: 0,
  } as PlacedObject);
  bumpObjectsVersion(gs, { added: [gs.objects.get(OBJ_ID)!] });
  setStoreState({
    gridState: gs, contextMenu: null, selection, selectingRegion: false,
    ...armedEditMode({ tool: ToolType.Hand, item: null }),
  });
  setActiveView(makeView());
}

beforeEach(() => {
  installKeyTracking();
  __resetCursorController();
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
  registerCursorSurface(el);
  setToolCursor('select');
});

afterEach(() => {
  key('keyup', false); // never leave the modifier stuck on for the next test
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('the multi-select key going down under a stationary pointer', () => {
  it('shows select-add over an unselected object, with no further pointer event', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('select'));

    key('keydown', true);

    expect(el.style.cursor).toBe(cursorCss('select-add'));
  });

  it('shows select-remove when that object is already selected', () => {
    activate([{ kind: 'object', id: OBJ_ID }]);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));

    key('keydown', true);

    expect(el.style.cursor).toBe(cursorCss('select-remove'));
  });

  it('shows marquee over bare ground, and goes back on release', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 155, clientY: 155 }));

    key('keydown', true);
    expect(el.style.cursor).toBe(cursorCss('marquee'));

    key('keyup', false);
    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('stays put once the pointer has left the canvas', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    el.dispatchEvent(pointer('pointerleave', { clientX: 55, clientY: 55 }));
    const before = el.style.cursor;

    key('keydown', true);

    expect(el.style.cursor).toBe(before);
  });
});

describe('grabbing a selected object', () => {
  it('closes the hand while the drag is live, whatever tool armed it, and lets go on drop', () => {
    // The open hand marks a grabbable cell; the press closes it.
    activate([{ kind: 'object', id: OBJ_ID }]);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));

    expect(el.style.cursor).toBe(cursorCss('hand-open'));

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    el.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 95, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 95, clientY: 55, bubbles: true }));
    // Back to the hover reading.
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
  });

  it('marks a selected object as grabbable on hover under the move tool', () => {
    activate([{ kind: 'object', id: OBJ_ID }]);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-open'));
  });
});

describe('every non-pointer input updates the cursor with no mouse movement', () => {
  it('selecting the object under the pointer', () => {
    activate(); // nothing selected yet
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('select'));

    setStoreState({ selection: [{ kind: 'object', id: OBJ_ID }] });

    expect(el.style.cursor).toBe(cursorCss('hand-open')); // it can be grabbed now, and says so
  });

  it('deselecting it again', () => {
    activate([{ kind: 'object', id: OBJ_ID }]);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-open'));

    setStoreState({ selection: [] });

    expect(el.style.cursor).toBe(cursorCss('select'));
  });

  it('switching the active tool', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 155, clientY: 155 }));
    setToolCursor('mountain');
    setStoreState({ ...armedEditMode({ tool: ToolType.TerrainBrush }) });

    expect(el.style.cursor).toBe(cursorCss('mountain'));
  });
});

/**
 * The tool layer is a mirror the canvas writes in an effect after the store has notified, so the
 * order below is the app's: store, mirror, then `tool-synced`. A probe on the store change alone
 * would answer for the old tool and cache that under the new inputs.
 */
describe('the refusal badge across a tool switch under a stationary pointer', () => {
  /** Moves the tool layer as PixiCanvas's sync effect does, then announces it. */
  function syncToolLayer(tm: ToolManager, tool: ToolType): void {
    setStoreState({ ...armedEditMode({ tool: tool }) });
    tm.setActiveTool(tool);
    useEditorStore.getState().eventBus.emit('tool-synced', { tool });
  }

  it('drops the brush\'s refusal when the eraser takes over, and takes it back', () => {
    // The object at (5,5) is what the terrain brush is refused over (V-PLACE-BLOCK); the eraser
    // has no terrain to peel there, so it allows the same cell.
    activate();
    const gs = useEditorStore.getState().gridState!;
    const tm = makeTestToolManager(gs);
    registerToolManager(tm);
    syncToolLayer(tm, ToolType.TerrainBrush);
    setToolCursor('mountain');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 52, clientY: 52 }));
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));

    syncToolLayer(tm, ToolType.Eraser);
    setToolCursor('eraser');
    expect(el.style.cursor).toBe(cursorCss('eraser'));

    syncToolLayer(tm, ToolType.TerrainBrush);
    setToolCursor('mountain');
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));
  });

  it('follows a change of SURFACE, which moves no field the store subscription watches', () => {
    // Mountain and road differ only in `contentType`, so the sync is the only thing that asks again.
    activate();
    const gs = useEditorStore.getState().gridState!;
    // A cliff on (12,12)'s right: the mountain brush stacks against it, the road brush is refused
    // for want of flat ground.
    setTerrain(gs, 13, 12, TerrainType.Mountain, 3);
    const tm = makeTestToolManager(gs);
    registerToolManager(tm);
    syncToolLayer(tm, ToolType.TerrainBrush);
    setToolCursor('mountain');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 122, clientY: 122 }));
    expect(el.style.cursor).toBe(cursorCss('mountain'));

    useEditorStore.setState({ ...armedEditMode({ content: 'road', tool: ToolType.TerrainBrush }) });
    setToolCursor('road');
    useEditorStore.getState().eventBus.emit('tool-synced', { tool: ToolType.TerrainBrush });
    expect(el.style.cursor).toBe(cursorCss('road', { forbidden: true }));
  });
});
