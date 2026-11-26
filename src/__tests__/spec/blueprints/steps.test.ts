// @vitest-environment jsdom
/** Blueprint's steps (the strip, the explorer, the frame step and the save step) standing one at a
 *  time: what leaving the mode or the map ends, and what the keys reach while each stands. */
import { expect, onTestFinished, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { spec } from '../../_support/spec';
import {
  armBlueprint, beginBlueprintFrame, carryBlueprint, confirmBlueprintFrame, leaveBlueprintSave, openBlueprintSave, placeArmedAt, regionFrame,
  saveBlueprint, saveFramedBlueprint, unfoldBlueprintLibrary,
} from '../../../editor/editing/blueprint';
import { registerCarryTarget, type CarrySample } from '../../../view/interaction/pointer/carry';
import { COMMAND_BY_ID, RUN, type CommandContext } from '../../../editor/commands/commands';
import { watchBackStack } from '../../../editor/back/back-out';
import { shownMap } from '../../../state/map-stand-in';
import { explorerUnfolded } from '../../../state/slices/blueprint';
import { applyViewSettings, useViewSettings, type PassiveOverlays, type ViewSettingsTarget } from '../../../view/shared/viewport/view-settings';
import { readPref, removePref } from '../../../platform/storage/prefs';
import { TERRAIN_GRID } from '../../../core/game/profile';
import { regionOf, regionRequestOf } from '../../../state/editing/region';
import { selectedGroup } from '../../../state/placed-groups';
import { ToolType } from '../../../state/editing/vocabulary';
import { ToolManager } from '../../../tools/pointer/runtime/tool-manager';
import type { ActiveView } from '../../../tools/pointer/runtime';
import { editorToolWiring } from '../../../editor/session/tool-wiring';
import { registerToolManager, setActiveView } from '../../../view/active-view';
import { installPointerMachine } from '../../../view/interaction/pointer/machine';
import { __resetCursorController } from '../../../view/interaction/cursor-controller';
import type { MacroCoord } from '../../../core/model/types';
import { makeStubView } from '../../_support/tool-manager';
import { useEditorStore } from '../../../state/store';
import { createGridState } from '../../../core/model/template';
import { createDefaultRegistry } from '../../../rules';
import type { BlueprintRecord } from '../../../io/blueprint';
import { blueprintEditor, open, roads, scene, type Scene } from './_blueprints';

const editor = blueprintEditor();
const store = () => useEditorStore.getState();
const key = (id: string) => COMMAND_BY_ID.get(id)!.run({ toggleMenu: () => {} } as unknown as CommandContext);
/** Lets the library's writes land. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
/** The ids the explorer step selects, none at any other step. */
const blueprintUiSelected = () => { const step = store().blueprintStep; return step.at === 'explorer' ? step.selected : []; };

async function saved(sc: Scene, name: string): Promise<BlueprintRecord> {
  const out = await saveBlueprint({ frame: sc.frame, name, author: null, folder: null });
  if (typeof out === 'string') throw new Error(`refused: ${out}`);
  return out;
}

spec('BLUE-03', 'leaving Blueprint mode or opening another map folds the explorer with its selection, so a later Delete deletes no blueprint', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  const held = () => editor.lib().records().map((r) => r.name);

  unfoldBlueprintLibrary(true);
  store().setBlueprintUi({ selected: [terrace.id] });
  store().setEditMode({ mode: 'object' });
  store().setEditMode({ mode: 'blueprint' });
  key('selection.delete');
  await settle();
  expect(held(), 'after leaving the mode').toEqual(['Terrace']);

  unfoldBlueprintLibrary(true);
  store().setBlueprintUi({ selected: [terrace.id] });
  store().loadMap(createGridState(sc.w.state.template), createDefaultRegistry());
  key('selection.delete');
  await settle();
  expect(held(), 'after another map').toEqual(['Terrace']);
});

spec('BLUE-05', 'while the save step stands no key or rail button edits the open map, its history or its selection, and Escape still steps back', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ eventBus: sc.w.sandbox.bus });
  // The back stack learns the order states are entered in only while a session watches it, as the app's does.
  const unwatch = watchBackStack();
  onTestFinished(unwatch);
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  store().setSelection([...sel]);
  key('selection.copy');
  openBlueprintSave(sc.frame);
  const now = () => {
    const ex = store().commandExecutor!;
    return { map: sc.w.fingerprint(), depth: ex.historyDepth(), redo: ex.canRedo(), selection: store().selection };
  };
  const before = now();
  for (const id of ['history.undo', 'history.redo', 'selection.all', 'selection.delete', 'selection.cut', 'selection.paste', 'selection.rotate_cw', 'tool.smart']) {
    key(id);
    expect(now(), id).toEqual(before);
    expect(store().deletePopover, id).toBeNull();
    expect(store().blueprintStep.at, id).toBe('save');
  }
  // The rail's buttons run the same bodies.
  RUN['history.undo']({ toggleMenu: () => {} });
  expect(now(), 'the rail\'s undo').toEqual(before);
  key('selection.deselect');
  expect(store().blueprintStep.at).toBe('frame');
});

