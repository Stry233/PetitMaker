// @vitest-environment jsdom
/**
 * A card carried from the shelf onto the map: the map under the pointer shows the placer's own
 * preview, a release over it is the placer's click (its rules, its refusal, one undo step), and
 * every other ending changes nothing. Whatever was armed before comes back however the carry ends.
 *
 * Driven through the real pointer machine, ToolManager, executor and the shelf's carry verb; the
 * list entry holding the pointer is a plain element, and hit testing is the one stub.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../../view/active-view';
import { __resetCursorController } from '../../../../view/interaction/cursor-controller';
import { cursorCss } from '../../../../assets/cursors/cursor-css';
import { isCarried, type CarrySample } from '../../../../view/interaction/pointer/carry';
import type { ActiveView } from '../../../../tools/pointer/runtime';
import { type GridState, type PlacedObject } from '../../../../core/model/types';
import { ToolType } from '../../../../state/editing/vocabulary';
import { bumpObjectsVersion } from '../../../../core/model/grid-model';
import { useEditorStore } from '../../../../state/store';
import { CommandExecutor } from '../../../../core/commands/command-executor';
import { createDefaultRegistry } from '../../../../rules/index';
import { ToolManager } from '../../../../tools/pointer/runtime/tool-manager';
import { makeStubView, headlessViewVerbs } from '../../../_support/tool-manager';
import { makeState } from '../../../_support/map-state';
import { setStoreState, armedEditMode } from '../../../_support/store';
import { createExecutor } from '../../../../state/executor';
import { armedItemOf } from '../../../../state/editing/edit-mode';
import { editorToolWiring } from '../../../../editor/session/tool-wiring';
import { carryItem } from '../../../../editor/editing/object-shelf';
import { RUN } from '../../../../editor/commands/commands';

const CARRIED = 'tree-apple';
const OTHER = 'tree-pine';
const POINTER = 7;

function makeView() {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
    showBand: vi.fn(), clearBand: vi.fn(), showPlacementGhost: vi.fn(), showObjectMove: vi.fn(),
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
  return { view, overlay };
}

function Host() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let card: HTMLElement;
let gs: GridState;
let executor: CommandExecutor;
let overlay: ReturnType<typeof makeView>['overlay'];
let ended: number;

/** The map takes the left 400 px of the screen; the shelf the band below 300 px. */
const LIST_Y = 350;
const overMap = (cell: { x: number; y: number }): CarrySample => (
  { pointerId: POINTER, pointerType: 'mouse', clientX: cell.x * 10 + 5, clientY: cell.y * 10 + 5, timeStamp: 0 });
const overList: CarrySample = { pointerId: POINTER, pointerType: 'mouse', clientX: 40, clientY: LIST_Y, timeStamp: 0 };

function tree(id: string, x: number, y: number): PlacedObject {
  return { id, catalogId: CARRIED, position: { x, y }, rotation: 0, elevation: 0 };
}

/** The app's own wiring over a 20×20 map, the placer up with `armed` (or nothing) armed. */
function setUp(armed: string | null, ...objects: PlacedObject[]): void {
  gs = makeState(20, 20);
  for (const obj of objects) gs.objects.set(obj.id, obj);
  if (objects.length > 0) bumpObjectsVersion(gs, { added: objects });
  executor = createExecutor(gs, createDefaultRegistry(), useEditorStore.getState().eventBus);
  const tm = new ToolManager(makeStubView(), executor, gs, editorToolWiring());
  const made = makeView();
  overlay = made.overlay;
  setActiveView(made.view);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.ObjectPlacer);
  setStoreState({
    gridState: gs, commandExecutor: executor, selection: [], selectingRegion: false, contextMenu: null,
    ...armedEditMode({ tool: ToolType.ObjectPlacer, item: armed }),
  });
}

const carry = () => {
  const c = carryItem(CARRIED, { pointerId: POINTER, surface: card, onEnd: () => { ended++; } });
  if (!c) throw new Error('the card could not be carried');
  return c;
};
const armedItem = () => armedItemOf(useEditorStore.getState());
const placedAt = (x: number, y: number) => [...gs.objects.values()].some((o) => o.position.x === x && o.position.y === y);

beforeEach(() => {
  __resetCursorController();
  ended = 0;
  const { getByTestId } = render(<><Host /><button data-testid="card" style={{ cursor: 'pointer' }} /></>);
  canvas = getByTestId('canvas');
  card = getByTestId('card');
  document.elementFromPoint = (x: number, y: number) => (x < 400 && y < 300 ? canvas : card);
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
  delete (document as { elementFromPoint?: unknown }).elementFromPoint;
});

