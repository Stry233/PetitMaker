// @vitest-environment jsdom
/**
 * Selecting objects as a person does: clicks, Ctrl and bands through the map's own pointer machine
 * over a mounted canvas, and the keys through the commands they run. The map is a spec world the
 * editor store holds; a cell is ten screen pixels.
 */
import { describe, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { useRef } from 'react';
import { spec } from '../../_support/spec';
import { world, type SpecWorld } from '../_world';
import { heldCell, placeItem } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { useEditorStore } from '../../../state/store';
import { holdEditInFlight } from '../../../state/edits-in-flight';
import { activeToolOf } from '../../../state/editing/edit-mode';
import { selectedObjectIds } from '../../../state/selection';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import { watchFirstEdit } from '../../../editor/session/restore';
import { measureJsonSections } from '../../../editor/export/json-export';
import { readTourWatch } from '../../../ui/session/tour-watch';
import { executeToolCall, type AgentToolDeps } from '../../../agent/tools';

const TREE = 'tree-apple';
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
const mouse = (type: string, init: MouseEventInit) => new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
const screen = (c: MacroCoord) => ({ clientX: c.x * 10 + 5, clientY: c.y * 10 + 5 });
function press(from: MacroCoord, to: MacroCoord = from): void {
  canvas.dispatchEvent(mouse('pointerdown', { button: 0, buttons: 1, ...screen(from) }));
  if (from.x !== to.x || from.y !== to.y) window.dispatchEvent(mouse('pointermove', { buttons: 1, ...screen(to) }));
  window.dispatchEvent(mouse('pointerup', { button: 0, buttons: 0, ...screen(to) }));
}
function holdCtrl(held: boolean): void {
  window.dispatchEvent(new KeyboardEvent(held ? 'keydown' : 'keyup', { ctrlKey: held, key: 'Control' }));
}
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: noop } as unknown as CommandContext);
const selected = () => selectedObjectIds(useEditorStore.getState().selection);
const tool = () => activeToolOf(useEditorStore.getState());

/** Open `w` in the editor with the Hand tool up, the live tool manager over it. */
function open(w: SpecWorld): void {
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  const manager = new ToolManager(view, w.sandbox.executor, w.state, editorToolWiring());
  registerToolManager(manager);
  unsync?.();
  unsync = useEditorStore.subscribe(() => manager.syncArming());
}

/** Two trees on open ground, opened in the editor. */
function twoTrees(): { w: SpecWorld; at: MacroCoord; a: PlacedObject; b: PlacedObject } {
  const w = world();
  const at = w.openGround(10, 6);
  const a = placeItem(w, TREE, { x: at.x + 1, y: at.y + 1 })!;
  const b = placeItem(w, TREE, { x: at.x + 5, y: at.y + 1 })!;
  open(w);
  return { w, at, a, b };
}

beforeEach(() => {
  resetStore();
  __resetCursorController();
  setActiveView(view);
  canvas = render(<Canvas />).getByTestId('canvas');
});

afterEach(() => {
  unsync?.();
  unsync = null;
  holdCtrl(false);
  cleanup();
  setActiveView(null);
  registerToolManager(null);
  __resetCursorController();
});

