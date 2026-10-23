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
import { placeItem } from './_editing';
import { usePointerInteraction } from '../../../view/interaction/use-pointer-interaction';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import { ToolManager, type ActiveView, type ToolOverlay } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { COMMAND_BY_ID, type CommandContext } from '../../../editor/commands/commands';
import { useEditorStore } from '../../../state/store';
import { activeToolOf } from '../../../state/editing/edit-mode';
import { selectedObjectIds } from '../../../state/selection';
import { ToolType } from '../../../state/editing/vocabulary';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { headlessViewVerbs } from '../../_support/tool-manager';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';

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
    const fits = (rotation: 0 | 90) => w.sandbox.hoverPlacement(overlay, HOUSE, { x: anchor.x + 0.5, y: anchor.y + 0.5 } as never, rotation)!.valid;
    expect(fits(0), 'unturned, the house fits beside the tree').toBe(true);

    key('selection.rotate_cw');
    const rotation = useEditorStore.getState().placementRotation;
    expect(rotation).toBe(90);
    expect(fits(rotation as 90), 'turned, it would reach the tree').toBe(false);

    press({ x: at.x + 8, y: at.y + 1 });
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
