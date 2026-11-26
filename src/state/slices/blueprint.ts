/**
 * Blueprint mode's page state: the armed blueprint with its body, so the pointer tools ghost it
 * without reaching the library, and the seed its placement records its group under; the strip and
 * explorer's view choices; and the step the mode stands at (`BlueprintStep`).
 *
 * Arming reads and writes the edit and engine slices (`Deps` below): arming one to place moves on
 * (`editing/intent.ts:movesOn`), which puts down the selection, the picked block and the touch latches.
 * The frame step is the region brush painting Blueprint's own region, so its transitions write the
 * brush's fields in the same update, and every other writer that ends that painting ends the step
 * with it (`stepEndFields`).
 */
import type { StateCreator } from 'zustand';
import type { BlueprintBody } from '../../core/model/blueprint';
import type { GroupSeed } from '../../core/model/placed-group';
import type { Rect } from '../../core/grid/rect';
import type { MacroCoord } from '../../core/model/types';
import { flipPress, thenOrient, type FlipStep } from '../../core/base/coords';
import { terrainCellsUnder } from '../../core/grid/footprint';
import type { BlockRef } from '../selection';
import { DEFAULT_REGION_REQUEST, type RegionRequest } from '../editing/vocabulary';
import type { Regions } from '../editing/region';
import { leftBehindFields, movesOn, purposeOf } from '../editing/intent';
import { regionSelectingFields, type EditSlice } from './edit';
import type { EngineSlice } from './engine';

/** Where a frame step was started, which leaving it returns to: the strip, or the open explorer. */
export type FrameStart = 'strip' | 'explorer';

/**
 * The one step Blueprint mode stands at, so no two of them stand together: the strip; the explorer
 * it unfolds into, with its selection, whether a finger picks several, whether it stands folded
 * aside for a card carried above it until the carry ends, and the map's selection it put down, so
 * only one selection is ever live; the frame step, the region brush framing
 * Blueprint's own region, with where it was started, the region request it paints under and the
 * selection it put down; and the save step on its frame, with a save that has not landed yet. Each
 * instance has its own `id`, which a late write names, so it lands only on the step it was made for.
 * Leaving the mode or opening another map returns to the strip in the same update.
 */
export type BlueprintStep =
  | { readonly at: 'strip'; readonly id: number;
    /** A frame step started in the open explorer was just left, so the explorer unfolds again once the strip stands. */
    readonly reopening: boolean;
    /** The selection an explorer folded for New blueprint put aside, which the frame step opened from
     *  this strip takes as its own; empty otherwise. */
    readonly setAside: readonly BlockRef[] }
  | { readonly at: 'explorer'; readonly id: number;
    /** Ids selected in the explorer. */
    readonly selected: readonly string[];
    /** Whether touch picking of several cards is on. */
    readonly picking: boolean;
    /** Folded aside for a single card carried above it; the carry's end unfolds it again. */
    readonly aside: boolean;
    /** The map's selection the unfolding put down, given back when it folds (EDIT-25). */
    readonly setAside: readonly BlockRef[] }
  | { readonly at: 'frame'; readonly id: number; readonly start: FrameStart; readonly request: RegionRequest;
    /** The selection the step put down, given back when it is left for where it was started. */
    readonly setAside: readonly BlockRef[] }
  | { readonly at: 'save'; readonly id: number; readonly frame: Rect; readonly start: FrameStart; readonly setAside: readonly BlockRef[];
    /** The request its frame step paints under, which stepping back paints under again. */
    readonly request: RegionRequest;
    /** Save was pressed and the record has not landed yet. */
    readonly pending: boolean };

/** The strip a fresh page and every map just opened stand at. */
export const REST_STEP: BlueprintStep = { at: 'strip', id: 0, reopening: false, setAside: [] };

/** The page's step instances counted, so each new one takes an id no earlier one had. */
let steps = 0;
const nextId = (): number => ++steps;

/** A fresh strip, with an id no earlier step had. */
export const freshStrip = (reopening = false, setAside: readonly BlockRef[] = []): BlueprintStep => ({ at: 'strip', id: nextId(), reopening, setAside });

/** Whether the explorer stands unfolded: the explorer step, not folded aside for a carry. */
export const explorerUnfolded = (step: BlueprintStep): boolean => step.at === 'explorer' && !step.aside;

/** Whether the save step stands, its dock over the rail and the column. */
export const blueprintSaving = (step: BlueprintStep): boolean => step.at === 'save';

/** Whether the interface may be hidden now: not while the save step stands, whose dock and viewfinder
 *  are the step itself. Showing it again is always open. */