describe('selecting objects', () => {
  spec('EDIT-24', 'a click selects an object alone, and Ctrl+click adds or removes it', () => {
    const { a, b } = twoTrees();
    press(a.position);
    expect(selected()).toEqual([a.id]);
    press(b.position);
    expect(selected()).toEqual([b.id]);
    holdCtrl(true);
    press(a.position);
    expect(selected()).toEqual([b.id, a.id]);
    press(b.position);
    expect(selected()).toEqual([a.id]);
  });

  spec('EDIT-24', 'a Ctrl+drag selects every object whose footprint the band touches', () => {
    const { at, a, b } = twoTrees();
    holdCtrl(true);
    press({ x: at.x, y: at.y + 4 }, b.position);
    expect(selected().sort()).toEqual([a.id, b.id].sort());
  });

  spec('EDIT-24', 'Ctrl+A selects every object on the map, locked ones included, and Escape clears it', () => {
    const { w } = twoTrees();
    key('selection.all');
    const all = [...w.state.objects.values()];
    expect(all.some((o) => o.locked)).toBe(true);
    expect(selected().sort()).toEqual(all.map((o) => o.id).sort());
    key('selection.deselect');
    expect(selected()).toEqual([]);
  });

  spec('EDIT-24', 'Escape lets go of a press still down but leaves a build landing by itself, and the selection with it', () => {
    twoTrees();
    key('selection.all');
    let build = 0, hand = 0;
    const releaseBuild = holdEditInFlight(() => { build++; }, 'build');
    const releaseHand = holdEditInFlight(() => { hand++; releaseHand(); }, 'hand');
    key('selection.deselect');
    expect(hand).toBe(1);
    expect(selected().length).toBeGreaterThan(0);
    key('selection.deselect');
    expect(build).toBe(0);
    expect(selected()).toEqual([]);
    releaseBuild();
  });

  spec('EDIT-25', 'a selection never holds terrain', () => {
    const { w, at, a } = twoTrees();
    press(a.position);
    holdCtrl(true);
    press({ x: at.x + 8, y: at.y + 4 });
    expect(useEditorStore.getState().selection).toEqual([{ kind: 'object', id: a.id }]);
    key('selection.all');
    expect(useEditorStore.getState().selection.every((r) => r.kind === 'object')).toBe(true);
    expect(selected()).toHaveLength(w.state.objects.size);
  });

  spec('EDIT-25', 'a selection stands under the Hand tool and the object placer, and arming any other tool clears it', () => {
    const { a } = twoTrees();
    press(a.position);
    const s = useEditorStore.getState;
    s().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: TREE } });
    expect(tool()).toBe(ToolType.ObjectPlacer);
    expect(selected(), 'the placer keeps it').toEqual([a.id]);
    s().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(tool()).toBe(ToolType.TerrainBrush);
    expect(selected(), 'the brush clears it').toEqual([]);
  });

  spec('EDIT-26', 'Ctrl with a brush up selects instead of painting, then switches to the Hand tool', () => {
    for (const arm of [{ kind: 'brush' }, { kind: 'erase' }, { kind: 'trim' }] as const) {
      const { w, a } = twoTrees();
      useEditorStore.getState().setEditMode({ mode: 'mountain', arm });
      const before = w.fingerprint();
      holdCtrl(true);
      press(a.position);
      holdCtrl(false);
      expect(selected(), arm.kind).toEqual([a.id]);
      expect(tool(), arm.kind).toBe(ToolType.Hand);
      expect(w.fingerprint(), `${arm.kind} edits nothing`).toBe(before);
    }
  });

  spec('EDIT-26', 'a Ctrl band that catches nothing leaves the brush up and changes nothing', () => {
    const { w, at } = twoTrees();
    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    const before = w.fingerprint();
    holdCtrl(true);
    press({ x: at.x, y: at.y + 3 }, { x: at.x + 8, y: at.y + 5 });
    expect(selected()).toEqual([]);
    expect(tool()).toBe(ToolType.TerrainBrush);
    expect(w.fingerprint()).toBe(before);
    holdCtrl(false);
    press({ x: at.x, y: at.y + 4 });
    expect(w.fingerprint(), 'the brush still paints').not.toBe(before);
  });
});

describe('turning before placing', () => {
  const HOUSE = 'building-myhouse';

  spec('EDIT-31', 'the rotate shortcut turns the waiting item, the preview answers for the turn, and the next placement keeps it', () => {
    const w = world();
    const at = w.openGround(14, 14);
    open(w);
    useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: HOUSE } });
    const anchor = { x: at.x + 2, y: at.y + 2 };
    expect(placeItem(w, TREE, { x: at.x + 3, y: at.y + 8 })).not.toBeNull();
    const fits = (rotation: 0 | 90) => {
      const held = heldCell(HOUSE, anchor, rotation);
      return w.sandbox.hoverPlacement(overlay, HOUSE, { x: held.x + 0.5, y: held.y + 0.5 } as never, rotation)!.valid;
    };
    expect(fits(0), 'unturned, the house fits beside the tree').toBe(true);

    key('selection.rotate_cw');
    const rotation = useEditorStore.getState().placementRotation;
    expect(rotation).toBe(90);
    expect(fits(rotation as 90), 'turned, it would reach the tree').toBe(false);

    press(heldCell(HOUSE, { x: at.x + 8, y: at.y + 1 }, 90));
    const house = [...w.state.objects.values()].find((o) => o.catalogId === HOUSE);
    expect(house?.rotation).toBe(90);
    expect(useEditorStore.getState().placementRotation, 'the turn carries over').toBe(90);
  });

  spec('EDIT-31', 'with objects selected, the rotate shortcut turns the selection instead', () => {
    const w = world();
    const at = w.openGround(14, 14);
    const house = placeItem(w, HOUSE, { x: at.x + 2, y: at.y + 2 })!;
    open(w);
    useEditorStore.getState().setEditMode({ mode: 'object', arm: { kind: 'item', itemId: 'building-stall' } });
    setStoreState({ selection: [{ kind: 'object', id: house.id }] });
    key('selection.rotate_cw');
    expect(w.object(house.id)?.rotation).toBe(90);
    expect(useEditorStore.getState().placementRotation).toBe(0);
  });
});

