// @vitest-environment jsdom
/**
 * The press path builds `PressFacts` from `ToolManager.getContext()` at press time. A touch tap has
 * no preceding move to refresh the mirror: `onPointerDown` never sets `pointerKnown` for touch, so
 * `resamplePointer` returns early. This re-arms the placer through the store alone and taps with
 * `pointerType: 'touch'`; the press must decide from the arming as it stands at the tap.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { getActiveToolManager, registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController, registerCursorSurface, setToolCursor } from '../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../assets/cursors/cursor-css';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { type GridState, type PlacedObject } from '../../../core/model/types';
import { ToolType } from '../../../state/editing/vocabulary';
import { CellZone } from '../../../core/game/zones';
import { bumpObjectsVersion } from '../../../core/model/grid-model';
import { useEditorStore } from '../../../state/store';
import { CommandExecutor } from '../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../rules/index';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import { selectedObjectIds } from '../../../state/selection';
import { headlessViewVerbs, makeStubView } from '../../_support/tool-manager';
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
    ...headlessViewVerbs(),
  } as unknown as ActiveView;
  return { view };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" style={{ width: 400, height: 300 }} />;
}

/** jsdom has no PointerEvent; MouseEvent carries every field the machine reads. `pointerType` and
 *  `pointerId` are not MouseEvent fields, so they are defined on the instance directly. */
function pointer(type: string, init: MouseEventInit & { pointerType?: string; pointerId?: number }): MouseEvent {
  const { pointerType, pointerId, ...rest } = init;
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...rest });
  if (pointerType) Object.defineProperty(e, 'pointerType', { value: pointerType });
  if (pointerId !== undefined) Object.defineProperty(e, 'pointerId', { value: pointerId });
  return e;
}

function road(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: 'path-overgrown-dirt', position: { x, y }, rotation: 0, elevation: 0 };
}

let el: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;

/** The app's own wiring: a real ToolManager over the same grid, pointed at the test view, with the
 *  object placer active and `item` armed. */
function arm(item: string | null, ...objects: PlacedObject[]): void {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  if (objects.length > 0) bumpObjectsVersion(gs, { added: objects });
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const { view } = makeView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    ...armedEditMode({ tool: ToolType.ObjectPlacer, item: item }),
  });
}

/** A touch tap at a cell: pointerdown then pointerup, `pointerType: 'touch'` throughout and no
 *  pointermove in between — the one shape a mouse gesture can always avoid (a real finger has
 *  nothing to hover with) and the one this finding is about. */
function touchTap(at: { x: number; y: number }): void {
  const sx = at.x * 10 + 5, sy = at.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy, pointerType: 'touch', pointerId: 1 }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx, clientY: sy, pointerType: 'touch', pointerId: 1 }));
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
});

describe('a touch tap decides from the arming as it stands, not as it stood', () => {
  it('refreshes terrain refusal when the pointer crosses a terrain boundary inside one object cell', () => {
    arm(null);
    gs.cells[5]![5]!.zone = CellZone.Beach;
    const manager = getActiveToolManager()!;
    manager.setActiveTool(ToolType.TerrainBrush);
    setStoreState({ autoEdgeCut: 'off', ...armedEditMode({ tool: ToolType.TerrainBrush, content: 'mountain' }) });
    registerCursorSurface(el);
    setToolCursor('mountain');
    el.dispatchEvent(pointer('pointermove', { clientX: 42, clientY: 42 }));
    expect(el.style.cursor).toBe(cursorCss('mountain'));
    el.dispatchEvent(pointer('pointermove', { clientX: 47, clientY: 47 }));
    expect(el.style.cursor).toBe(cursorCss('mountain', { forbidden: true }));
  });

  it('selects the road under a fresh, unspannable bridge arming — even though the ctx last settled on a tree', () => {
    // A road tile is a coating: V-PLACE-OVERLAP exempts it, so a point item that is otherwise legal
    // here (a tree, on flat open grass) reads `placementAllowed: true` over it — that is the ctx
    // this test deliberately settles on first, with a real (non-touch) tap elsewhere, exactly the
    // kind of press that already refreshes the mirror on its own.
    arm('tree-apple', road('r1', 5, 5));
    touchTap({ x: 15, y: 15 }); // settles ctx on 'tree-apple' via a real press (harmless empty cell)
    expect(ids()).toEqual([]);

    // Re-arm through the store alone — the shelf picking a new card, with no pointer event
    // following it. `bridge-plank` cannot span flat ground with no gap (already established by
    // `tool-cursors.test.ts`'s "refuses a bridge where no legal span exists"), so its
    // `placementAllowed` at this same cell is false — the opposite of the tree's.
    setStoreState({ ...armedEditMode({ item: 'bridge-plank', tool: ToolType.ObjectPlacer }) });

    // The touch-tap shape: no move precedes it, so nothing but `getContext()` itself can hand the
    // press a fresh mirror. Stale (pre-fix): `placementAllowed` still reads the tree's `true`, so
    // `armedPressSelects` is false, the press falls through to a refused tool-stroke, and the road
    // is never selected. Fresh (post-fix): `placementAllowed` reads the bridge's `false`, so the
    // press selects the unlocked road instead.
    touchTap({ x: 5, y: 5 });

    expect(ids(), 'the press acted on the NEW (bridge) arming, not the one the mirror last held').toEqual(['r1']);
    expect(gs.objects.has('r1'), 'the road was selected, not consumed by a placement attempt').toBe(true);
  });
});
