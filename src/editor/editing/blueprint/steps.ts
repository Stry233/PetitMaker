/** The steps Blueprint mode moves through (`state/slices/blueprint.ts:BlueprintStep`): the strip
 *  unfolding into its explorer, the frame step on the region brush, and the save step on its frame. */
import type { Rect } from '../../../core/grid/rect';
import { footprintTerrain, terrainCellsUnder, wholeCellsInRegion } from '../../../core/grid/footprint';
import type { GridState, MacroCoord } from '../../../core/model/types';
import { standIn } from '../../../state/map-stand-in';
import { regionOf } from '../../../state/editing/region';
import type { RegionRequest } from '../../../state/editing/vocabulary';
import { groupBounds, groupMembers, selectedObjectIds, type BlockRef } from '../../../state/selection';
import { stepBack, type BlueprintUiChoice, type FrameStart } from '../../../state/slices/blueprint';
import { useEditorStore, type EditorStore } from '../../../state/store';
import { BLUEPRINT_MAX_SIDE, captureBlueprint, type CaptureRefusal } from '../../../tools/blueprint';
import { forgetFramedStage, framedStage } from './pictures';
import { armBlueprint } from './placing';

const store = () => useEditorStore.getState();

/** Unfolds the strip into its explorer with the armed blueprint selected, or folds the explorer back
 *  to the strip; either way nothing is being picked, and folding leaves nothing selected. `choice`
 *  sets the view as well. The id of the step it leaves standing, or null where nothing changed. */
export function unfoldBlueprintLibrary(unfolded: boolean, choice: BlueprintUiChoice = {}): number | null {
  const s = store();
  if (!unfolded) return s.foldBlueprintExplorer(choice);
  const { armed } = s.blueprint;
  return s.unfoldBlueprintExplorer(armed !== null ? [armed] : [], choice);
}

/** Folds the explorer for New blueprint, handing the selection it put aside to the frame step
 *  `beginBlueprintFrame` opens from the strip it leaves, so that selection never stands in between;
 *  the strip's id, or null where no explorer stood. */
export function foldBlueprintLibraryForFrame(): number | null {
  return store().foldBlueprintExplorer({}, true);
}

/** Unfolds the explorer a frame step started in was left for, once strip `id` it left stands; nothing
 *  once another step has taken its place. */
export function reopenBlueprintLibrary(id: number): void {
  const s = store();
  if (s.blueprintStep.at !== 'strip' || s.blueprintStep.id !== id || !s.blueprintStep.reopening) return;
  const { armed } = s.blueprint;
  s.unfoldBlueprintExplorer(armed !== null ? [armed] : [], {}, id);
}

/** Folds the explorer and arms blueprint `id`, so the next press on the map places it. */
export function takeBlueprintFromLibrary(id: string): void {
  unfoldBlueprintLibrary(false);
  armBlueprint(id);
}

/** Escape in the open explorer: leaves picking with nothing picked, else folds (`stepBack`); whether it did either. */
export function escapeBlueprintLibrary(): boolean {
  const back = stepBack(store().blueprintStep);
  if (back === 'unpick') { store().setBlueprintUi({ picking: false, selected: [] }); return true; }
  if (back !== 'fold') return false;
  unfoldBlueprintLibrary(false);
  return true;
}

/** What framing asks of the region brush: one rectangle, its guides counting the cells it captures, no
 *  larger than the terrain a frame of the most whole cells rests on. */
export const BLUEPRINT_FRAME_REQUEST: RegionRequest = {
  tools: ['rect'], single: true, minSide: null, wholeCells: true,
  maxSide: footprintTerrain({ x: 0, y: 0, w: BLUEPRINT_MAX_SIDE, h: BLUEPRINT_MAX_SIDE }).w,
};

const framingOn = (s: EditorStore): boolean => s.blueprintStep.at === 'frame';

/** The object-grid frame a region of terrain cells draws, as its guides measure it
 *  (`wholeCellsInRegion`); null for a region holding no whole cell. */
export function regionFrame(cells: readonly MacroCoord[]): Rect | null {
  return wholeCellsInRegion(cells);
}

/**
 * Opens the frame step: the region brush framing one rectangle for a blueprint, starting from
 * `frame` when given, started from `from`, which Cancel and Escape return to; with `strip`, only
 * while the step of that id still stands. The frame is Blueprint's own region, cleared when the step ends
 * (Done, Cancel, Escape, a mode change or another map); the selection, which the step puts down,
 * comes back only when the step is left for where it was started. The step takes the explorer's
 * place, so one Escape leaves it. Whether it opened.
 */
export function beginBlueprintFrame(frame: Rect | null = null, from: FrameStart = 'strip', strip?: number): boolean {
  return openFrameStep(frame, from, store().selection, strip);
}

