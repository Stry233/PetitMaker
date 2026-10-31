// @vitest-environment jsdom
/**
 * Dragging a halfStep object through `usePointerInteraction` steps in half cells: a drag inside one
 * whole placement cell still moves the object by half a cell. A drag computing `placement cell +
 * grabOffset` would be whole-stepped before any snap runs.
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

/** 1 cell = 10 screen px. The view reports the continuous point, as the real projections do. */
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

/** A real ToolManager over `objects` with no item armed and the objects selected, so a press on one
 *  arms drag-to-move. Returns the mocked overlay for reading the live ghost. */
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

/** Press at `from`, drag to `to`, release, in screen px so a move can cross a half boundary only. */
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
    // The footprint is [4.5, 5.5) x [5, 6), so the press at map point (5.1, 5.5) lands on it.
    const slab: PlacedObject = { id: 'r', catalogId: 'hs-drag-slab', position: { x: 4.5, y: 5 }, rotation: 0, elevation: 0 };
    arm([slab]);

    // The press's half-cell point (5.0, 5.5) gives grabOffset (-0.5, -0.5). At (55, 55) the placement
    // cell is still (5, 5) but the half-cell point is (5.5, 5.5), so the anchor becomes (5.0, 5.0).
    drag({ x: 51, y: 55 }, { x: 55, y: 55 });

    const moved = gs.objects.get('r');
    expect(moved, 'the slab survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 5, y: 5 });
  });

  it('a NON-halfStep object dragged the same way stays whole-cell (byte-identical pin)', () => {
    const tree: PlacedObject = { id: 't', catalogId: 'tree-apple', position: { x: 5, y: 5 }, rotation: 0, elevation: 0 };
    arm([tree]);

    drag({ x: 55, y: 55 }, { x: 85, y: 85 });

    const moved = gs.objects.get('t');
    expect(moved, 'the tree survived the drag').toBeTruthy();
    expect(moved!.position).toEqual({ x: 8, y: 8 });
    expect(Number.isInteger(moved!.position.x)).toBe(true);
    expect(Number.isInteger(moved!.position.y)).toBe(true);
  });

  it('the live drag ghost of a half-anchored ramp reads its OWN planned elevation, not the ground under a half index', () => {
    // `gs.cells[y]?.[x]` with a fractional x is undefined, so a whole-cell lookup would read elevation
    // 0. A mountain band at y <= 9, a shoulder at x = 7 and a water bank at x = 4 for y in [10, 14]
    // leave a lane only the half anchor at x = 4.5 clears, where heightDrop stamps elevation 1.
    const S = 24;
    const ramp: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 15, y: 9 }, rotation: 0, elevation: 1 };
    const { overlay } = arm([ramp], S);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (y <= 9) setTerrain(gs, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(gs, 7, y, TerrainType.Mountain, 1);
      setTerrain(gs, 4, y, TerrainType.Water, 0);
    }

    // Pressed on the ramp's anchor, so grabOffset is zero; (45, 100) is the half-cell point (4.5, 10).
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
