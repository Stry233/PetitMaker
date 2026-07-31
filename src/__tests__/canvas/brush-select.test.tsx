/**
 * Ctrl reaches the selection path from a BUILD BRUSH too, exactly as it already does from an
 * armed placer (placement-select.test.tsx): a Ctrl+click toggles membership and a Ctrl+drag
 * rubber-bands instead of painting/erasing/cutting. A gesture that ends with something selected
 * leaves terrain-editing mode for the Hand tool (a brush has no "armed item" to drop, so the
 * ACTIVE TOOL is what changes); a gesture that selects nothing leaves the brush active, so an
 * accidental Ctrl-drag over bare ground never costs the user their tool.
 *
 * Driven through the real handlers over a real container, with a real ToolManager + executor, so
 * a hypothetical "painted before the Ctrl branch was consulted" ordering bug would actually show
 * up as a mutated grid, not just an unexercised code path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController, registerCursorSurface, setToolCursor } from '../../canvas/interaction/cursor-controller';
import { isBrushTool } from '../../canvas/interaction/selection-hover';
import { cursorCss } from '../../ui/cursors/cursor-css';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, TerrainType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion, getCell } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { selectedObjectIds } from '../../state/selection';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState, setTerrain } from '../rules/_helpers';
import { setStoreState } from '../_store';

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
      screenToMacro: (sx: number, sy: number) => ({ x: Math.floor(sx / 10), y: Math.floor(sy / 10) }),
      screenToMicro: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
      cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
      pan: vi.fn(),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    applyCameraTransform: vi.fn(),
    leftDragPans: true,
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

/** The app's own wiring: a real ToolManager over the same grid, pointed at the test view, with
 *  `tool` active — mirrors placement-select.test.tsx's `arm`. */
function activate(tool: ToolType, ...objects: PlacedObject[]): void {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  if (objects.length > 0) bumpObjectsVersion(gs, { added: objects });
  executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry());
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const { view } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(tool);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: tool,
    selectedItemId: null, selection: [], selectingRegion: false, contextMenu: null,
  });
}

/** Press, optionally drag, release — screen coords are macro cells × 10 (+5 to land mid-cell). */
function gesture(from: { x: number; y: number }, to = from): void {
  const sx = from.x * 10 + 5, sy = from.y * 10 + 5;
  const ex = to.x * 10 + 5, ey = to.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  if (ex !== sx || ey !== sy) window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: ex, clientY: ey }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: ex, clientY: ey }));
}

function hover(at: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: at.x * 10 + 5, clientY: at.y * 10 + 5 }));
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

describe('isBrushTool', () => {
  it('names exactly the terrain-editing tools: the build brush, the eraser, and the edge cutter', () => {
    expect(isBrushTool(ToolType.TerrainBrush)).toBe(true);
    expect(isBrushTool(ToolType.Eraser)).toBe(true);
    expect(isBrushTool(ToolType.EdgeCut)).toBe(true);
    expect(isBrushTool(ToolType.Hand)).toBe(false);
    expect(isBrushTool(ToolType.ObjectPlacer)).toBe(false);
  });
});

describe('Ctrl while a build brush is active (TerrainBrush)', () => {
  it('selects the object instead of painting, then leaves the brush for the Hand tool', () => {
    activate(ToolType.TerrainBrush, tree('a', 5, 5));
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);
    expect(executor.getUndoStackSize()).toBe(undoBefore); // nothing was painted
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand); // landed in select/drag mode
    // The Build panel highlights from designMode, so leaving it on the brush would show a brush
    // as current while the pointer is in select/drag mode.
    expect(useEditorStore.getState().designMode).toBe('hand');
  });

  it('bands over several objects, then leaves the brush for the Hand tool', () => {
    activate(ToolType.TerrainBrush, tree('a', 3, 3), tree('b', 6, 3));
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 2, y: 2 }, { x: 8, y: 6 });

    expect(ids()).toEqual(['a', 'b']);
    expect(executor.getUndoStackSize()).toBe(undoBefore);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('keeps the brush active, and paints NOTHING, when the band caught nothing', () => {
    // An empty band changed nothing, so there is nothing to edit and no reason to bump the user
    // out of their brush — an accidental Ctrl-drag over bare ground must not cost them their tool.
    activate(ToolType.TerrainBrush, tree('a', 3, 3));
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 12, y: 12 }, { x: 16, y: 16 });

    expect(ids()).toEqual([]);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
    expect(executor.getUndoStackSize()).toBe(undoBefore);
    expect(getCell(gs.cells, 14, 14)?.terrain).toBeFalsy(); // no stray mountain cell either
  });

  it('a Ctrl+click over bare ground (no drag) leaves the selection and the brush untouched', () => {
    activate(ToolType.TerrainBrush);
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual([]);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
    expect(executor.getUndoStackSize()).toBe(undoBefore);
    expect(getCell(gs.cells, 5, 5)?.terrain).toBeFalsy();
  });

  it('regression: an UNMODIFIED click still paints normally', () => {
    activate(ToolType.TerrainBrush);
    setHeld(false);

    gesture({ x: 5, y: 5 });

    expect(getCell(gs.cells, 5, 5)?.terrain?.type).toBe(TerrainType.Mountain);
    expect(useEditorStore.getState().activeTool).toBe(ToolType.TerrainBrush);
  });
});

describe('Ctrl while the eraser is active', () => {
  it('selects the object instead of erasing the terrain under it, then leaves for the Hand tool', () => {
    activate(ToolType.Eraser, tree('a', 5, 5));
    setTerrain(gs, 5, 5, TerrainType.Mountain, 1);
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 5, y: 5 });

    expect(ids()).toEqual(['a']);
    expect(executor.getUndoStackSize()).toBe(undoBefore);
    expect(getCell(gs.cells, 5, 5)?.terrain?.elevation).toBe(1); // untouched, not peeled
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('regression: an UNMODIFIED click still erases normally', () => {
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
    // A lone tier-3 block: clicking it WITHOUT Ctrl cuts a convex corner (see edge-cut-tool.test.ts).
    setTerrain(gs, 10, 10, TerrainType.Mountain, 3);
    const undoBefore = executor.getUndoStackSize();
    setHeld(true);

    gesture({ x: 10, y: 10 });

    expect(ids()).toEqual(['a']);
    expect(executor.getUndoStackSize()).toBe(undoBefore);
    // No cut: a fresh cell's corners are unset until the first trim touches them.
    expect(getCell(gs.cells, 10, 10)!.terrain!.corners).toBeUndefined();
    expect(useEditorStore.getState().activeTool).toBe(ToolType.Hand);
  });

  it('regression: an UNMODIFIED click still cuts normally', () => {
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