export const interfaceHideable = (s: { readonly blueprintStep: BlueprintStep }): boolean => !blueprintSaving(s.blueprintStep);

/** What backing out of `step` does (Escape, Cancel): nothing of its own on the strip and in an
 *  explorer folded aside for a carry (the carry is the hand's); in the explorer, leave picking with
 *  nothing picked, else fold; leave the frame step for where it was started; step back from the save
 *  step to the frame step, or hold while its save lands, so the press backs out of nothing else. */
type StepBack = 'none' | 'unpick' | 'fold' | 'leave-frame' | 'leave-save' | 'hold';

export function stepBack(step: BlueprintStep): StepBack {
  switch (step.at) {
    case 'strip': return 'none';
    case 'explorer': return step.aside ? 'none' : step.picking ? 'unpick' : 'fold';
    case 'frame': return 'leave-frame';
    case 'save': return step.pending ? 'hold' : 'leave-save';
  }
}

/** What Delete means at `step`: the blueprints selected in the unfolded explorer; nothing at the save
 *  step, whose stand-in no edit reaches; else the map's own meaning (a gesture's step, then the selection). */
type StepDelete = { readonly means: 'map' } | { readonly means: 'nothing' } | { readonly means: 'blueprints'; readonly ids: readonly string[] };

export function stepDelete(step: BlueprintStep): StepDelete {
  if (step.at === 'explorer' && !step.aside) return { means: 'blueprints', ids: step.selected };
  return step.at === 'save' ? { means: 'nothing' } : { means: 'map' };
}

/** The region brush's fields as no brush paints, with Blueprint's region gone: the frame step's end. */
type FrameFields = Pick<EditSlice, 'selectingRegion' | 'regionSelectionOwner' | 'regionUndoLane' | 'regionRedoLane' | 'regions' | 'regionRequest'>;

/** What the frame step's end writes besides the step: the brush stops, its request and lanes go back
 *  to rest and Blueprint's region goes; Generate's and the assistant's regions stay. */
function frameEnd(s: Pick<EditSlice, 'regions'>): FrameFields {
  const { blueprint: _framed, ...rest } = s.regions;
  return { selectingRegion: false, regionSelectionOwner: null, regionRequest: DEFAULT_REGION_REQUEST, regionUndoLane: [], regionRedoLane: [], regions: rest };
}

/** The writes that return a step other than the strip to it, as another mode or a painting of
 *  another surface does: a frame step's painting ends with it. Null on the strip. */
export function stepEndFields(s: Pick<BlueprintSlice, 'blueprintStep'> & Pick<EditSlice, 'regions'>): { blueprintStep: BlueprintStep } & Partial<FrameFields> | null {
  if (s.blueprintStep.at === 'strip' && s.blueprintStep.setAside.length === 0) return null;
  return { blueprintStep: freshStrip(), ...(s.blueprintStep.at === 'frame' ? frameEnd(s) : null) };
}

export interface BlueprintUi {
  /** The armed record's id, or null. */
  readonly armed: string | null;
  /** The armed record's body as armed, unturned; null exactly when `armed` is. */
  readonly body: BlueprintBody | null;
  /** What a placement of the armed record records its group under; null exactly when `armed` is. */
  readonly seed: GroupSeed | null;
  /** Clockwise quarter turns the armed body is laid at, 0 to 3, after `mirror`. */
  readonly quarters: number;
  /** Whether the armed body is mirrored left to right before it turns. */
  readonly mirror: boolean;
  /** The armed body's place in Flip's cycle, which its placement's group carries on from. */
  readonly flip: FlipStep;
  /** The folder tab open, or null for All. */
  readonly folder: string | null;
  readonly view: 'grid' | 'list';
  /** The details list's column sort, or null for the library's own order, which the grid and the strip always show. */
  readonly sort: 'name' | 'date' | null;
  /** The upright explorer's height under its head as the seam handle last left it unfolded, in frame
   *  px, kept for the page's session; null until the handle first unfolds it. */
  readonly uprightHeight: number | null;
  /** A folder an import made, still waiting for review, to open once the review approves it; any
   *  folder chosen since drops it. */
  readonly awaitedFolder: string | null;
}

/** The view choices a surface writes through `setBlueprintUi`, with the open explorer's selection
 *  and picking, which only the explorer step takes. */
export type BlueprintUiChoice = Partial<Pick<BlueprintUi, 'folder' | 'view' | 'sort' | 'uprightHeight'>>
  & { readonly selected?: readonly string[]; readonly picking?: boolean };

