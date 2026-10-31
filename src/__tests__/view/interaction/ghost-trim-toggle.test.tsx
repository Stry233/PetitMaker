// @vitest-environment jsdom
/**
 * Auto-trim is an input of the ghost, so toggling it under a still pointer redraws the ghost rather
 * than leaving a square preview until the mouse moves. Driven through the store: tool-level tests
 * hand the tool a context with `autoEdgeCut` already set, so they never exercise the toggle.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { type GridState } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { useEditorStore } from '../../../state/store';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import type { TrimmedCell } from '../../../tools/trim/trim-preview';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
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

function pointer(type: string, init: MouseEventInit): MouseEvent {
  return new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
}

let el: HTMLElement;
let gs: GridState;
let overlay: ReturnType<typeof makeView>['overlay'];

/** Arms the brush through the store, as the bar does; tools read it through `armingOf`. */
function armBrush(surface: 'mountain' | 'road'): void {
  gs = makeState(20, 20);
  const executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false,
    contextMenu: null, autoEdgeCut: 'off', activeLayer: 1, drawingBrushSize: 3,
    ...armedEditMode({ tool: ToolType.TerrainBrush, content: surface, item: null }),
  });
  tm.setActiveTool(ToolType.TerrainBrush);
}

/** The trim the last ghost carried. */
function lastTrim(): readonly TrimmedCell[] | undefined {
  const calls = overlay.showGhost.mock.calls;
  return calls[calls.length - 1]?.[2] as readonly TrimmedCell[] | undefined;
}

beforeEach(() => {
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  setStoreState({
    autoEdgeCut: 'off', drawingBrushSize: 1,
    ...armedEditMode({ content: 'mountain', tool: ToolType.TerrainBrush }),
  });
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

  // A road's cut follows the sides it connects on; the preview shadows the coating lookup so the
  // ghost's own tiles count as connections.
  it('redraws the road ghost on the toggle, and it arrives carrying its cuts', () => {
    armBrush('road');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    expect(lastTrim(), 'off: a square promise').toBeUndefined();
    overlay.showGhost.mockClear();

    setStoreState({ autoEdgeCut: 'round' });

    expect(overlay.showGhost).toHaveBeenCalled();
    const trim = lastTrim() ?? [];
    expect(trim.length, 'the dab’s end-caps and bends').toBeGreaterThan(0);
    // The `road` field tells a view to draw the road shape rather than four quadrants.
    expect(trim.every((t) => !!t.road)).toBe(true);
  });

  // The road material colours the ghost, and only the store change can ask for a redraw.
  it('redraws when the road material changes under a still pointer', () => {
    armBrush('road');
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showGhost.mockClear();

    setStoreState({ tileMaterial: 'path-cobblestone' });

    expect(overlay.showGhost).toHaveBeenCalled();
  });
});