/** The frame step on `frame`, started from `from`, setting aside `selection` as the one a Cancel
 *  gives back, from step `over` only when given; a frame or save step standing keeps the one it set aside. */
function openFrameStep(frame: Rect | null, from: FrameStart, selection: readonly BlockRef[], over?: number): boolean {
  const opening = { cells: frame ? terrainCellsUnder(frame) : [], request: BLUEPRINT_FRAME_REQUEST, start: from, setAside: selection };
  return store().openBlueprintFrame(opening, over) !== null;
}

/** Leaves the frame step for where it was started, saving nothing and giving back the selection it
 *  put down: the strip, or the explorer, which unfolds again once the strip stands
 *  (`BlueprintStep`'s `reopening`); whether one stood. */
export function leaveBlueprintFrame(): boolean {
  const step = store().blueprintStep;
  return step.at === 'frame' && store().leaveBlueprintFrame(step.id);
}

/** Why the frame `cells` draw cannot be saved, or null when it can: the capture's own refusal. */
export function frameRefusal(cells: readonly MacroCoord[]): CaptureRefusal | null {
  const state = store().gridState;
  const frame = regionFrame(cells);
  if (!state) return 'empty';
  if (!frame) return 'too-small';
  const out = captureBlueprint(state, frame);
  return 'refusal' in out ? out.refusal : null;
}

/**
 * Opens the save step on `frame`; it ends without saving once the map or the mode changes. While it
 * stands the views draw what the frame holds alone on the template's empty map (`framedStage`), as
 * a stand-in for the open map, which stays as it is and which no command edits (`commandApplies`);
 * an edit that changes what the frame holds lays it again, and one that leaves nothing the frame can
 * save takes the step back to the frame step, so the dock never stands over the open map.
 */
export function openBlueprintSave(frame: Rect): void {
  const map = store().gridState;
  const id = store().openBlueprintSaveStep(frame, BLUEPRINT_FRAME_REQUEST);
  const stands = (s: EditorStore): boolean => s.blueprintStep.at === 'save' && s.blueprintStep.id === id;
  const show = (): void => {
    const step = store().blueprintStep;
    if (step.at !== 'save' || step.id !== id) return;
    const stage = map && store().gridState === map ? framedStage(map, frame) : null;
    // A save landing keeps the stand-in it shows: its record was captured as it was pressed.
    if (!map || !stage) { store().backToBlueprintFrame(id); return; }
    if (store().mapStandIn?.shown !== stage.state) store().setMapStandIn(standIn(map, stage.state));
  };
  const bus = store().eventBus;
  const stop = useEditorStore.subscribe((next) => { if (!stands(next)) end(); });
  const end = (): void => {
    stop();
    bus.off('cells-changed', show);
    bus.off('objects-changed', show);
    forgetFramedStage();
    if (store().mapStandIn) store().setMapStandIn(null);
  };
  bus.on('cells-changed', show);
  bus.on('objects-changed', show);
  show();
}

/** Cancel or Escape on the save step: back to the frame step on the same frame; whether it went,
 *  which a save landing (`stepBack`'s hold) refuses. */
export function leaveBlueprintSave(): boolean {
  return store().backToBlueprintFrame();
}

/** Done on the frame step: ends it and opens the save step on its frame; nothing for a frame the
 *  capture refuses (`frameRefusal`). */
export function confirmBlueprintFrame(): boolean {
  if (!framingOn(store())) return false;
  const cells = regionOf(store(), 'blueprint');
  const frame = regionFrame(cells);
  if (!frame || frameRefusal(cells) !== null) return false;
  openBlueprintSave(frame);
  return true;
}

/** Save as blueprint on the selection card: Blueprint mode with the frame step drawn around the
 *  selection, read before the step puts it down; whether it opened. */
export function saveSelectionAsBlueprint(): boolean {
  const frame = frameOfSelection();
  if (!frame) return false;
  const { selection } = store();
  store().setEditMode({ mode: 'blueprint' });
  if (store().editMode.mode !== 'blueprint') return false;
  return openFrameStep(frame, 'strip', selection);
}

/** The whole object-grid cells the selected objects' footprints cover, or null with none selected;
 *  never clamped, so the save step reports a frame too big. */
export function frameOfSelection(): Rect | null {
  const s = store();
  return s.gridState ? selectionFrame(s.gridState, s.selection) : null;
}

/** `frameOfSelection` for `selection` on `state`. */
export function selectionFrame(state: GridState, selection: readonly BlockRef[]): Rect | null {
  const members = groupMembers(state, selectedObjectIds(selection));
  if (members.length === 0) return null;
  const b = groupBounds(members);
  const x = Math.floor(b.minX), y = Math.floor(b.minY);
  return { x, y, w: Math.ceil(b.maxX) - x, h: Math.ceil(b.maxY) - y };
}