/** What opening a frame step paints: its starting region, the request it paints under, where it was
 *  started, and the selection it sets aside (one standing frame step's own is kept). */
export interface FrameOpening {
  readonly cells: MacroCoord[];
  readonly request: RegionRequest;
  readonly start: FrameStart;
  readonly setAside: readonly BlockRef[];
}

export interface BlueprintSlice {
  blueprint: BlueprintUi;
  /** The step Blueprint mode stands at. */
  blueprintStep: BlueprintStep;
  /** Arms `id` with `body` and the seed its placement records at no turn, or at the turn and flip
   *  `as` gives, or disarms with null; arming another in Blueprint mode puts down the selection and
   *  the picked block, as no step. */
  setArmedBlueprint: (armed: { id: string; body: BlueprintBody; seed: GroupSeed } | null, as?: ArmedOrientation) => void;
  /** Turns the armed body by `quarters` clockwise quarter turns (negative turns back); nothing without one. */
  turnArmedBlueprintBy: (quarters: number) => void;
  /** Flips the armed body to the next place in Flip's cycle; nothing without one. */
  flipArmedBlueprint: () => void;
  /** Writes `choice`; a folder in it drops the awaited folder. */
  setBlueprintUi: (choice: BlueprintUiChoice) => void;
  /** Names the folder an import made to open once its review approves it, or none with null. */
  awaitBlueprintFolder: (folder: string | null) => void;
  /** Unfolds the strip into the explorer with `selected` selected and `choice` written, from the strip
   *  (that strip only, when `from` names one), putting the map's selection aside as moving on does;
   *  the explorer's id, or null where none unfolded. */
  unfoldBlueprintExplorer: (selected: readonly string[], choice?: BlueprintUiChoice, from?: number) => number | null;
  /** Folds the explorer back into a fresh strip, with `choice` written, giving back the map's
   *  selection it put aside, or with `forFrame` handing it to the strip for the frame step opened
   *  from it; the strip's id, or null where no explorer stood. */
  foldBlueprintExplorer: (choice?: BlueprintUiChoice, forFrame?: boolean) => number | null;
  /** Folds the unfolded explorer aside for a carried card; its id, or null where none stood unfolded. */
  setBlueprintExplorerAside: () => number | null;
  /** Unfolds explorer `id` again where it still stands folded aside. */
  endBlueprintExplorerAside: (id: number) => void;
  /** Opens the frame step on `opening`, from any step (from step `from` only, when given), the
   *  explorer, a frame or a save step standing keeping the selection it set aside; the step's id, or
   *  null where it did not open. */
  openBlueprintFrame: (opening: FrameOpening, from?: number) => number | null;
  /** Leaves frame step `id` for where it was started, giving back the selection it put down; false
   *  where that step no longer stands. */
  leaveBlueprintFrame: (id: number) => boolean;
  /** Opens the save step on `frame`, whose frame step paints under `request`: from a frame step with
   *  its start and the selection it put down, from any other step started on the strip; the step's id. */
  openBlueprintSaveStep: (frame: Rect, request: RegionRequest) => number;
  /** Steps the save step back to the frame step on its frame, as its Cancel does, from save step `id`
   *  only when given; a save landing holds it unless `evenSaving`, whose landing then finds its step
   *  gone. False where no such step stood or it held. */
  backToBlueprintFrame: (id?: number, evenSaving?: boolean) => boolean;
  /** Marks save step `id` as saving, so nothing backs out of it or saves again until the save lands;
   *  false where that step no longer stands or already saves. */
  beginBlueprintSave: (id: number) => boolean;
  /** Takes back the saving mark of save step `id` where it still stands, as a refused save does. */
  failBlueprintSave: (id: number) => void;
  /** Ends save step `id` for the strip with `choice` written and `armed` armed, as a landed save does;
   *  false where that step no longer stands. */
  finishBlueprintSave: (id: number, choice: BlueprintUiChoice, armed: { id: string; body: BlueprintBody; seed: GroupSeed } | null) => boolean;
}

/** The slice as a fresh page holds it: nothing armed, the strip on All. */
export const REST_BLUEPRINT_UI: BlueprintUi = {
  armed: null, body: null, seed: null, quarters: 0, mirror: false, flip: 0,
  folder: null, view: 'grid', sort: null, uprightHeight: null, awaitedFolder: null,
};

