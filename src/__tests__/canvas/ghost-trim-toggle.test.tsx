/**
 * The ghost promises the shape the stroke will leave, so auto-trim is one of its inputs — and the
 * pointer is not the only thing that can change it. Turning the trim on with the cursor standing
 * over the map used to leave the square-cornered preview where it was until the mouse moved, while
 * a stroke started from that same standing position committed a trimmed shape. The ghost was then
 * promising something the click did not do.
 *
 * Driven through the STORE, which is the half the tool-level pins miss: they hand the tool a
 * context with `autoEdgeCut` already set, so nothing in them exercises the toggle reaching the
 * ghost's redraw at all.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { ToolType, type GridState } from '../../core/model/types';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { DrawingTool } from '../../tools/paint/drawing-tool';
import type { TrimmedCell } from '../../tools/edge-cut/trim-preview';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { roadLookup } from '../../state/object-index';

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

function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

let el: HTMLElement;
let gs: GridState;
let overlay: ReturnType<typeof makeView>['overlay'];

/** The brush armed the way the canvas arms it: the store for the manager's mirror, the DrawingTool
 *  instance for the shape and the surface (which the canvas writes directly). */
function armBrush(surface: 'mountain' | 'tile'): void {
  gs = makeState(20, 20);
  const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.TerrainBrush,
    contentType: surface, selectedItemId: null, selection: [], selectingRegion: false,
    contextMenu: null, autoEdgeCut: 'off', brushSize: 3, activeLayer: 1,
  });
  tm.setActiveTool(ToolType.TerrainBrush);
  tm.brushSize = 3;
  tm.elevation = 1;
  const dt = tm.getToolById?.(ToolType.TerrainBrush);
  if (dt instanceof DrawingTool) { dt.mode = 'brush'; dt.contentType = surface; }
}

/** The trim the last ghost carried. */
function lastTrim(): readonly TrimmedCell[] | undefined {
  const calls = overlay.showGhost.mock.calls;
  return calls[calls.length - 1]?.[3] as readonly TrimmedCell[] | undefined;
}

beforeEach(() => {
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  setStoreState({ autoEdgeCut: 'off', contentType: 'mountain', brushSize: 1 });
});

describe('the ghost trims when the stroke will', () => {
  it('carries the trim on an ordinary hover with auto-trim on', () => {
    armBrush('mountain');
    setStoreState({ autoEdgeCut: 'round' });
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    const trim = lastTrim() ?? [];
    expect(trim.length, 'the dab’s convex corners').toBeGreaterThan(0);
    expect(trim.some((t) => t.corners.some((c) => c !== 'square'))).toBe(true);
  });

  it('redraws the standing ghost when the setting is toggled under a still pointer', () => {
    armBrush('mountain');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(lastTrim(), 'off: a square promise').toBeUndefined();
    overlay.showGhost.mockClear();

    setStoreState({ autoEdgeCut: 'round' });

    expect(overlay.showGhost, 'the toggle has to reach the ghost, not wait for a mouse move').toHaveBeenCalled();
    const trim = lastTrim() ?? [];
    expect(trim.some((t) => t.corners.some((c) => c !== 'square'))).toBe(true);
  });

  it('takes the trim away again when it is turned off', () => {
    armBrush('mountain');
    setStoreState({ autoEdgeCut: 'round' });
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();

    setStoreState({ autoEdgeCut: 'off' });

    expect(overlay.showGhost).toHaveBeenCalled();
    expect(lastTrim()).toBeUndefined();
  });

  // A road ghost carries its own trim too: a road's cut follows which sides it connects on, and the
  // preview shadows the coating lookup so the ghost's own tiles answer that question.
  it('redraws the road ghost on the toggle, and it arrives carrying its cuts', () => {
    armBrush('tile');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(lastTrim(), 'off: a square promise').toBeUndefined();
    overlay.showGhost.mockClear();

    setStoreState({ autoEdgeCut: 'round' });

    expect(overlay.showGhost).toHaveBeenCalled();
    const trim = lastTrim() ?? [];
    expect(trim.length, 'the dab’s end-caps and bends').toBeGreaterThan(0);
    // A road cut is named against the side it connects on — the field is what tells a view to draw
    // the road shape rather than four quadrants.
    expect(trim.every((t) => !!t.road)).toBe(true);
  });

  // Same class of staleness, same one list: the road material is what the ghost is COLOURED by and
  // what a tile click places, and nothing else asks for a redraw when it changes.
  it('redraws when the road material changes under a still pointer', () => {
    armBrush('tile');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();

    setStoreState({ tileMaterial: 'road-stone' });

    expect(overlay.showGhost).toHaveBeenCalled();
  });
});
