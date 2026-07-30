/**
 * Ctrl+click toggles an object's membership in the selection instead of replacing it, and a
 * Ctrl press on bare ground must never join terrain to a group (the rubber-band drag it starts
 * owns that gesture). Plus the gesture that reads the group back: an unmodified drag from a
 * member moves every member, and refuses aloud when it cannot.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { usePointerInteraction } from '../../canvas/interaction/usePointerInteraction';
import { setActiveView } from '../../canvas/active-view';
import type { ActiveView } from '../../canvas/view-projection';
import { ObjectCategory, ToolType, type GridState, type PlacedObject } from '../../core/model/types';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { useEditorStore } from '../../state/store';
import { CommandExecutor } from '../../core/commands/command-executor';
import { createDefaultRegistry } from '../../rules/index';
import { selectedObjectIds } from '../../state/selection';
import { makeState } from '../rules/_helpers';
import { setStoreState } from '../_store';

function makeView(): { view: ActiveView } {
  const overlay = {
    showGhost: vi.fn(), showGhostSpans: vi.fn(), clearGhost: vi.fn(),
    showSelection: vi.fn(), clearSelection: vi.fn(),
    showHover: vi.fn(), clearHover: vi.fn(), flashCommit: vi.fn(),
    showBuildableRegion: vi.fn(), clearBuildableRegion: vi.fn(),
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
  } as unknown as ActiveView;
  return { view };
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

function mapWithObjects(ids: string[]): GridState {
  const gs = makeState(20, 20);
  const objs: PlacedObject[] = ids.map((id, i) => ({
    id, catalogId: 'tree-apple', position: { x: 2 + i * 3, y: 2 },
    rotation: 0, category: ObjectCategory.Tree, elevation: 0,
  }));
  for (const obj of objs) gs.objects.set(obj.id, obj);
  bumpObjectsVersion(gs, { added: objs });
  return gs;
}

function ids(): string[] {
  return selectedObjectIds(useEditorStore.getState().selection);
}

/** Simulates the physical modifier key: `installModifierTracking` (mounted by the pointer
 *  machine) reads live keydown/keyup, not per-event flags, so a held Ctrl outlives one click. */
function setHeld(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}

let el: HTMLElement;

function clickObject(gs: GridState, id: string): void {
  setStoreState({ gridState: gs });
  const obj = gs.objects.get(id)!;
  const sx = obj.position.x * 10 + 5;
  const sy = obj.position.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx, clientY: sy }));
}

/** Press on `id`, cross the drag threshold, release (dx, dy) macro cells away. */
function dragFrom(gs: GridState, id: string, dx: number, dy: number): void {
  setStoreState({ gridState: gs });
  const obj = gs.objects.get(id)!;
  const sx = obj.position.x * 10 + 5;
  const sy = obj.position.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  window.dispatchEvent(pointer('pointermove', { buttons: 1, clientX: sx + dx * 10, clientY: sy + dy * 10 }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx + dx * 10, clientY: sy + dy * 10 }));
}

function clickGround(gs: GridState, at: { x: number; y: number }): void {
  setStoreState({ gridState: gs });
  const sx = at.x * 10 + 5;
  const sy = at.y * 10 + 5;
  el.dispatchEvent(pointer('pointerdown', { button: 0, buttons: 1, clientX: sx, clientY: sy }));
  window.dispatchEvent(pointer('pointerup', { button: 0, buttons: 0, clientX: sx, clientY: sy }));
}

beforeEach(() => {
  setStoreState({
    activeTool: ToolType.Hand, selectedItemId: null, contextMenu: null,
    selection: [], selectingRegion: false,
  });
  const { view } = makeView();
  setActiveView(view);
  const { getByTestId } = render(<Host />);
  el = getByTestId('canvas');
});

afterEach(() => {
  cleanup();
  setActiveView(null);
  setHeld(false); // a stuck modifier would leak into the next test's clicks
});

describe('Ctrl+click multi-select', () => {
  it('Ctrl+click toggles, a plain click replaces', () => {
    const gs = mapWithObjects(['a', 'b']);
    setHeld(false);
    clickObject(gs, 'a');
    expect(ids()).toEqual(['a']);
    setHeld(true);
    clickObject(gs, 'b');
    expect(ids()).toEqual(['a', 'b']); // adds, does not replace
    clickObject(gs, 'a');
    expect(ids()).toEqual(['b']); // toggles back out
    setHeld(false);
    clickObject(gs, 'a');
    expect(ids()).toEqual(['a']); // plain click replaces the group
  });

  it('never multi-selects terrain', () => {
    const gs = mapWithObjects(['a']);
    setHeld(true);
    clickGround(gs, { x: 12, y: 12 });
    // Assert the RAW selection, not just its object ids: a `{kind:'terrain'}` ref
    // slipping into the array would still pass an ids()-only check.
    expect(useEditorStore.getState().selection).toEqual([]);
  });

  it('a plain click on a member of a group selects that member alone', () => {
    const gs = mapWithObjects(['a', 'b']);
    setHeld(true);
    clickObject(gs, 'a');
    clickObject(gs, 'b');
    setHeld(false);
    clickObject(gs, 'a');
    expect(ids()).toEqual(['a']);
  });

  it('leaves an existing group untouched by a Ctrl press on ground', () => {
    const gs = mapWithObjects(['a', 'b']);
    setHeld(true);
    clickObject(gs, 'a');
    clickObject(gs, 'b');
    expect(ids()).toEqual(['a', 'b']);
    clickGround(gs, { x: 12, y: 12 });
    expect(useEditorStore.getState().selection).toEqual([
      { kind: 'object', id: 'a' },
      { kind: 'object', id: 'b' },
    ]);
  });
});

describe('group drag-to-move', () => {
  /** The drop path needs a live executor over the same grid: the move is real commands. */
  function withExecutor(gs: GridState): CommandExecutor {
    const executor = new CommandExecutor(gs, useEditorStore.getState().eventBus, createDefaultRegistry());
    setStoreState({ gridState: gs, commandExecutor: executor });
    return executor;
  }

  function selectBoth(gs: GridState): void {
    setHeld(true);
    clickObject(gs, 'a');
    clickObject(gs, 'b');
    setHeld(false);
  }

  it('a drag from one member carries the whole group, as one undo step', () => {
    const gs = mapWithObjects(['a', 'b']);
    const executor = withExecutor(gs);
    selectBoth(gs);
    const before = executor.getUndoStackSize();

    dragFrom(gs, 'a', 1, 1);

    expect(gs.objects.get('a')!.position).toEqual({ x: 3, y: 3 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 6, y: 3 });
    expect(executor.getUndoStackSize()).toBe(before + 1);
    expect(ids()).toEqual(['a', 'b']); // the group survives its own move
    executor.undo();
    expect(gs.objects.get('a')!.position).toEqual({ x: 2, y: 2 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 5, y: 2 });
  });

  it('a refused group move reports it instead of failing silently', () => {
    const gs = mapWithObjects(['a', 'b']);
    withExecutor(gs);
    gs.objects.get('b')!.locked = true;
    selectBoth(gs);
    const failures = vi.fn();
    useEditorStore.getState().eventBus.on('validation-failed', failures);

    dragFrom(gs, 'a', 1, 1);

    expect(failures).toHaveBeenCalled();
    expect(gs.objects.get('a')!.position).toEqual({ x: 2, y: 2 });
    expect(gs.objects.get('b')!.position).toEqual({ x: 5, y: 2 });
  });
});