type Deps = Pick<EditSlice, 'editMode' | 'selectingRegion' | 'regionSelectionOwner' | 'multiSelectLatched' | 'moveLatched'
  | 'regions' | 'regionUndoLane' | 'regionRedoLane' | 'regionTool' | 'regionBrushShape' | 'regionRequest' | 'carrying'>
  & Pick<EngineSlice, 'selection' | 'pickedCell' | 'gridState' | 'restoreSelection'>;

/** Runs `body` with every store write it makes published as one update (`state/store.ts:batchStore`). */
type Batch = <T>(body: () => T) => T;
const unbatched: Batch = (body) => body();

/** The view part of `choice` written over `ui`; a folder in it drops the awaited folder. */
function uiWith(ui: BlueprintUi, choice: BlueprintUiChoice): BlueprintUi {
  const { selected: _selected, picking: _picking, ...view } = choice;
  return { ...ui, ...view, ...('folder' in view ? { awaitedFolder: null } : null) };
}

/** The explorer part of `choice` written over `step`; any other step stays as it is. */
function stepWith(step: BlueprintStep, choice: BlueprintUiChoice): BlueprintStep {
  const { selected = step.at === 'explorer' ? step.selected : [], picking = step.at === 'explorer' && step.picking } = choice;
  if (step.at !== 'explorer' || (selected === step.selected && picking === step.picking)) return step;
  return { ...step, selected, picking };
}

type FrameStep = Extract<BlueprintStep, { at: 'frame' }>;

/** A fresh frame step. */
const frameStep = (start: FrameStart, request: RegionRequest, setAside: readonly BlockRef[]): FrameStep =>
  ({ at: 'frame', id: nextId(), start, request, setAside });

/** The writes that make `step` the frame step on `cells`: the region brush starts painting Blueprint's
 *  own region under the step's request, as every surface's painting starts (`regionSelectingFields`),
 *  and the frame's region replaces Blueprint's own. */
function frameFields(s: BlueprintSlice & Deps, step: FrameStep, cells: MacroCoord[]) {
  return {
    ...regionSelectingFields(s, purposeOf(s), true, 'blueprint', step.request),
    blueprintStep: step,
    regions: { ...s.regions, blueprint: { cells, map: s.gridState } } satisfies Regions,
  };
}

/** How the armed body is laid: its turn, its mirror and its place in Flip's cycle. */
type ArmedOrientation = Pick<BlueprintUi, 'quarters' | 'mirror' | 'flip'>;

/** No turn and no flip. */
const UNTURNED: ArmedOrientation = { quarters: 0, mirror: false, flip: 0 };

/** `ui` with `armed` armed at no turn (at `as` when given, and armed), or nothing armed for null. */
export function armedUi(
  ui: BlueprintUi, armed: { id: string; body: BlueprintBody; seed: GroupSeed | null } | null, as: ArmedOrientation = UNTURNED,
): BlueprintUi {
  const { quarters, mirror, flip } = armed ? as : UNTURNED;
  return { ...ui, armed: armed?.id ?? null, body: armed?.body ?? null, seed: armed?.seed ?? null, quarters, mirror, flip };
}

/** `ui`'s armed blueprint turned `quarters` more clockwise quarters; `ui` itself with nothing armed. */
export function turnedUi(ui: BlueprintUi, quarters: number): BlueprintUi {
  return ui.armed === null ? ui : { ...ui, quarters: (((ui.quarters + quarters) % 4) + 4) % 4 };
}

/** `ui`'s armed blueprint at the next place in Flip's cycle, as the screen shows it; `ui` itself with
 *  nothing armed. */
function flippedUi(ui: BlueprintUi): BlueprintUi {
  if (ui.armed === null) return ui;
  const { next, turn } = flipPress(ui.flip);
  const o = thenOrient({ quarters: ui.quarters, mirror: ui.mirror }, turn);
  return { ...ui, quarters: o.quarters, mirror: !!o.mirror, flip: next };
}

