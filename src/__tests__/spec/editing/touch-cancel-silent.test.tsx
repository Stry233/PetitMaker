// @vitest-environment jsdom
/**
 * A finger's tool press over cells the rules refuse, through the map's own pointer machine over a
 * mounted canvas: a second finger that turns the press into a pan takes it back without a word,
 * while a press that proves to be a stroke reports its refusal as a mouse press does. The map is a
 * spec world the editor store holds; a cell is ten screen pixels.
 */
import { describe, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { placeItem, plateau } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { GESTURE_TIMING } from '../../../platform/input/gesture-timing';
import { setToastPresenter } from '../../../platform/channels/toast-bus';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { useEditorStore } from '../../../state/store';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

const noop = (): void => {};
const overlay = new Proxy({} as ToolOverlay, { get: () => noop });
const view = {
  projection: {
    screenToPoint: (sx: number, sy: number) => ({ x: sx / 10, y: sy / 10 }),
    cellToScreen: (x: number, y: number) => ({ x: x * 10, y: y * 10, scale: 10 }),
  },
  overlay, camera: { pan: noop, zoomStep: noop, zoomBy: noop }, ...headlessViewVerbs(),
} as unknown as ActiveView;

function Canvas() {
  const ref = useRef<HTMLDivElement>(null);
  usePointerInteraction(ref);
  return <div ref={ref} data-testid="canvas" />;
}

let canvas: HTMLElement;
let unsync: (() => void) | null = null;
let unpresent: (() => void) | null = null;
/** What a person was told: every refusal the map raised and every toast posted. */
let said: string[] = [];

function pointer(target: EventTarget, type: string, pointerType: string, c: MacroCoord, id = 1): void {
  const event = new MouseEvent(type, {
    bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1, clientX: c.x * 10 + 5, clientY: c.y * 10 + 5,
  });
  Object.defineProperties(event, { pointerType: { value: pointerType }, pointerId: { value: id } });
  act(() => { target.dispatchEvent(event); });
}
const finger = (type: string, c: MacroCoord, id = 1) => pointer(type === 'pointerdown' ? canvas : window, type, 'touch', c, id);

/** A tree on open ground, or on a mountain block (`raised`), opened in the editor with `tool` armed
 *  for mountains. */
function treeUnder(tool: ToolType, raised = false): { w: SpecWorld; tree: PlacedObject } {
  const w = world();
  const at = w.openGround(8, 8);
  if (raised) plateau(w, at, 8, 8, 1);
  const tree = placeItem(w, 'tree-apple', { x: at.x + 3, y: at.y + 3 })!;
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool, content: 'mountain' }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  manager.syncArming();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
  w.sandbox.bus.on('validation-failed', ({ errors }) => { said.push(...errors.map((e) => e.message)); });
  return { w, tree };
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  said = [];
  unpresent = setToastPresenter((text) => { said.push(text); });
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
});

afterEach(() => {
  vi.useRealTimers();
  unsync?.();
  unsync = null;
  unpresent?.();
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('a finger stroke over cells the rules refuse', () => {
  spec('EDIT-23', 'a second finger that turns the press into a pan takes it back without a word', () => {
    const { w, tree } = treeUnder(ToolType.TerrainBrush);
    const before = w.fingerprint();
    finger('pointerdown', tree.position);
    finger('pointerdown', { x: tree.position.x + 4, y: tree.position.y + 4 }, 2);
    for (let i = 1; i <= 3; i++) {
      finger('pointermove', { x: tree.position.x + i, y: tree.position.y }, 1);
      finger('pointermove', { x: tree.position.x + 4 + i, y: tree.position.y + 4 }, 2);
    }
    finger('pointerup', { x: tree.position.x + 3, y: tree.position.y }, 1);
    finger('pointerup', { x: tree.position.x + 7, y: tree.position.y + 4 }, 2);
    expect(said).toEqual([]);
    expect(w.fingerprint()).toBe(before);
  });

  spec('EDIT-23', 'a lost finger takes the press back without a word', () => {
    const { tree } = treeUnder(ToolType.TerrainBrush);
    finger('pointerdown', tree.position);
    finger('pointercancel', tree.position);
    expect(said).toEqual([]);
  });

  spec('EDIT-23', 'a finger press that lifts where it landed reports the refusal', () => {
    const { tree } = treeUnder(ToolType.TerrainBrush);
    finger('pointerdown', tree.position);
    finger('pointerup', tree.position);
    expect(said).toContain('error.object_blocks_terrain');
  });

  spec('EDIT-23', 'a finger stroke that travels reports the refusal before it lifts', () => {
    const { tree } = treeUnder(ToolType.TerrainBrush);
    finger('pointerdown', tree.position);
    finger('pointermove', { x: tree.position.x + 2, y: tree.position.y });
    expect(said).toContain('error.object_blocks_terrain');
    finger('pointerup', { x: tree.position.x + 2, y: tree.position.y });
  });

  spec('EDIT-23', 'a finger held still for the hold time reports the refusal before it lifts', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { tree } = treeUnder(ToolType.TerrainBrush);
    finger('pointerdown', tree.position);
    expect(said, 'the press may still be the first finger of a pan').toEqual([]);
    act(() => { vi.advanceTimersByTime(GESTURE_TIMING.touch.holdMs); });
    expect(said).toContain('error.object_blocks_terrain');
    finger('pointerup', tree.position);
  });

  spec('EDIT-23', 'a mouse press reports the refusal as it lands', () => {
    const { tree } = treeUnder(ToolType.TerrainBrush);
    pointer(canvas, 'pointerdown', 'mouse', tree.position);
    expect(said).toContain('error.object_blocks_terrain');
    pointer(window, 'pointerup', 'mouse', tree.position);
  });

  spec('EDIT-23', 'the eraser keeps its refusal to itself under a second finger, and reports it on a mouse press', () => {
    const { tree } = treeUnder(ToolType.Eraser, true);
    finger('pointerdown', tree.position);
    finger('pointerdown', { x: tree.position.x + 4, y: tree.position.y + 4 }, 2);
    finger('pointerup', tree.position, 1);
    finger('pointerup', { x: tree.position.x + 4, y: tree.position.y + 4 }, 2);
    expect(said).toEqual([]);
    pointer(canvas, 'pointerdown', 'mouse', tree.position);
    pointer(window, 'pointerup', 'mouse', tree.position);
    expect(said).not.toEqual([]);
  });
});
