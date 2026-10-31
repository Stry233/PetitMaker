// @vitest-environment jsdom
/**
 * Ctrl selects from a build brush as from an armed placer (placement-select.test.tsx): a click toggles
 * membership and a drag rubber-bands instead of painting, erasing or cutting. A gesture that selects
 * something switches to the Hand tool; one that selects nothing keeps the brush. Driven through the
 * real handlers, `ToolManager` and executor, so painting before the Ctrl check would mutate the grid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController, registerCursorSurface, setToolCursor } from '../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { TerrainType, type GridState, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { bumpObjectsVersion, getCell } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { selectedObjectIds } from '../../../state/selection';
import { makeStubView } from '../../_support/tool-manager';
import { makeState, setTerrain } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { activeToolOf, designModeOf } from '../../../state/editing/edit-mode';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
  };
  const view = {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
  } as unknown as ActiveView;
  return { view, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. */
function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

/** Simulates the physical modifier key: the machine reads live keydown/keyup, not per-event flags. */
function setHeld(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}

function tree(id: string, x: number, y: number): PlacedObject {
  return {
    id, catalogId: 'tree-apple', position: { x, y },
    rotation: 0, elevation: 0,
  };
}

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;

/** A real `ToolManager` over the grid and test view with `tool` active, as placement-select's `arm`. */
function activate(tool: ToolType, ...objects: PlacedObject[]): void {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  if (objects.length > 0) bumpObjectsVersion(gs, { added: objects });
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const { view } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(tool);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    ...armedEditMode({ tool, item: null }),
  });
}

/** The point lies inside both the object cell and the overlapping terrain cell. */
function gesture(from: { x: number; y: number }, to = from): void {
  const sx = from.x * 10 + 2, sy = from.y * 10 + 2;
  const ex = to.x * 10 + 2, ey = to.y * 10 + 2;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  if (ex !== sx || ey !== sy) window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: ex, clientY: ey }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ex, clientY: ey }));
}

function hover(at: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: at.x * 10 + 2, clientY: at.y * 10 + 2 }));
}

function ids(): string[] {
  return selectedObjectIds(useEditorStore.getState().selection);
}

beforeEach(() => {
  __resetCursorController();
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  setHeld(false); // a stuck modifier would leak into the next test's clicks
});

describe('Ctrl while a build brush is active (TerrainBrush)', () => {
  it('selects the object instead of painting, then leaves the brush for the Hand tool', () => {
    activate(ToolType.TerrainBrush, tree('a', 5, 5));
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);
    expect(executor.historyDepth()).toBe(undoBefore); // nothing was painted
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand); // landed in select/drag mode
    // The Build panel highlights from designMode, so it must leave the brush too.
    expect(designModeOf(useEditorStore.getState())).toBe('none');
  });

  it('bands over several objects, then leaves the brush for the Hand tool', () => {
    activate(ToolType.TerrainBrush, tree('a', 3, 3), tree('b', 6, 3));
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 2, y: 2 }, { x: 8, y: 6 });

    expect(ids()).toEqual(['a', 'b']);
    expect(executor.historyDepth()).toBe(undoBefore);
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('keeps the brush active, and paints NOTHING, when the band caught nothing', () => {
    // An accidental Ctrl-drag over bare ground must not cost the user their tool.
    activate(ToolType.TerrainBrush, tree('a', 3, 3));
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 12, y: 12 }, { x: 16, y: 16 });

    expect(ids()).toEqual([]);
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.TerrainBrush);
    expect(executor.historyDepth()).toBe(undoBefore);
    expect(getCell(gs.cells, 14, 14)?.terrain).toBeFalsy(); // no stray mountain cell either
  });

  it('a Ctrl+click over bare ground (no drag) leaves the selection and the brush untouched', () => {
    activate(ToolType.TerrainBrush);
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual([]);
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.TerrainBrush);
    expect(executor.historyDepth()).toBe(undoBefore);
    expect(getCell(gs.cells, 5, 5)?.terrain).toBeFalsy();
  });

  it('an unmodified click paints normally', () => {
    activate(ToolType.TerrainBrush);
    setHeld(false);

    gesture({ x: 5, y: 5 });

    expect(getCell(gs.cells, 5, 5)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.TerrainBrush);
  });
});

describe('Ctrl while the eraser is active', () => {
  it('selects the object instead of erasing the terrain under it, then leaves for the Hand tool', () => {
    activate(ToolType.Eraser, tree('a', 5, 5));
    setTerrain(gs, 5, 5, TerrainType.Mountain, 1);
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);
    expect(executor.historyDepth()).toBe(undoBefore);
    expect(getCell(gs.cells, 5, 5)?.terrain?.elevation).toBe(1); // untouched, not peeled
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('an unmodified click erases normally', () => {
    activate(ToolType.Eraser);
    setTerrain(gs, 5, 5, TerrainType.Mountain, 1);
    setHeld(false);

    gesture({ x: 5, y: 5 });

    expect(getCell(gs.cells, 5, 5)?.terrain).toBeNull();
  });
});

describe('Ctrl while the edge cutter is active', () => {
  it('selects the object instead of cutting a corner, then leaves for the Hand tool', () => {
    activate(ToolType.EdgeCut, tree('a', 10, 10));
    // A lone tier-3 block: clicking it without Ctrl cuts a convex corner (see edge-cut-tool.test.ts).
    setTerrain(gs, 10, 10, TerrainType.Mountain, 3);
    const undoBefore = executor.historyDepth();
    setHeld(true);

    gesture({ x: 10, y: 10 });

    expect(ids()).toEqual(['a']);
    expect(executor.historyDepth()).toBe(undoBefore);
    // A fresh cell's corners stay unset until a trim touches them.
    expect(getCell(gs.cells, 10, 10)!.terrain!.corners).toBeUndefined();
    expect(activeToolOf(useEditorStore.getState())).toBe(ToolType.Hand);
  });

  it('an unmodified click cuts normally', () => {
    activate(ToolType.EdgeCut);
    setTerrain(gs, 10, 10, TerrainType.Mountain, 3);
    setHeld(false);

    gesture({ x: 10, y: 10 });

    expect(getCell(gs.cells, 10, 10)!.terrain!.corners?.some((c) => c !== 'square')).toBe(true);
  });
});

describe('the cursor over a build brush', () => {
  it('shows the brush unmodified, and the Ctrl hint (outranking it) once held', () => {
    activate(ToolType.TerrainBrush, tree('a', 5, 5));
    registerCursorSurface(el);
    setToolCursor('mountain'); // what DrawingTool's own getter reports for contentType mountain

    hover({ x: 12, y: 12 });
    expect(el.style.cursor).toBe(cursorCss('mountain'));

    setHeld(true);
    hover({ x: 6, y: 6 }); // a new cell, so the probe re-runs
    hover({ x: 12, y: 12 });
    expect(el.style.cursor).toBe(cursorCss('marquee'));

    hover({ x: 4, y: 4 });
    hover({ x: 5, y: 5 });
    expect(el.style.cursor).toBe(cursorCss('select-add'));
  });
});