/** `batch` is the store's own, which a frame step's leaving publishes its give-back through. */
export const createBlueprintSlice = (batch: Batch = unbatched): StateCreator<BlueprintSlice & Deps, [], [], BlueprintSlice> => (set, get) => ({
  blueprint: REST_BLUEPRINT_UI,
  blueprintStep: REST_STEP,
  setArmedBlueprint: (armed, as) => set((s) => {
    const blueprint = armedUi(s.blueprint, armed, as);
    return { blueprint, ...(movesOn(s, { ...s, blueprint }) ? leftBehindFields(s) : null) };
  }),
  turnArmedBlueprintBy: (quarters) => set((s) => (s.blueprint.armed === null ? s : { blueprint: turnedUi(s.blueprint, quarters) })),
  flipArmedBlueprint: () => set((s) => (s.blueprint.armed === null ? s : { blueprint: flippedUi(s.blueprint) })),
  setBlueprintUi: (choice) => set((s) => ({ blueprint: uiWith(s.blueprint, choice), blueprintStep: stepWith(s.blueprintStep, choice) })),
  awaitBlueprintFolder: (folder) => set((s) => ({ blueprint: { ...s.blueprint, awaitedFolder: folder } })),
  unfoldBlueprintExplorer: (selected, choice = {}, from) => {
    const s = get();
    const was = s.blueprintStep;
    if (was.at !== 'strip' || (from !== undefined && was.id !== from)) return null;
    const setAside = was.setAside.length > 0 ? was.setAside : s.selection;
    const step = stepWith({ at: 'explorer', id: nextId(), selected, picking: false, aside: false, setAside }, choice);
    set({ blueprint: uiWith(s.blueprint, choice), blueprintStep: step, ...(movesOn(s, { ...s, blueprintStep: step }) ? leftBehindFields(s) : null) });
    return step.id;
  },
  foldBlueprintExplorer: (choice = {}, forFrame = false) => {
    const s = get();
    const was = s.blueprintStep;
    if (was.at !== 'explorer') return null;
    const step = freshStrip(false, forFrame ? was.setAside : []);
    batch(() => {
      set({ blueprint: uiWith(s.blueprint, choice), blueprintStep: step });
      if (!forFrame && was.setAside.length > 0) get().restoreSelection(was.setAside);
    });
    return step.id;
  },
  setBlueprintExplorerAside: () => {
    const step = get().blueprintStep;
    if (step.at !== 'explorer' || step.aside) return null;
    set({ blueprintStep: { ...step, aside: true } });
    return step.id;
  },
  endBlueprintExplorerAside: (id) => {
    const step = get().blueprintStep;
    if (step.at === 'explorer' && step.id === id && step.aside) set({ blueprintStep: { ...step, aside: false } });
  },
  openBlueprintFrame: (opening, from) => {
    const s = get();
    const was = s.blueprintStep;
    if (from !== undefined && was.id !== from) return null;
    const handed = was.at !== 'strip' || was.setAside.length > 0;
    const step = frameStep(opening.start, opening.request, handed ? was.setAside : opening.setAside);
    set(frameFields(s, step, opening.cells));
    return step.id;
  },
  backToBlueprintFrame: (id, evenSaving = false) => {
    const s = get();
    const was = s.blueprintStep;
    if (was.at !== 'save' || (id !== undefined && was.id !== id) || (was.pending && !evenSaving)) return false;
    set(frameFields(s, frameStep(was.start, was.request, was.setAside), terrainCellsUnder(was.frame)));
    return true;
  },
  leaveBlueprintFrame: (id) => {
    const s = get();
    const step = s.blueprintStep;
    if (step.at !== 'frame' || step.id !== id) return false;
    batch(() => {
      set({ blueprintStep: freshStrip(step.start === 'explorer'), ...frameEnd(s) });
      if (step.setAside.length > 0) get().restoreSelection(step.setAside);
    });
    return true;
  },
  openBlueprintSaveStep: (frame, request) => {
    const s = get();
    const was = s.blueprintStep;
    const step: BlueprintStep = {
      at: 'save', id: nextId(), frame, request, pending: false,
      start: was.at === 'frame' || was.at === 'save' ? was.start : 'strip',
      setAside: was.setAside,
    };
    set({ blueprintStep: step, ...(was.at === 'frame' ? frameEnd(s) : null) });
    return step.id;
  },
  beginBlueprintSave: (id) => {
    const step = get().blueprintStep;
    if (step.at !== 'save' || step.id !== id || step.pending) return false;
    set({ blueprintStep: { ...step, pending: true } });
    return true;
  },
  failBlueprintSave: (id) => {
    const step = get().blueprintStep;
    if (step.at === 'save' && step.id === id && step.pending) set({ blueprintStep: { ...step, pending: false } });
  },
  finishBlueprintSave: (id, choice, armed) => {
    const s = get();
    if (s.blueprintStep.at !== 'save' || s.blueprintStep.id !== id) return false;
    const blueprint = armedUi(uiWith(s.blueprint, choice), armed);
    const step = freshStrip();
    set({ blueprint, blueprintStep: step, ...(movesOn(s, { ...s, blueprint, blueprintStep: step }) ? leftBehindFields(s) : null) });
    return true;
  },
});