describe('undoing and redoing the selection', () => {
  const undo = () => key('history.undo');
  const redo = () => key('history.redo');
  const history = () => useEditorStore.getState().commandExecutor!;
  const below = (c: MacroCoord, dy: number): MacroCoord => ({ x: c.x, y: c.y + dy });

  spec('EDIT-71', 'a click that selects is one undo step of its own, and redo selects again', () => {
    const { w, a, b } = twoTrees();
    const map = w.fingerprint();
    press(a.position);
    press(b.position);
    undo();
    expect(selected()).toEqual([a.id]);
    undo();
    expect(selected()).toEqual([]);
    expect(w.fingerprint(), 'the map stays as it was').toBe(map);
    redo();
    redo();
    expect(selected()).toEqual([b.id]);
  });

  spec('EDIT-71', 'each Ctrl+click that adds or removes is a step, undone and redone in turn', () => {
    const { a, b } = twoTrees();
    press(a.position);
    holdCtrl(true);
    press(b.position);
    press(a.position);
    holdCtrl(false);
    expect(selected()).toEqual([b.id]);
    undo();
    expect(selected()).toEqual([a.id, b.id]);
    undo();
    expect(selected()).toEqual([a.id]);
    redo();
    redo();
    expect(selected()).toEqual([b.id]);
  });

  spec('EDIT-71', 'a Ctrl+drag band is one step however much it catches', () => {
    const { w, at, a, b } = twoTrees();
    const map = w.fingerprint();
    holdCtrl(true);
    press({ x: at.x, y: at.y + 4 }, b.position);
    holdCtrl(false);
    expect(selected().sort()).toEqual([a.id, b.id].sort());
    undo();
    expect(selected()).toEqual([]);
    expect(w.fingerprint()).toBe(map);
  });

  spec('EDIT-71', 'Escape and Ctrl+A are steps, and the Undo button counts them', () => {
    const { w } = twoTrees();
    key('selection.all');
    key('selection.deselect');
    expect(selected()).toEqual([]);
    undo();
    expect(selected()).toHaveLength(w.state.objects.size);
    undo();
    expect(selected()).toEqual([]);
    expect(history().canRedo()).toBe(true);
    redo();
    redo();
    expect(selected()).toEqual([]);
  });

  spec('EDIT-71', 'a selection put down by arming another tool is no step: the next undo takes back the edit before', () => {
    const { w, a, b } = twoTrees();
    press(a.position);
    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    expect(selected()).toEqual([]);
    undo();
    expect(selected()).toEqual([]);
    expect(w.object(b.id), 'the latest placement went back').toBeUndefined();
    expect(w.object(a.id)).toBeDefined();
  });

  spec('EDIT-71', 'under a brush, undoing a move leaves the brush armed and selects nothing', () => {
    const { w, a } = twoTrees();
    press(a.position);
    press(a.position, below(a.position, 3));
    useEditorStore.getState().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    undo();
    expect(w.object(a.id)?.position).toEqual(a.position);
    expect(tool()).toBe(ToolType.TerrainBrush);
    expect(selected()).toEqual([]);
  });

  spec('EDIT-71', 'a new selection after an undo clears what could be redone', () => {
    const { a, b } = twoTrees();
    press(a.position);
    undo();
    press(b.position);
    redo();
    expect(selected()).toEqual([b.id]);
    expect(history().canRedo()).toBe(false);
  });

  spec('EDIT-72', 'undoing a delete brings the objects back selected, and redo deletes them again', () => {
    const { w, a, b } = twoTrees();
    press(a.position);
    holdCtrl(true);
    press(b.position);
    holdCtrl(false);
    key('selection.delete');
    expect(w.object(a.id)).toBeUndefined();
    expect(selected()).toEqual([]);
    undo();
    expect(w.object(a.id)).toBeDefined();
    expect(selected()).toEqual([a.id, b.id]);
    redo();
    expect(w.object(b.id)).toBeUndefined();
    expect(selected()).toEqual([]);
  });

  spec('EDIT-72', 'undoing a Ctrl+drag copy gives back the selection before it, and redo selects the copy again', () => {
    const { w, a } = twoTrees();
    press(a.position);
    const count = w.state.objects.size;
    holdCtrl(true);
    press(a.position, below(a.position, 3));
    holdCtrl(false);
    expect(w.state.objects.size).toBe(count + 1);
    const copy = selected();
    expect(copy).toHaveLength(1);
    expect(copy[0]).not.toBe(a.id);
    undo();
    expect(w.state.objects.size, 'one undo takes the copy back').toBe(count);
    expect(selected()).toEqual([a.id]);
    redo();
    expect(selected()).toEqual(copy);
  });

  spec('EDIT-72', 'undoing a move keeps the selection it moved, and the click that selected it is a step of its own', () => {
    const { w, a } = twoTrees();
    press(a.position);
    press(a.position, below(a.position, 3));
    expect(w.object(a.id)?.position).toEqual(below(a.position, 3));
    expect(selected()).toEqual([a.id]);
    undo();
    expect(w.object(a.id)?.position).toEqual(a.position);
    expect(selected()).toEqual([a.id]);
    undo();
    expect(selected()).toEqual([]);
  });

  spec('EDIT-73', 'a redo never selects an object that is no longer on the map', () => {
    const { w, a, b } = twoTrees();
    press(a.position);
    holdCtrl(true);
    press(b.position);
    holdCtrl(false);
    // Another path, as the assistant's, takes an object away under the selection.
    expect(w.remove(a.id).ok).toBe(true);
    undo();
    expect(w.object(a.id)).toBeDefined();
    expect(selected()).toEqual([a.id, b.id]);
    redo();
    expect(w.object(a.id)).toBeUndefined();
    expect(selected()).toEqual([b.id]);
  });

  spec('EDIT-74', 'selection steps are no map edits: the edit count, the first-edit watch and the saved step history ignore them', () => {
    const { w, a, b } = twoTrees();
    setStoreState({ eventBus: w.sandbox.bus });
    let edited = 0;
    const stop = watchFirstEdit(() => { edited++; });
    const depth = history().historyDepth();
    const steps = measureJsonSections('all')!.historySteps;
    const edits = readTourWatch().edits;
    press(a.position);
    holdCtrl(true);
    press(b.position);
    holdCtrl(false);
    undo();
    redo();
    key('selection.deselect');
    undo();
    expect(edited, 'the first-edit watch heard no edit').toBe(0);
    expect(history().historyDepth()).toBe(depth);
    expect(readTourWatch().edits, 'Show me counts no edit').toBe(edits);
    expect(measureJsonSections('all')!.historySteps, 'the saved step history holds the map edits only').toBe(steps);
    expect(history().getUndoEntries()).toHaveLength(depth);
    expect(selected()).toHaveLength(2);
    key('selection.delete');
    expect(history().historyDepth()).toBe(depth + 1);
    expect(edited, 'a delete is an edit').toBeGreaterThan(0);
    stop();
  });

  spec('ASST-08', 'the assistant undoes its own edit past the selections made after it, and no further than its job', async () => {
    const { w, a, b } = twoTrees();
    const exec = history();
    const floor = exec.historyDepth();
    const deps = { getState: () => w.state, getExecutor: () => exec, getRegion: () => [], undoFloor: () => floor } as unknown as AgentToolDeps;
    expect(w.remove(b.id).ok).toBe(true);
    press(a.position);
    const first = await executeToolCall({ id: 'u1', name: 'undo', input: { steps: 5 } }, deps);
    expect(first.content).toContain('1');
    expect(w.object(b.id), 'its edit went back').toBeDefined();
    expect(exec.historyDepth()).toBe(floor);
    expect(w.object(a.id), 'the work before the job stands').toBeDefined();
  });
});
