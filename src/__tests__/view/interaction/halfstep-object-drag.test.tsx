// @vitest-environment jsdom
/**
 * Dragging a halfStep object through the real pointer path steps in half cells. A drag site that
 * computes `placement cell + grabOffset` is already whole-stepped before any snap runs, so the
 * object could start on the half grid but never reach it by dragging. `object-drag-move.test.ts`
 * calls `planObjectMove` with a hand-picked x.5 and never exercises that arithmetic.
 *
 * This drives `usePointerInteraction` over a view reporting a continuous point: a drag inside one
 * whole placement cell must still move the object by half a cell.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { TerrainType, type GridState, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { __setCatalogItem } from '../../../state/catalog';
import { makeStubView } from '../../_support/tool-manager';
import { makeState, setTerrain } from '../../_support/map-state';
import { setStoreState, armedEditMode } from '../../_support/store';
import { createExecutor } from '../../../state/executor';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { ItemCategory } from '../../../config/catalog/categories';

__setCatalogItem({
  id: 'hs-drag-slab', category: ItemCategory.Facility, name: { en: 'HalfStep Drag Slab' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [{ type: 'halfStep' }],
});

/** 1 cell = 10 screen px (half cell = 5px). The view reports the continuous point, as the real
 *  2D/3D projections do; its half-cell point (round(2·p)/2) is what a floor-derived drag path never
 *  reads. */
function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showGroupPlacementGhost: vi.fn(), showObjectMove: vi.fn(),
  };
  const view = {
    projection: {
      screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
            cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 1 }),
    },
    overlay,
    camera: { pan: vi.fn(), zoomStep: vi.fn(), zoomBy: vi.fn() },
    plopObject: vi.fn(),
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
let executor: CommandExecutor;

/** A real ToolManager over the given objects, hand mode (no item armed), the given object
 *  pre-selected so a press on it arms drag-to-move. Returns the mocked overlay so a test can
 *  inspect the live ghost mid-drag (before any drop). */
function arm(objects: PlacedObject[], size = 20): { overlay: ReturnType<typeof makeView>['overlay'] } {
  gs = makeState(size, size);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: objects });
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const { view, overlay } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor,
    selection: objects.map((o) => ({ kind: 'object', id: o.id }) as const), selectingRegion: false,
    contextMenu: null, ...armedEditMode({ tool: ToolType.ObjectPlacer, item: null }),
  });
  return { overlay };
}

/** Press at `from`, drag to `to`, release — raw screen px, not macro cells (the whole point here
 *  is picking pixels that straddle a half boundary without crossing a whole one). */
function drag(from: { x: number; y: number }, to: { x: number; y: number }): void {
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: from.x, clientY: from.y }));
  window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: to.x, clientY: to.y }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: to.x, clientY: to.y }));
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
});

describe('dragging a halfStep object through the real pointer path', () => {
  it('steps in HALF cells, never getting stuck at the offset it started with', () => {
    // The slab sits at (4.5, 5); its footprint is [4.5, 5.5) x [5, 6), and the press must land on
    // it: map point (5.1, 5.5) does.
    const slab: PlacedObject = { id: 'r', catalogId: 'hs-drag-slab', position: { x: 4.5, y: 5 }, rotation: 0, elevation: 0 };
    arm([slab]);

    // Press at (51, 55): half-cell point (5.0, 5.5) → grabOffset = (4.5 - 5.0, 5 - 5.5) = (-0.5, -0.5).
    // Drag to (55, 55): the placement cell is still (5, 5) — the same whole cell as the press,
    // never crossing a whole-cell boundary — but the half-cell point is now (5.5, 5.5). Only a drag
    // that actually reads the half-cell point can move the slab at all here: anchor = half + grabOffset =
    // (5.5 - 0.5, 5.5 - 0.5) = (5.0, 5.0).
    drag({ x: 51, y: 55 }, { x: 55, y: 55 });

    const moved = gs.objects.get('r');
    expect(moved, 'the slab survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 5, y: 5 });
  });

  it('a NON-halfStep object dragged the same way stays whole-cell (byte-identical pin)', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };
    arm([tree]);

    // A real whole-cell drag: press mid-cell (5,5), drag to mid-cell (8,8).
    drag({ x: 55, y: 55 }, { x: 85, y: 85 });

    const moved = gs.objects.get('t');
    expect(moved, 'the tree survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 8, y: 8 });
    expect(Number.isInteger(moved!.position.x)).toBe(true);
    expect(Number.isInteger(moved!.position.y)).toBe(true);
  });

  it('the live drag ghost of a half-anchored ramp reads its OWN planned elevation, not the ground under a half index', () => {
    // `gs.cells[y]?.[x]` with a fractional x is undefined, so an inline whole-cell lookup always
    // reads elevation 0 — the ghost "sinks to ground" for exactly the decks the half grid exists
    // for. Same cliff shape as
    // object-drag-move.test.ts's half-anchor case: a mountain band at y <= 9, a shoulder at
    // x = 7 and a water bank at x = 4 for y in [10, 14] leave a lane only the half anchor at
    // x = 4.5 clears, so the heightDrop trait re-detects there and stamps elevation 1 (the
    // mountain's own height) on the validated candidate — the value the ghost must read.
    const S = 24;
    const ramp: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 15, y: 9 }, rotation: 0, elevation: 1 };
    const { overlay } = arm([ramp], S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y <= 9) setTerrain(gs, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(gs, 7, y, TerrainType.Mountain, 1);
      setTerrain(gs, 4, y, TerrainType.Water, 0);
    }

    // Press exactly on the ramp's own anchor (15, 9): grabOffset {0, 0}. Drag to screen (45, 100)
    // — the half-cell point is (4.5, 10) — so the drop anchor is the half-anchored lane at x = 4.5.
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 150, clientY: 90 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 45, clientY: 100 }));

    expect(overlay.showObjectMove).toHaveBeenCalled();
    const calls = (overlay.showObjectMove as ReturnType<typeof vi.fn>).mock.calls;
    const [[preview], valid] = calls[calls.length - 1]!;
    const { position: { x: gx, y: gy }, elevation } = preview;
    expect(valid, 'the half anchor re-detects a legal ramp').toBe(true);
    expect({ x: gx, y: gy }).toEqual({ x: 4.5, y: 9 });
    expect(elevation, 'the deck elevation, not the ground under a half index').toBe(1);
    expect(overlay.showObjectMove).toHaveBeenLastCalledWith([expect.objectContaining({ position: { x: 4.5, y: 9 }, elevation: 1 })], true);

    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 45, clientY: 100 }));
  });
});