spec('BLUE-05', 'an edit that leaves the frame holding nothing takes the save step back to the frame step, never leaving the dock over the open map', () => {
  const sc = scene();
  open(sc.w);
  useEditorStore.setState({ eventBus: sc.w.sandbox.bus });
  openBlueprintSave(sc.frame);
  expect(shownMap(store())).not.toBe(sc.w.state);
  // Something other than the keys (a job of the assistant) takes back everything the frame held.
  while (sc.w.undo()) { /* every step */ }
  expect(store().blueprintStep.at).toBe('frame');
  expect(shownMap(store())).toBe(sc.w.state);
});

spec('BLUE-05', 'while the save step stands both views draw no grid lines, chunk bounds or layer numbers, and leaving it shows them again as Settings left them', async () => {
  const sc = scene();
  open(sc.w);
  onTestFinished(() => { removePref('gridMode'); removePref('showChunkBounds'); });
  store().setGridMode(TERRAIN_GRID);
  store().setShowChunkBounds(true);
  store().setShowLayerNumbers(true);
  const setting = () => ({
    mode: store().gridMode, chunks: store().showChunkBounds, numbers: store().showLayerNumbers,
    savedMode: readPref('gridMode'), savedChunks: readPref('showChunkBounds'),
  });
  const chosen = setting();
  /** A view that keeps the grid lines, chunk bounds and layer numbers it was last given. */
  const view = () => {
    let last: PassiveOverlays | null = null;
    const target: ViewSettingsTarget = { setLayerVisibility: () => {}, setPassiveOverlays: (o) => { last = o; } };
    return { target, given: () => last && { grid: last.grid, chunks: last.chunks, numbers: last.numbers } };
  };
  const live = view();
  const hook = renderHook(() => useViewSettings({ current: live.target }));
  onTestFinished(() => hook.unmount());
  /** What a shown view was last given and what a view built now takes. */
  const shown = () => {
    const built = view();
    applyViewSettings(built.target);
    return { live: live.given(), built: built.given() };
  };
  const bare = { grid: null, chunks: false, numbers: false };
  const asSet = { grid: TERRAIN_GRID, chunks: true, numbers: true };
  expect(shown(), 'before the step').toEqual({ live: asSet, built: asSet });

  act(() => openBlueprintSave(sc.frame));
  expect(shown(), 'the save step').toEqual({ live: bare, built: bare });
  act(() => { leaveBlueprintSave(); });
  expect(store().blueprintStep.at).toBe('frame');
  expect(shown(), 'after Cancel').toEqual({ live: asSet, built: asSet });

  act(() => { confirmBlueprintFrame(); });
  expect(shown(), 'the save step again').toEqual({ live: bare, built: bare });
  await act(async () => { expect(await saveFramedBlueprint(draft(sc))).toBe(true); await settle(); });
  expect(store().blueprintStep.at).toBe('strip');
  expect(shown(), 'after Save').toEqual({ live: asSet, built: asSet });

  act(() => openBlueprintSave(sc.frame));
  expect(shown(), 'the save step once more').toEqual({ live: bare, built: bare });
  act(() => store().setEditMode({ mode: 'object' }));
  expect(shown(), 'after another mode').toEqual({ live: asSet, built: asSet });
  expect(setting(), 'the Settings choices').toEqual(chosen);
});

/** Holds the library's next writes until the returned release, as a slow browser store would. */
function holdWrites(): () => void {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const lib = editor.lib();
  const save = lib.save.bind(lib);
  const spy = vi.spyOn(lib, 'save').mockImplementation(async (r) => { await gate; return save(r); });
  return () => { release(); spy.mockRestore(); };
}

const draft = (sc: Scene, folder: string | null = null) => ({ frame: sc.frame, name: 'Terrace', author: null, folder });

spec('BLUE-05', 'while a save lands, Cancel, Escape and a second Save do nothing, and the landing closes the step once', async () => {
  const sc = scene();
  open(sc.w);
  openBlueprintSave(sc.frame);
  const release = holdWrites();
  const first = saveFramedBlueprint(draft(sc));
  expect(leaveBlueprintSave(), 'Cancel').toBe(false);
  key('selection.deselect');
  expect(store().blueprintStep.at, 'Escape').toBe('save');
  const second = saveFramedBlueprint(draft(sc));
  release();
  expect(await first).toBe(true);
  expect(await second).toBe(false);
  await settle();
  expect(editor.lib().records()).toHaveLength(1);
  expect(store().blueprintStep.at).toBe('strip');
  expect(store().blueprint.armed).toBe(editor.lib().records()[0]!.id);
});

