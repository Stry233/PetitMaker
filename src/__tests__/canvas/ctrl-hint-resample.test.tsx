/**
 * The cursor answers a question with several inputs, and only one of them is where the pointer is.
 * A modifier going down, a selection changing, a tool switch, an object appearing — each changes
 * the answer at a standing cursor, and none of them may wait for the user to jiggle the mouse.
 *
 * `hoverInputs` is the one list of those inputs; the subscription that re-samples and the gate
 * that decides whether to recompute both read it. These drive the real handlers with NO pointer
 * event after the change. Sibling of `placement-rotation-resample.test.tsx`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { __resetCursorController, registerCursorSurface, setToolCursor } from '../../canvas/interaction/cursor-controller';
import { cursorCss } from '../../assets/cursors/cursor-css';
import { installModifierTracking } from '../../core/runtime/modifier-state';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { TerrainType, ToolType, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import type { ToolManager } from '../../tools/runtime/tool-manager';
import type { DrawingTool } from '../../tools/paint/drawing-tool';
import { useEditorStore } from '../../state/store';
import { makeTestToolManager } from '../tools/_tool-manager';
import { makeState, setTerrain } from '../rules/_helpers';
import { setStoreState } from '../_store';

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
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay, camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    applyCameraTransform: vi.fn(), leftDragPans: true,
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
/** The real listeners `installModifierTracking` puts on window. */
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
    gridState: gs, activeTool: ToolType.Hand, selectedItemId: null,
    contextMenu: null, selection, selectingRegion: false,
  });
  setActiveView(makeView());
}

beforeEach(() => {
  installModifierTracking();
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
    // The open hand marks a cell where a press WOULD grab something; the press closes it. Without
    // a drag state at all, the press looked identical to hovering.
    activate([{ kind: 'object', id: OBJ_ID }]);
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));

    expect(el.style.cursor).toBe(cursorCss('hand-open')); // hover: this can be grabbed

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    el.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 95, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('hand-closed'));

    window.dispatchEvent(new MouseEvent('pointerup', { button: 0, buttons: 0, clientX: 95, clientY: 55, bubbles: true }));
    // Back to the hover reading, not stuck on the closed hand.
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
    setStoreState({ activeTool: ToolType.TerrainBrush });

    expect(el.style.cursor).toBe(cursorCss('mountain'));
  });
});

/**
 * The refusal badge asks a TOOL whether the hovered cell would be refused, and the tool layer is a
 * mirror the canvas writes in an effect — after the store has already told its subscribers. So the
 * order below is the app's, not a convenience: the store first, the mirror second, `tool-synced`
 * last. A probe run on the store change alone answers for the tool being left AND caches that
 * answer under the new inputs, which is what left the badge on the eraser over a cell the eraser
 * allows, through every later pointer move that stayed in the cell.
 */
describe('the refusal badge across a tool switch under a stationary pointer', () => {
  /** Move the tool layer the way PixiCanvas's sync effect does, and say so. */
  function syncToolLayer(tm: ToolManager, tool: ToolType): void {
    setStoreState({ activeTool: tool });
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
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));

    syncToolLayer(tm, ToolType.Eraser);
    setToolCursor('eraser');
    expect(el.style.cursor).toBe(cursorCss('eraser'));

    syncToolLayer(tm, ToolType.TerrainBrush);
    setToolCursor('mountain');
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));
  });

  it('follows a change of SURFACE, which moves no field the store subscription watches', () => {
    // Mountain and tile are one ToolType and one designMode apart from `contentType`, which the
    // DrawingTool holds itself. Nothing the store publishes changes, so the sync is the only
    // thing that can ask again.
    activate();
    const gs = useEditorStore.getState().gridState!;
    // A cliff on (12,12)'s right: the mountain brush stacks against it, the road brush is refused
    // for want of flat ground.
    setTerrain(gs, 13, 12, TerrainType.Mountain, 3);
    const tm = makeTestToolManager(gs);
    const brush = tm.getToolById(ToolType.TerrainBrush) as DrawingTool;
    registerToolManager(tm);
    syncToolLayer(tm, ToolType.TerrainBrush);
    setToolCursor('mountain');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 125, clientY: 125 }));
    expect(el.style.cursor).toBe(cursorCss('mountain'));

    brush.contentType = 'tile';
    setToolCursor('road');
    useEditorStore.getState().eventBus.emit('tool-synced', { tool: ToolType.TerrainBrush });
    expect(el.style.cursor).toBe(cursorCss('road', { forbidden: true }));
  });
});
