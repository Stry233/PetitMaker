/**
 * Defect: dragging a PLURAL selection only ever showed the ghost for the one member under the
 * cursor, so the user couldn't see where the rest of the group was going or whether it fit. This
 * drives the real pointer machine (usePointerInteraction) over a mocked ActiveView — no PixiJS/GPU
 * involved, so the assertions are on the OVERLAY CALLS the machine makes, not on any pixel.
 *
 * Three things pinned here:
 *  - the cell wash (`showGhost`) covers every member's footprint, not just the dragged one;
 *  - the group's body ghost (`showGroupPlacementGhost`) carries all N members with ONE shared
 *    validity verdict (a group move is all-or-nothing, so a per-member tint would lie);
 *  - the per-move cost is bounded: a pointermove that lands on the SAME macro cell as the last one
 *    does not re-run the group validity check or rebuild the ghost (throttled on the cell, not a
 *    timer), while a move to a new cell does.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { registerToolManager, setActiveView } from '../../canvas/active-view';
import { __resetCursorController } from '../../canvas/interaction/cursor-controller';
import type { ActiveView } from '../../canvas/view-projection';
import { ItemCategory, TerrainType, ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { ToolManager } from '../../tools/tool-manager';
import { makeStubRenderer } from '../tools/_tool-manager';
import { makeState, setTerrain } from '../rules/_helpers';
import { setStoreState } from '../_store';
import { registerCatalogItem } from '../../state/catalog';
import { roadLookup } from '../../state/object-index';

// A plain 1x1 draggable item with NO traits (a real catalog tree carries an exclusionRadius that
// would refuse two of them sitting one cell apart, which is exactly the tight arrangement these
// tests drag around — see group-move.test.ts's 'grp-hut' for the same convention).
const ITEM = 'ghost-test-hut';
registerCatalogItem({
  id: ITEM, category: ItemCategory.Building, name: { en: 'Ghost Test Hut' },
  width: 1, height: 1, loadValue: 0, rotatable: false, placementMode: 'point',
  traits: [],
});

function tree(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: ITEM, position: { x, y }, rotation: 0, elevation: 0 };
}

function makeMockView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(),
    showPlacementGhost: vi.fn(), showGroupPlacementGhost: vi.fn(),
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
    plopObject: vi.fn(),
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
let executor: CommandExecutor;

function setUp(objects: PlacedObject[], selectedIds: string[]) {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: objects });
  executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry(), roadLookup(gs));
  const tm = new ToolManager(makeStubRenderer(), executor, gs);
  const { view, overlay } = makeMockView();
  setActiveView(view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Hand);
  setStoreState({
    gridState: gs, commandExecutor: executor, activeTool: ToolType.Hand, selectedItemId: null,
    selection: selectedIds.map((id) => ({ kind: 'object', id }) as const), selectingRegion: false,
    contextMenu: null,
  });
  return { view, overlay };
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

describe('dragging a plural selection', () => {
  it('ghosts every member (cell wash covers all footprints, body ghost carries all N)', () => {
    // a(5,5) b(6,5) c(7,5), all selected; drag anchored on 'a' by +1 in x.
    const { overlay } = setUp([tree('a', 5, 5), tree('b', 6, 5), tree('c', 7, 5)], ['a', 'b', 'c']);

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 65, clientY: 55 })); // +1 cell

    expect(overlay.showGroupPlacementGhost).toHaveBeenCalledTimes(1);
    const [members, valid] = overlay.showGroupPlacementGhost.mock.calls[0]!;
    expect(valid).toBe(true);
    expect(members).toHaveLength(3);
    expect(members.map((m: { x: number; y: number }) => `${m.x},${m.y}`).sort()).toEqual(['6,5', '7,5', '8,5']);

    // The cell wash is the UNION of every member's footprint, not just the dragged one.
    const cells = overlay.showGhost.mock.calls[0]![0] as Array<{ x: number; y: number }>;
    expect(cells.map((c) => `${c.x},${c.y}`).sort()).toEqual(['6,5', '7,5', '8,5']);
  });

  it('tints the WHOLE group invalid when any one member would collide, even though the others alone would be fine', () => {
    // Sliding the row by +2 lands 'c' on top of 'wall' (not part of the selection).
    const { overlay } = setUp(
      [tree('a', 5, 5), tree('b', 6, 5), tree('c', 7, 5), tree('wall', 9, 5)],
      ['a', 'b', 'c'],
    );

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 75, clientY: 55 })); // +2 cells

    const [, valid] = overlay.showGroupPlacementGhost.mock.calls[0]!;
    expect(valid).toBe(false);
    const [cells, color] = overlay.showGhost.mock.calls[0]!;
    expect(color).not.toBe(0x22c55e); // GHOST_INVALID, not GHOST_VALID
    expect(cells).toHaveLength(3); // still every member's destination, just tinted red
  });

  it('throttles on the hovered CELL, not on every pointer sample', () => {
    const { overlay } = setUp([tree('a', 5, 5), tree('b', 6, 5)], ['a', 'b']);

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 65, clientY: 55 })); // cell (6,5): 1st compute
    expect(overlay.showGroupPlacementGhost).toHaveBeenCalledTimes(1);

    // Two more samples that land on the SAME macro cell: no recompute.
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 66, clientY: 55 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 69, clientY: 56 }));
    expect(overlay.showGroupPlacementGhost).toHaveBeenCalledTimes(1);

    // A sample that crosses into a new macro cell recomputes.
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 75, clientY: 55 }));
    expect(overlay.showGroupPlacementGhost).toHaveBeenCalledTimes(2);
  });

  it('plays the landing squash for every member on drop, requested per member as its own placement lands', () => {
    const { view } = setUp([tree('a', 5, 5), tree('b', 6, 5), tree('c', 7, 5)], ['a', 'b', 'c']);

    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 55 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 65, clientY: 55 }));
    window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: 65, clientY: 55 }));

    expect(gs.objects.get('a')!.position).toEqual({ x: 6, y: 5 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 7, y: 5 });
    expect(gs.objects.get('c')!.position).toEqual({ x: 8, y: 5 });
    expect(view.plopObject).toHaveBeenCalledTimes(3);
    const plopped = (view.plopObject as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0]).sort();
    expect(plopped).toEqual(['a', 'b', 'c']);
  });

  it('a halfStep member of a group reads its OWN planned elevation, not the ground under a half index', () => {
    // Finding 2 (final review, half-step span items): the group ghost duplicated the same broken
    // inline lookup (`gs.cells[y]?.[x]` with a fractional x is undefined) the solo drag ghost had.
    // A mountain band at y <= 9, a shoulder at x = 7 and a water bank at x = 4 for y in [10, 14]
    // leave a lane only the HALF anchor at x = 4.5 clears — a real ramp sitting there already
    // (elevation 1, the mountain's own height) is what a group slide must keep reporting, not 0.
    const ramp: PlacedObject = { id: 'r', catalogId: 'ramp-teak-stair', position: { x: 4.5, y: 9 }, rotation: 0, elevation: 1 };
    const { overlay } = setUp([ramp, tree('h', 2, 2)], ['r', 'h']);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if (y <= 9) setTerrain(gs, x, y, TerrainType.Mountain, 1);
    for (let y = 10; y <= 14; y++) {
      setTerrain(gs, 7, y, TerrainType.Mountain, 1);
      setTerrain(gs, 4, y, TerrainType.Water, 0);
    }

    // Press on the ramp at macro cell (5, 9) (inside its footprint [4, 7) x [9, 13)); the mock
    // view has no screenToHalf, so the group path's own whole-cell grab offset applies:
    // grabOffset = (4.5 - 5, 9 - 9) = (-0.5, 0). Drag to macro (5, 10): dx = 5 - 0.5 - 4.5 = 0,
    // dy = 10 - 9 = 1 — the ramp's candidate lands back at (4.5, 10), which the heightDrop trait
    // re-detects to (4.5, 9), elevation 1 (the SAME lane, one row down from where it's probed).
    el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: 55, clientY: 95 }));
    window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: 55, clientY: 105 }));

    expect(overlay.showGroupPlacementGhost).toHaveBeenCalled();
    const groupCalls = overlay.showGroupPlacementGhost.mock.calls;
    const [members] = groupCalls[groupCalls.length - 1]!;
    const rampGhost = members.find((m: { catalogId: string }) => m.catalogId === 'ramp-teak-stair');
    expect(rampGhost, 'the ramp member is in the ghost').toBeTruthy();
    expect(rampGhost.elevation, 'the deck elevation, not the ground under a half index').toBe(1);
  });
});