spec('BLUE-05', 'a save landing after another mode was chosen keeps the blueprint but arms nothing and opens no folder', async () => {
  const sc = scene();
  open(sc.w);
  editor.lib().addFolder('Gardens');
  openBlueprintSave(sc.frame);
  const release = holdWrites();
  const landing = saveFramedBlueprint(draft(sc, 'Gardens'));
  store().setEditMode({ mode: 'object' });
  release();
  await landing;
  await settle();
  expect(editor.lib().records().map((r) => r.name)).toEqual(['Terrace']);
  expect(store().blueprint).toMatchObject({ armed: null, folder: null });
  store().setEditMode({ mode: 'blueprint' });
  expect(store().blueprintStep.at).toBe('strip');
});

spec('BLUE-06', 'a carried blueprint released on the map after another mode was chosen runs no tool there and gives back no selection', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  store().setSelection([...sel]);
  const dropped: string[] = [];
  const stop = registerCarryTarget({
    over: () => true, hover: () => {}, leave: () => {}, settle: () => {},
    drop: () => { dropped.push(String(store().editMode.mode)); },
  });
  try {
    const at: CarrySample = { pointerId: 4, pointerType: 'mouse', clientX: 300, clientY: 300, timeStamp: 0 };
    const carry = carryBlueprint(terrace.id, { pointerId: 4, surface: null, onEnd: () => {} })!;
    carry.move(at);
    store().setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    carry.release(at);
  } finally { stop(); }
  expect(dropped).toEqual([]);
  expect(store().selection).toEqual([]);
});

/** Screen px per placement cell in the rig's view. */
const PX = 10;

/** The real pointer machine over the scene's map under the Blueprint tool, in a flat view of `PX`
 *  screen px to a cell; returns a press-and-release at a cell and the teardown. */
function pointerRig(sc: Scene): { press: (c: MacroCoord) => void; stop: () => void } {
  const tm = new ToolManager(makeStubView(), sc.w.sandbox.executor, sc.w.state, editorToolWiring());
  const noop = () => {};
  setActiveView({
    projection: {
      screenToPoint: (x: number, y: number) => ({ x: x / PX, y: y / PX }),
      cellToScreen: (x: number, y: number) => ({ x: x * PX, y: y * PX, scale: 1 }),
    },
    overlay: new Proxy({}, { get: () => noop }), camera: { pan: noop, zoomStep: noop, zoomBy: noop }, plopObject: noop,
  } as unknown as ActiveView);
  registerToolManager(tm);
  tm.setActiveTool(ToolType.Blueprint);
  const el = document.createElement('div');
  document.body.appendChild(el);
  const uninstall = installPointerMachine(el);
  const pointer = (type: string, c: MacroCoord, buttons: number) =>
    new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, buttons, clientX: (c.x + 0.5) * PX, clientY: (c.y + 0.5) * PX });
  return {
    press: (c) => { el.dispatchEvent(pointer('pointerdown', c, 1)); window.dispatchEvent(pointer('pointerup', c, 0)); },
    stop: () => { uninstall(); el.remove(); setActiveView(null); registerToolManager(null); __resetCursorController(); },
  };
}

spec('BLUE-03', 'a press on the map with the explorer unfolded folds it first, so Delete reaches the placement it selects', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  armBlueprint(terrace.id);
  placeArmedAt(sc.free);
  store().clearSelection({ record: false });
  unfoldBlueprintLibrary(true);
  store().setBlueprintUi({ selected: [terrace.id] });
  const rig = pointerRig(sc);
  try {
    rig.press({ x: sc.free.x + 1, y: sc.free.y + 4 });
  } finally { rig.stop(); }
  expect(explorerUnfolded(store().blueprintStep)).toBe(false);
  expect(selectedGroup(store())).not.toBeNull();
  key('selection.delete');
  await settle();
  expect(roads(sc.w)).toHaveLength(2);
  expect(editor.lib().records()).toHaveLength(1);
});