describe('a card carried onto the map', () => {
  it('previews the placement over the map and places where it is released, as one undo step', () => {
    setUp(null);
    const c = carry();
    expect(armedItem()).toBe(CARRIED); // the placer's own preview reads the armed item

    c.move(overList);
    expect(overlay.showGhost).not.toHaveBeenCalled(); // nothing to preview over the shelf

    c.move(overMap({ x: 12, y: 12 }));
    expect(overlay.showGhost).toHaveBeenLastCalledWith(expect.anything(), { wash: 'placement', valid: true });

    c.release(overMap({ x: 12, y: 12 }));
    expect(placedAt(12, 12)).toBe(true);
    expect(executor.historyDepth()).toBe(1);
    expect(armedItem()).toBeNull(); // nothing was armed before the carry
    expect(ended).toBe(1);
    expect(isCarried(POINTER)).toBe(false);

    executor.undo();
    expect(placedAt(12, 12)).toBe(false);
  });

  it('says why a refused drop is refused, places nothing and selects nothing', () => {
    setUp(null, tree('a', 5, 5));
    const failures: unknown[] = [];
    const onFail = (e: unknown): void => { failures.push(e); };
    const bus = useEditorStore.getState().eventBus;
    bus.on('validation-failed', onFail as never);

    const c = carry();
    c.move(overMap({ x: 5, y: 5 }));
    expect(overlay.showGhost).toHaveBeenLastCalledWith(expect.anything(), { wash: 'placement', valid: false });
    c.release(overMap({ x: 5, y: 5 }));
    bus.off('validation-failed', onFail as never);

    expect(failures).toHaveLength(1);
    expect(gs.objects.size).toBe(1);
    expect(executor.historyDepth()).toBe(0);
    // A click with the item armed would select the tree it was refused over; a drop reaches the placer.
    expect(useEditorStore.getState().selection).toEqual([]);
    expect(armedItem()).toBeNull();
  });

  it('puts back the item that was armed, with its pending rotation', () => {
    setUp(OTHER);
    useEditorStore.getState().setPlacementRotation(90);

    const c = carry();
    expect(useEditorStore.getState().placementRotation).toBe(0); // the carried item stands as it is drawn
    c.release(overMap({ x: 12, y: 12 }));

    expect([...gs.objects.values()].find((o) => o.position.x === 12)?.catalogId).toBe(CARRIED);
    expect(armedItem()).toBe(OTHER);
    expect(useEditorStore.getState().placementRotation).toBe(90);
  });

  it('keeps the carried item armed when it was the armed one', () => {
    setUp(CARRIED);
    useEditorStore.getState().setPlacementRotation(90);
    const c = carry();
    c.release(overMap({ x: 12, y: 12 }));
    expect(placedAt(12, 12)).toBe(true);
    expect(armedItem()).toBe(CARRIED);
    expect(useEditorStore.getState().placementRotation).toBe(90);
  });
});

describe('the cursor a carry shows', () => {
  it('is the closed hand off the map, and the card wears its own cursor again afterwards', () => {
    setUp(null);
    const c = carry();
    expect(card.style.cursor).toBe(cursorCss('hand-closed'));
    c.move(overMap({ x: 12, y: 12 }));
    expect(card.style.cursor).not.toBe(cursorCss('hand-closed')); // the tool's own cursor says what the drop does
    c.move(overList);
    expect(card.style.cursor).toBe(cursorCss('hand-closed'));
    c.release(overList);
    expect(card.style.cursor).toBe('pointer');
  });
});

describe('a carry that does not land on the map', () => {
  it('changes nothing when released back over the shelf, and takes its preview down', () => {
    setUp(null);
    const c = carry();
    c.move(overMap({ x: 12, y: 12 }));
    overlay.clearGhost.mockClear();
    c.move(overList);
    expect(overlay.clearGhost).toHaveBeenCalled();

    c.release(overList);
    expect(gs.objects.size).toBe(0);
    expect(executor.historyDepth()).toBe(0);
    expect(armedItem()).toBeNull();
    expect(ended).toBe(1);
  });

  it('changes nothing when Escape is pressed mid-carry, and the release after it is no drop', () => {
    setUp(null);
    const c = carry();
    c.move(overMap({ x: 12, y: 12 }));

    RUN['selection.deselect']({} as never);
    expect(isCarried(POINTER)).toBe(false);
    expect(armedItem()).toBeNull();
    expect(ended).toBe(1);

    c.release(overMap({ x: 12, y: 12 }));
    expect(gs.objects.size).toBe(0);
    expect(executor.historyDepth()).toBe(0);
    expect(ended).toBe(1);
  });

  it('changes nothing when the browser takes the pointer', () => {
    setUp(OTHER);
    const c = carry();
    c.move(overMap({ x: 12, y: 12 }));
    c.cancel();
    expect(gs.objects.size).toBe(0);
    expect(armedItem()).toBe(OTHER);
    expect(ended).toBe(1);
  });

  it('leaves the map machine deaf to the carried pointer, so its window release runs no press', () => {
    setUp(null);
    const c = carry();
    // A captured pointer still bubbles to the window, where the machine listens.
    const up = new MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 125, clientY: 125 });
    Object.defineProperty(up, 'pointerId', { value: POINTER });
    window.dispatchEvent(up);
    expect(gs.objects.size).toBe(0);
    expect(isCarried(POINTER)).toBe(true);
    c.cancel();
  });
});
