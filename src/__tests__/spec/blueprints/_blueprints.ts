/** A small blueprint scene the blueprint spec tests share: a one-layer plateau with two road tiles
 *  below it, framed on open ground with room beside it to place copies. */
import { afterEach, beforeEach } from 'vitest';
import { createBlueprintLibrary, memoryBlueprintBackend, type BlueprintLibrary } from '../../../io/storage/blueprint-library';
import { __setBlueprintLibrary } from '../../../editor/editing/blueprint';
import { setToastPresenter, type ToastAction } from '../../../platform/channels/toast-bus';
import { writePref } from '../../../platform/storage/prefs';
import { useEditorStore } from '../../../state/store';
import { explorerUnfolded } from '../../../state/slices/blueprint';
import { ToolType } from '../../../state/editing/vocabulary';
import type { Rect } from '../../../core/grid/rect';
import type { MacroCoord, PlacedObject } from '../../../core/model/types';
import { armedEditMode, resetStore, setStoreState } from '../../_support/store';
import { rect, TerrainType, world, type SpecWorld } from '../_world';
import { plateau } from '../editing/_editing';

export const ROAD = 'path-blue-board';

export const shift = (c: MacroCoord, dx: number, dy: number): MacroCoord => ({ x: c.x + dx, y: c.y + dy });

/** Build every cell of `cells` up to `elevation`, a layer per stroke. */
export function raise(w: SpecWorld, cells: readonly MacroCoord[], elevation: number): void {
  for (let e = 1; e <= elevation; e++) {
    const out = w.stroke(cells, TerrainType.Mountain, e);
    if (!out.ok) throw new Error(`layer ${e} refused: ${out.refusedBy.join(', ')}`);
  }
}

/** A world with a plain `layers` high under a `side` by `side` patch, and the frame top-left three
 *  cells inside it. */
export function plain(layers: number, side = 16): { w: SpecWorld; at: MacroCoord } {
  const w = world();
  const g = w.openGround(side, side);
  raise(w, rect(g, side, side), layers);
  return { w, at: shift(g, 3, 3) };
}

export interface Scene {
  w: SpecWorld;
  /** The sample's frame. */
  frame: Rect;
  /** Where a copy fits on open ground beside the sample, as a frame top-left. */
  free: MacroCoord;
}

/** A 4 by 5 frame holding a 3 by 3 plateau one layer up and two road tiles on the ground. */
export function scene(): Scene {
  const w = world();
  const at = w.openGround(26, 10);
  plateau(w, at, 3, 3, 1);
  for (const dx of [0, 1]) {
    const out = w.place(ROAD, at.x + dx, at.y + 4);
    if (!out.ok) throw new Error(`road refused: ${out.refusedBy.join(', ')}`);
  }
  return { w, frame: { x: at.x, y: at.y, w: 4, h: 5 }, free: shift(at, 8, 0) };
}

export const roads = (w: SpecWorld): PlacedObject[] => [...w.state.objects.values()].filter((o) => o.catalogId === ROAD);

/** Opens `w` as the live map with Blueprint mode up. */
export function open(w: SpecWorld): void {
  setStoreState({ gridState: w.state, commandExecutor: w.sandbox.executor, selection: [], ...armedEditMode({ tool: ToolType.Hand }) });
  useEditorStore.getState().setEditMode({ mode: 'blueprint' });
}

/** Per test: a fresh store, an in-memory library behind the editor, no last author and the toasts heard,
 *  with the action the last toast offered. */
export function blueprintEditor(): { lib: () => BlueprintLibrary; toasts: () => string[]; action: () => ToastAction | undefined } {
  let lib: BlueprintLibrary;
  let heard: string[] = [];
  let offered: ToastAction | undefined;
  let stops: (() => void)[] = [];
  beforeEach(() => {
    resetStore();
    writePref('blueprintAuthor', null);
    writePref('blueprintFolders', []);
    writePref('blueprintOrder', []);
    lib = createBlueprintLibrary(memoryBlueprintBackend());
    heard = [];
    offered = undefined;
    stops = [__setBlueprintLibrary(lib), setToastPresenter((text, _type, action) => { heard.push(text); offered = action; })];
  });
  afterEach(() => { for (const stop of stops.reverse()) stop(); });
  return { lib: () => lib, toasts: () => heard, action: () => offered };
}

/** Blueprint's page state with the explorer as its step holds it: whether it stands unfolded, and
 *  its selection and picking, none at any other step. */
export function blueprintUi() {
  const s = useEditorStore.getState();
  const step = s.blueprintStep;
  return {
    ...s.blueprint, unfolded: explorerUnfolded(step),
    selected: step.at === 'explorer' ? step.selected : [], picking: step.at === 'explorer' && step.picking,
  };
}