spec('BLUE-07', 'leaving Blueprint mode puts down a placement selected whole, so no key outside the mode turns or deletes part of it', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  armBlueprint(terrace.id);
  placeArmedAt(sc.free);
  expect(selectedGroup(store())).not.toBeNull();
  const depth = store().commandExecutor!.historyDepth();
  store().setEditMode({ mode: 'object' });
  expect(store().selection).toEqual([]);
  expect(store().commandExecutor!.historyDepth(), 'no undo step').toBe(depth);
  const before = sc.w.fingerprint();
  key('selection.rotate_cw');
  key('selection.delete');
  expect(sc.w.fingerprint()).toBe(before);
  // A selection of single objects made in Blueprint mode stays.
  store().setEditMode({ mode: 'blueprint' });
  const road = roads(sc.w).find((o) => o.position.x < sc.free.x)!;
  store().setSelection([{ kind: 'object', id: road.id }]);
  store().setEditMode({ mode: 'object' });
  expect(store().selection).toEqual([{ kind: 'object', id: road.id }]);
});

/** A Show me posing `mode`, then left for its card. */
function showMe(mode: 'object' | 'blueprint'): void {
  store().startTour(1);
  store().setTourPhase({ kind: 'show', card: 1, step: 0 });
  store().poseTour({ mode });
  store().finishTour();
}

/** Whether the frame step stands whole: the step, the brush painting Blueprint's frame under its
 *  rectangle-only request, on `frame`. */
const frameStands = (frame: { x: number; y: number; w: number; h: number }) => {
  const s = store();
  return s.blueprintStep.at === 'frame' && s.selectingRegion && s.regionSelectionOwner === 'blueprint'
    && regionRequestOf(s).tools.join() === 'rect' && JSON.stringify(regionFrame(regionOf(s, 'blueprint'))) === JSON.stringify(frame);
};

spec('UI-47', 'a Show me gives back a frame step whole, and a save step as its frame step, never half of either', () => {
  const sc = scene();
  open(sc.w);
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  store().setSelection([...sel]);
  beginBlueprintFrame(sc.frame);
  showMe('object');
  expect(store().editMode.mode).toBe('blueprint');
  expect(frameStands(sc.frame), 'the frame step').toBe(true);
  // Its Cancel still goes back to the strip with the selection it put down.
  key('selection.deselect');
  expect(store().blueprintStep.at).toBe('strip');
  expect(store().selection).toEqual(sel);

  beginBlueprintFrame(sc.frame);
  confirmBlueprintFrame();
  expect(shownMap(store())).not.toBe(sc.w.state);
  showMe('blueprint');
  expect(frameStands(sc.frame), 'the save step\'s frame step').toBe(true);
  expect(shownMap(store())).toBe(sc.w.state);
});

spec('BLUE-03', 'unfolding the explorer puts the map\'s selection aside and folding gives it back, while leaving the mode does not', () => {
  const sc = scene();
  open(sc.w);
  const sel = roads(sc.w).map((o) => ({ kind: 'object', id: o.id }) as const);
  store().setSelection([...sel]);
  unfoldBlueprintLibrary(true);
  expect(store().selection, 'unfolded').toEqual([]);
  const before = sc.w.fingerprint();
  key('selection.rotate_cw');
  expect(sc.w.fingerprint(), 'E reaches no object').toBe(before);
  unfoldBlueprintLibrary(false);
  expect(store().selection, 'folded').toEqual(sel);

  unfoldBlueprintLibrary(true);
  key('selection.deselect');
  expect(store().selection, 'folded by Escape').toEqual(sel);

  unfoldBlueprintLibrary(true);
  store().setEditMode({ mode: 'object' });
  expect(store().selection, 'after leaving the mode').toEqual([]);
});

spec('BLUE-03', 'Ctrl+A or an Undo that brings back a map selection folds the explorer first, so exactly one selection is live', async () => {
  const sc = scene();
  open(sc.w);
  const terrace = await saved(sc, 'Terrace');
  const live = () => ({ map: store().selection.length > 0, explorer: store().blueprintStep.at === 'explorer' && blueprintUiSelected().length > 0 });

  unfoldBlueprintLibrary(true);
  store().setBlueprintUi({ selected: [terrace.id] });
  key('selection.all');
  expect(store().blueprintStep.at, 'Ctrl+A').toBe('strip');
  expect(live()).toEqual({ map: true, explorer: false });

  // A selection step in the map's history: Undo while the explorer stands brings it back.
  const road = roads(sc.w)[0]!;
  store().setSelection([{ kind: 'object', id: road.id }]);
  store().setSelection([]);
  unfoldBlueprintLibrary(true);
  store().setBlueprintUi({ selected: [terrace.id] });
  key('history.undo');
  expect(store().blueprintStep.at, 'Undo').toBe('strip');
  expect(store().selection).toEqual([{ kind: 'object', id: road.id }]);
  expect(live()).toEqual({ map: true, explorer: false });
});
