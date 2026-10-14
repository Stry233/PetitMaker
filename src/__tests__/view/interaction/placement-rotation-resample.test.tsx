// @vitest-environment jsdom
/**
 * The rotate shortcut (the E default, `rotateArmedOrSelected` in `editor/commands/commands.ts`) writes
 * `placementRotation` straight into the store — no pointer event runs alongside it — so
 * `ObjectPlacerTool.onPointerMove`, which only runs from a real pointermove, never redraws the
 * ghost at the new orientation until the cursor next moves for real. `usePointerInteraction`
 * resamples the last known screen position on a `placementRotation` change the same way it already
 * does for a camera pan (see `camera-pan-resample.test.tsx`); this drives that resampler directly
 * through the real handlers, a real ToolManager + executor, and a fake view, with no further
 * pointer event between arming the placer and rotating it.
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
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { makeStubView } from '../../_support/tool-manager';
import { makeState } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';

const ARMED = 'building-stall'; // a rotatable, flat 1x1 catalog item

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(),
  };
  const camera = { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() };
  const view = {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay, camera,
  } as unknown as ActiveView;
  return { view, overlay, camera };
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

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;
let tm: ToolManager;
let overlay: ReturnType<typeof makeView>['overlay'];

/** The app's own wiring: a real ToolManager over a fresh grid, pointed at the test view, with a
 *  rotatable item armed for placement. */
function activate(): void {
  gs = makeState(20, 20);
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, placementRotation: 0, selection: [], selectingRegion: false,
    contextMenu: null, ...armedEditMode({ tool: ToolType.ObjectPlacer, item: ARMED }),
  });
}

beforeEach(() => {
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  setStoreState({ placementRotation: 0 });
});

describe('a placementRotation change under a stationary pointer', () => {
  it('redraws the placement ghost at the new rotation with no further pointer event', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    overlay.showPlacementGhost.mockClear();

    setStoreState({ placementRotation: 90 }); // the shortcut's own write, no pointer event follows

    expect(overlay.showPlacementGhost).toHaveBeenCalled();
    const calls = overlay.showPlacementGhost.mock.calls;
    const lastCall = calls[calls.length - 1]!;
    expect(lastCall[0].rotation).toBe(90); // the ghost picked up the new rotation
  });

  it('does not resample when a write leaves placementRotation unchanged', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    const moveSpy = vi.spyOn(tm, 'handlePointerMove');
    moveSpy.mockClear();

    setStoreState({ placementRotation: 0 }); // same value: not an actual rotation change

    expect(moveSpy).not.toHaveBeenCalled();
  });

  it('stops resampling once the pointer has left the canvas', () => {
    activate();
    el.dispatchEvent(pointer('pointermove', { buttons: 0, clientX: 55, clientY: 55 }));
    el.dispatchEvent(pointer('pointerleave', { clientX: 55, clientY: 55 }));
    const moveSpy = vi.spyOn(tm, 'handlePointerMove');

    setStoreState({ placementRotation: 90 });

    expect(moveSpy).not.toHaveBeenCalled();
  });
});
