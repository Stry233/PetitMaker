/**
 * The mounted shell's own overlay/chrome state: which modals are open, the tour, the context menu /
 * delete popover / 3D-shots editor, and the shell's own furniture state (the
 * assistant's open flag). A shell replaces exactly this slice, so a field only one surface reads
 * still belongs here.
 *
 * Every setter here reads at most its own fields (`setContextMenu`/`setDeletePopover` read
 * `tourRunning`, which lives in this same slice), except that those two stamp the map and arming
 * they open over (`editing/intent.ts:surfaceTicket`) and a tour's start reads the planet session
 * (`tourOpenable`). No field holds an engine handle and nothing here
 * imports `engine`; the cross-slice calls are the tour's (`poseTour` applies what a Show me step
 * shows, and every move of a run gives back what a Show me borrowed through the edit, prefs and
 * annotations slices' own setters and the map's executor), and
 * `setInputMode`, which ends the edit slice's touch latches on leaving touch mode and puts the new
 * mode's UI scale in force.
 */
import type { StateCreator } from 'zustand';
import type { DocId } from '../../legal/registry';
import type { BlockRef } from '../selection';
import type { CommandExecutor, HistoryMark } from '../../core/commands/command-executor';
import type { GridState, MacroCoord } from '../../core/model/types';
import type { CameraAngle } from '../view-camera';
import { readLayoutShape, type LayoutShape } from '../../platform/device/layout-shape';
import type { InputMode } from '../../platform/device/input-mode';
import { recordTourOffered } from '../tour-offer';
import { cancelEditsInFlight, editsInFlight } from '../edits-in-flight';
import { readPref, writePref, scaleProfileOf, UI_ZOOM_PREFS, type DockSide } from '../../platform/storage/prefs';
import type { ImportKind } from '../../io/import/kind';
import type { BuildMode } from '../editing/edit-mode';
import { editModeFields, type EditSlice } from './edit';
import { staleSurfaceFields, surfaceTicket, type SurfaceTicket } from '../editing/intent';
import type { Regions } from '../editing/region';
import { DEFAULT_REGION_REQUEST, type RegionRequest } from '../editing/vocabulary';
import type { EventBus } from '../../core/commands/event-bus';
import type { EditorEvents } from '../editing/events';
import { ANNOTATION_SESSION_RESET, type AnnotationsSlice } from './annotations';
import { freshStrip, interfaceHideable, REST_STEP, type BlueprintSlice, type BlueprintStep, type BlueprintUi } from './blueprint';
import { framePose, mapHeld } from '../frame-pose';
import type { PlanetSessionSlice } from './planet-session';
import type { RepairSessionSlice } from './repair-session';
import type { PrefsSlice, ViewMode } from './prefs';

/** The save-and-share window's sections, in its tabs' order: the save file, the share picture, the build checklist. */
export const SHARE_SECTIONS = ['keep', 'friend', 'stats'] as const;
export type ShareSection = (typeof SHARE_SECTIONS)[number];

/** Every overlay the editor can open. Adding a modal is one member here plus its component. */
export const MODAL_IDS = [
  'help', 'keyboard', 'settings', 'about', 'newProject',
  'preview3d', 'import', 'regionLoad',
  // The save-and-share window; `openShare` names the section it opens at.
  'share',
  // The dedicated stylize window, reached from the export controls' own entry group.
  'stylize',
  // The release notes a returning browser has not read yet.
  'whatsNew',
  // Import planet's window over Change Planet: from a planet file or from a game video.
  'planetImport',
  // How to move what a just-opened map held under the planet's landmarks.
  'landmarkRepair',
] as const;
export type ModalId = typeof MODAL_IDS[number];

/** Whether any window other than `except` is open. The one reading of "a modal is up"; the
 *  keyboard gate's lock in `platform/channels/overlay-state.ts` also counts the tour and the
 *  what's-this layer, which are not windows. */
export function anyModalOpen(s: { modals: Record<ModalId, boolean> }, except?: ModalId): boolean {
  return MODAL_IDS.some((id) => id !== except && s.modals[id]);
}

/** A file one import surface hands to the window that reads its kind. */
export interface HandedImport { kind: Exclude<ImportKind, 'unknown' | 'blueprint'>; file: File }

/** The windows each handed kind opens over the map, all others among them closed: a map goes to
 *  Import map, a planet file to Change Planet (which reads it as From a planet file does), a video
 *  to Import planet's window over Change Planet. */
const HAND_DESTINATION: Record<HandedImport['kind'], Partial<Record<ModalId, boolean>>> = {
  map: { import: true, newProject: false, planetImport: false },
  planet: { import: false, newProject: true, planetImport: false },
  video: { import: false, newProject: true, planetImport: true },
};

/** What a tour's Show me step asks the interface to show; an absent field is left as it stands. */
export interface TourPose {
  mode?: BuildMode | null;
  view?: ViewMode;
  /** The save-and-share window open at a section, or closed. */
  share?: ShareSection | null;
  /** Blueprint's strip standing: a save step backs out to its frame step and a frame step to where it
   *  was started, as Cancel does, and an open explorer folds. */
  blueprint?: 'strip';
}

/** The selection the engine slice holds, as the tour reads and restores it, and the picked block an arming drops (this slice names no engine module). */
type SelectionHeld = { selection: BlockRef[]; pickedCell: MacroCoord | null };
/** Blueprint's page state with the armed blueprint Blueprint mode resumes and the step it stands at,
 *  which an arming given back reads (`editModeFields`), and the ways back from its steps a Show me's
 *  pose takes. */
type BlueprintHeld = { blueprint: BlueprintUi; blueprintStep: BlueprintStep }
  & Pick<BlueprintSlice, 'backToBlueprintFrame' | 'leaveBlueprintFrame' | 'foldBlueprintExplorer'>;
/** The live map and its executor the engine slice holds, as the tour marks and returns its history. */
type HistoryHeld = { gridState: GridState | null; commandExecutor: Pick<CommandExecutor, 'markHistory' | 'returnTo'> | null };
type EditingHeld = EditSlice & SelectionHeld & Pick<BlueprintHeld, 'blueprint' | 'blueprintStep'>;

/** The editing state a Show me's pose or the visitor's tries can move, kept exactly. What is armed
 *  and the material it lays, the placement's turn and Blueprint's page state (the armed blueprint,
 *  its turn and the library's view) hold on any map; the fields of
 *  `MAP_EDITING_RESET` belong to the map they were made on. Tool sizes and shapes are the visitor's
 *  and stay. */
const MAP_FREE_FIELDS = [
  'editMode', 'tileMaterial', 'tileMaterialPicked', 'roadFamilyMaterials', 'placementRotation', 'blueprint',
] as const satisfies readonly (keyof EditingHeld)[];

/** The editing fields that belong to the map they were made on, as a map just opened holds them:
 *  the selection with its picked block and touch latches, the painted region with its painting, its
 *  request and undo lanes and Blueprint's step, whose frame step is that painting, the layer built on and the
 *  layers shown. */
const MAP_EDITING_RESET = {
  selection: [] as BlockRef[], pickedCell: null, multiSelectLatched: false, moveLatched: false,
  selectingRegion: false, regionSelectionOwner: null, regionRequest: DEFAULT_REGION_REQUEST as RegionRequest, regions: {} as Regions, blueprintStep: REST_STEP,
  regionUndoLane: [] as MacroCoord[][], regionRedoLane: [] as MacroCoord[][],
  displayLayer: null, layerVisibility: {} as Record<number, boolean>,
} as const satisfies Partial<EditingHeld>;
const MAP_FIELDS = Object.keys(MAP_EDITING_RESET) as (keyof typeof MAP_EDITING_RESET)[];
type TourEditing = Pick<EditingHeld, (typeof MAP_FREE_FIELDS)[number] | (typeof MAP_FIELDS)[number]>;

/**
 * Every transient that belongs to the open map, as a map just opened holds it: `MAP_EDITING_RESET`
 * with a strip whose id no earlier step had, so a late write made for a step on the map before
 * lands on none, the map's menu and the delete question, the notes session and Generate's applied
 * card. Whatever installs a map spreads it (`slices/engine.ts:loadMap`, `restoreParkedEditor`), so
 * no door clears a subset of its own; the notes' epoch is bumped beside it.
 */
export const mapSessionReset = () => ({
  ...MAP_EDITING_RESET,
  blueprintStep: freshStrip(),
  contextMenu: null, deletePopover: null,
  ...ANNOTATION_SESSION_RESET,
  generateApplied: null,
} as const);

/** What a Show me found before its first pose, given back exactly as it ends: `history` is the map
 *  with its undo and redo, `locks` its layer locks and `notes` whether its notes layer is shown and
 *  locked, so what the visitor built, locked or hid while trying comes off again; `map` is the map
 *  they belong to. */
interface TourBorrow {
  editing: TourEditing; view: ViewMode; assistant: boolean; share: boolean; shareTarget: ShareSection | null;
  map: GridState | null; history: HistoryMark | null; locks: ReadonlySet<number> | null;
  notes: NotesShown;
}

/** Whether a map's notes layer is shown and locked, as its row reads them: a map with no notes yet
 *  has its layer shown and open. */
interface NotesShown { visible: boolean; locked: boolean }
const notesShownOf = (map: GridState | null): NotesShown =>
  ({ visible: map?.annotations?.visible !== false, locked: map?.annotations?.locked === true });

/** Where a tour run stands: on a card, in a card's Show me at a step, or on the recap. */
export type TourPhase =
  | { kind: 'deck'; card: number }
  | { kind: 'show'; card: number; step: number }
  | { kind: 'recap' };

/** Where every run starts, and where the phase rests while none runs. */
export const FIRST_TOUR_PHASE: TourPhase = { kind: 'deck', card: 0 };

/** The deck a run moves over, as the store reads it: how many Show me steps each card holds, in order. */
export type TourDeckShape = readonly number[];

/** A move of a running tour over its deck: to a card, the next card (the recap after the last), the
 *  card before, into the card's Show me, or on from Show me step `from` (back to its card after the
 *  last), so a step heard twice moves once. */
export type TourMove =
  | { kind: 'go'; card: number }
  | { kind: 'next' }
  | { kind: 'back' }
  | { kind: 'showMe' }
  | { kind: 'stepOn'; from: number };

/** Where `move` takes a run standing at `phase` over `deck`; null where it goes nowhere. */
function tourPhaseAfter(phase: TourPhase, move: TourMove, deck: TourDeckShape): TourPhase | null {
  switch (move.kind) {
    case 'go': return { kind: 'deck', card: Math.max(0, Math.min(deck.length - 1, move.card)) };
    case 'next':
      if (phase.kind !== 'deck') return null;
      return phase.card < deck.length - 1 ? { kind: 'deck', card: phase.card + 1 } : { kind: 'recap' };
    case 'back': return phase.kind === 'deck' && phase.card > 0 ? { kind: 'deck', card: phase.card - 1 } : null;
    case 'showMe': return phase.kind === 'deck' && (deck[phase.card] ?? 0) > 0 ? { kind: 'show', card: phase.card, step: 0 } : null;
    case 'stepOn':
      if (phase.kind !== 'show' || phase.step !== move.from) return null;
      return move.from + 1 < (deck[phase.card] ?? 0) ? { ...phase, step: move.from + 1 } : { kind: 'deck', card: phase.card };
  }
}

/** Whether the tour can start: not while a session holds the map and has set the interface it
 *  walks aside. Entry refuses on it and every door to the tour shows it. */
export function tourOpenable(s: Parameters<typeof mapHeld>[0]): boolean {
  return !mapHeld(s);
}

/** Whether a Show me stands: a run is in one of its cards' Show me. */
function showMeStands(s: Pick<ShellSlice, 'tourRunning' | 'tourPhase'>): boolean {
  return s.tourRunning && s.tourPhase.kind === 'show';
}

/** Whether a Show me can start: not while a note is being written, which its pose would ask to
 *  discard, nor while an edit is still landing (`landing`), which a history marked in the middle of
 *  it would keep half of. Entry refuses on it and the Show me button shows it. */
export function showMeOpenable(s: Pick<AnnotationsSlice, 'annotationDraft'>, landing = editsInFlight()): boolean {
  return s.annotationDraft === null && !landing;
}

/** Whether Notes can be opened: not while a Show me stands, since a note's history is apart from
 *  the map's, which the Show me gives back. Entry refuses on it and every door to Notes shows it. */
export function notesOpenable(s: Pick<ShellSlice, 'tourRunning' | 'tourPhase'>): boolean {
  return !showMeStands(s);
}

/** Whether a framed blueprint can be saved: not while a Show me stands, since the library is apart
 *  from what the Show me gives back. The save refuses on it and the save step's Save shows it. */
export function blueprintSavable(s: Pick<ShellSlice, 'tourRunning' | 'tourPhase'>): boolean {
  return !showMeStands(s);
}

/** The map's menu: where it opened, on what, the input mode of the press that opened it, and what
 *  it stands over (`editing/intent.ts:SurfaceTicket`), which its setter reads as it opens. */
interface ContextMenuEntry { x: number; y: number; target: BlockRef; mode: InputMode; opened?: SurfaceTicket }

export interface ShellSlice {
  /** Which overlays are open; a keyboard command, an agent tool and a button open one with the same
   *  call. Several can be open at once: About opens over Settings and closing it returns there. */
  modals: Record<ModalId, boolean>;
  setModal: (id: ModalId, open: boolean) => void;
  /** The section the save-and-share window opens at next, consumed as it opens; null opens the first. */
  shareTarget: ShareSection | null;
  setShareTarget: (section: ShareSection | null) => void;
  /** Opens the save-and-share window at `section`. */
  openShare: (section: ShareSection) => void;
  /** The document About drills into on its next open, consumed as it opens. */
  aboutTarget: DocId | null;
  setAboutTarget: (id: DocId | null) => void;
  /** Opens About at the document `target`. */
  openAbout: (target: DocId) => void;
  /** The document About opens at, cleared as it is read. */
  takeAboutTarget: () => DocId | null;
  /** Where the Help Center opens next: a page (and optionally a section anchor). Written by every
   *  deep link (`openHelp`), consumed and cleared by the modal itself, so a plain menu open (null
   *  target) lands on the page the reader last had. */
  helpTarget: { page: string; anchor?: string } | null;
  setHelpTarget: (target: { page: string; anchor?: string } | null) => void;
  /** Opens the Help Center at `target`, ending the what's-this pick. */
  openHelpAt: (target: { page: string; anchor?: string }) => void;
  /** Whether the "what's this?" pick mode covers the app: a question cursor, and the next click on
   *  a marked part of the interface opens its help page instead of acting. One flag here so the
   *  help modal's button, the overlay and Escape all speak about the same state. */
  whatsThis: boolean;
  setWhatsThis: (on: boolean) => void;
  /** The interface the visitor hid, with whether the frame stood in a session's pose then
   *  (`frame-pose.ts`): it shows again in the other pose, so a planet session or a hand repair keeps
   *  it up (`interfaceHidden`). Null while shown; never saved. */
  interfaceHiding: { readonly session: boolean } | null;
  /** Hides the interface, refused while it may not be hidden (`blueprint.ts:interfaceHideable`), or shows it again. */
  setInterfaceHidden: (on: boolean) => void;
  /** Turns the what's-this pick on, closing the Help Center under it, or off. */
  toggleWhatsThis: () => void;
  /** Touch or PC, as `platform/device/input-mode.ts` decides it, seeded from the device here;
   *  `editor/session/device-wiring.ts` is the one live writer and its detector starts from this seed.
   *  Not persisted: every session starts from the device. */
  inputMode: InputMode;
  setInputMode: (mode: InputMode) => void;
  /** Portrait or landscape arrangement, as `platform/device/layout-shape.ts` decides it, seeded
   *  from the device here; `editor/session/device-wiring.ts` is the one live writer and its detector
   *  starts from this seed. */
  layoutShape: LayoutShape;
  setLayoutShape: (shape: LayoutShape) => void;
  /** Whether the tour is running. Settings, Help and the startup check open it from outside a React tree. */
  tourRunning: boolean;
  /** Starts a run on its first card without recording an offer where one may start (`tourOpenable`),
   *  or ends the run as `finishTour` does. */
  setTourRunning: (running: boolean) => void;
  /** Where the run stands, `FIRST_TOUR_PHASE` while none runs. It moves only through `setTourPhase`,
   *  `moveTour`, `startTour`, `finishTour` and `leaveShowMe`, one transition that gives back what a
   *  Show me borrowed in the same update as the Show me ends, however it ends. */
  tourPhase: TourPhase;
  /** Moves the running tour to `phase`; nothing while none runs. */
  setTourPhase: (phase: TourPhase) => void;
  /** Makes `move` over `deck`, the cards the page offers; nothing while none runs or where it goes nowhere. */
  moveTour: (move: TourMove, deck: TourDeckShape) => void;
  /** Whether a folded mode row (a top row too narrow for it beside the corner actions) stands unfolded. */
  modeRowOpen: boolean;
  setModeRowOpen: (open: boolean) => void;
  /** What the running Show me borrowed from the interface; null while none is posed. */
  tourBorrow: TourBorrow | null;
  /** Runs tour `version` from its first card, over a run standing too, and records that version as
   *  offered; nothing where no tour may start (`tourOpenable`). */
  startTour: (version: number) => void;
  /** Ends a run, giving back anything a Show me still holds. */
  finishTour: () => void;
  /** Leaves a standing Show me for its card. */
  leaveShowMe: () => void;
  /** Shows what a Show me step asks for, borrowing the interface as the first step poses it; nothing
   *  while no Show me stands. No note is being written meanwhile (`showMeOpenable`), so a pose never asks to discard one. */
  poseTour: (pose: TourPose) => void;
  /** Whether the assistant's panel is open. Its block in the mode row is the one toggle. */
  assistantOpen: boolean;
  setAssistantOpen: (open: boolean) => void;
  /**
   * Whether the panel is docked to a side edge of the window, with the rest of the interface standing
   * in what is left of the window (`ui/shell/panel-frame.ts`'s docked half).
   *
   * It is an intent, and the layout is derived from it rather than equal to it: the dock needs a
   * window wide enough for the interface beside it (`hasPinRoom`), so a narrow window stands the
   * panel free without forgetting that it was asked to dock. Persisted, unlike `assistantOpen`.
   */
  assistantPinned: boolean;
  setAssistantPinned: (pinned: boolean) => void;
  /** Which end of the window it docks at, which is part of the same intent and remembered with it:
   *  the dock's own switch control writes this, and the next session opens at the side it was left
   *  at. Read while the panel is free too, since that is the side the next dock takes. */
  assistantDockSide: DockSide;
  setAssistantDockSide: (side: DockSide) => void;
  /** Export "3D shots" menu: the session's chosen camera angles (1..5); none stands for the map's
   *  seeded set (`view/map3d/capture/shot-list.ts:shotsOf`). */
  export3dShots: CameraAngle[];
  setExport3dShots: (next: CameraAngle[]) => void;
  /** When set, Preview3D opens in edit mode to set shot `index`, seeded at `angle`; closing the
   *  preview ends it. */
  preview3DEdit: { index: number; angle: CameraAngle } | null;
  setPreview3DEdit: (v: { index: number; angle: CameraAngle } | null) => void;
  /** The map's menu: where it opened, on what, and the input mode of the press that opened it,
   *  which its rows keep while it stands. */
  contextMenu: ContextMenuEntry | null;
  setContextMenu: (menu: Omit<ContextMenuEntry, 'opened'> | null) => void;
  /** The block targeted by the delete-confirmation popover; null hides it. */
  deletePopover: BlockRef | null;
  /** What the delete question stands over, read as it opened. */
  deletePopoverOpened: SurfaceTicket | null;
  setDeletePopover: (sel: BlockRef | null) => void;
  /** Runs `body`, an edit the open menu or question makes itself (the finger's quarter turn), with
   *  both left standing over the map it leaves. */
  keepSurfacesThrough: (body: () => void) => void;
  /**
   * The planet Change Planet shows chosen after a planet session: the saved or edited entry, or null
   * for a new planet left unsaved. Held while the window it reopened stands; closing the window drops it.
   */
  planetReturn: { chosen: string | null } | null;
  /** Ends a planet session's way back: reopens Change Planet with `chosen` selected. */
  returnToPlanets: (chosen: string | null) => void;
  /** A planet switch is under way (`editor/session/planet-switch.ts:changePlanet`). Change Planet
   *  stays open through it for every closer, since there is nothing to cancel once the replay runs. */
  planetSwitching: boolean;
  setPlanetSwitching: (on: boolean) => void;
  /** A file waiting for the window that reads its kind; that window takes it as it opens. */
  handedImport: HandedImport | null;
  /** Opens the window that reads `hand.kind` and leaves the file there for it. */
  handImport: (hand: HandedImport) => void;
  /** The handed file if it is of `kind`, cleared as it is taken; null otherwise. */
  takeHandedImport: (kind: HandedImport['kind']) => File | null;
}

/** Whether the interface stands hidden: hidden by the visitor in the frame pose it stands in now. */
export function interfaceHidden(s: Pick<ShellSlice, 'interfaceHiding'> & Parameters<typeof framePose>[0]): boolean {
  return s.interfaceHiding !== null && s.interfaceHiding.session === (framePose(s) !== 'map');
}

/** Runs `body` with every store write it makes published as one update (`state/store.ts:batchStore`). */
type Batch = <T>(body: () => T) => T;
const unbatched: Batch = (body) => body();

/** The editor's event bus, which outlives every map; the map surfaces hear history changes on it. */
type BusHeld = { eventBus: Pick<EventBus<EditorEvents>, 'on' | 'off'> };

/** `startMode` is the input mode the store starts in (`state/store.ts` reads the device once);
 *  `batch` is the store's own, which a run's give-back publishes through. */
export const createShellSlice = (startMode: InputMode, batch: Batch = unbatched): StateCreator<ShellSlice & EditSlice & SelectionHeld & BlueprintHeld & HistoryHeld & BusHeld & Pick<PlanetSessionSlice, 'planetSession'> & Pick<RepairSessionSlice, 'repairSession'> & Pick<AnnotationsSlice, 'annotationDraft' | 'annotationSelection' | 'setAnnotationsVisible' | 'setAnnotationsLocked'> & Pick<PrefsSlice, 'setViewMode' | 'viewMode' | 'uiZoom'>, [], [], ShellSlice> => (set, get, api) => {
  /** While the menu or the question stands, the one watch that closes it once what it stands over
   *  moves (`editing/intent.ts:staleSurfaceFields`): any store update and any history change, since
   *  an edit changes the map in place, and any move or zoom of the view, which carries the map out
   *  from under the place on screen it stands at. `keeping` holds it through a surface's own edit;
   *  the view re-anchoring after an edit under a still camera is judged by the ticket, which that
   *  kept edit renewed, so the surface's own edit keeps it and any other has closed it already. */
  let unwatch: (() => void) | null = null;
  let keeping = 0;
  const closeStale = (): void => {
    if (keeping > 0) return;
    const fields = staleSurfaceFields(get());
    if (fields.contextMenu === null || fields.deletePopover === null) set(fields);
    if (!get().contextMenu && !get().deletePopover) unwatch?.();
  };
  const closeMoved = (view: { content?: true }): void => {
    if (view.content) { closeStale(); return; }
    set({ contextMenu: null, deletePopover: null });
    unwatch?.();
  };
  const watchSurfaces = (): void => {
    if (unwatch) return;
    const bus = get().eventBus;
    const off = api.subscribe(closeStale);
    bus.on('history-changed', closeStale);
    bus.on('viewport-changed', closeMoved);
    unwatch = () => { off(); bus.off('history-changed', closeStale); bus.off('viewport-changed', closeMoved); unwatch = null; };
  };
  /**
   * Moves the run to `phase` and gives back what a Show me borrowed, all published as one update.
   * The borrow comes off with the move first, so a listener hearing the give-back's own effects
   * finds no Show me left to give back. Then edits still landing are cancelled and the map returns to
   * its mark, so the selection given back names objects that stand again, and the view is put back
   * (its preference written now the borrow is off). On another map (one opened meanwhile) only what
   * holds on any map comes back.
   */
  const giveBack = (borrowed: TourBorrow, running: boolean, phase: TourPhase): void => batch(() => {
    set({ tourBorrow: null, tourRunning: running, tourPhase: phase });
    cancelEditsInFlight();
    const sameMap = get().gridState === borrowed.map;
    if (sameMap && borrowed.history) get().commandExecutor?.returnTo(borrowed.history);
    if (get().viewMode !== borrowed.view) get().setViewMode(borrowed.view);
    if (sameMap) {
      const notes = notesShownOf(get().gridState);
      if (notes.visible !== borrowed.notes.visible) get().setAnnotationsVisible(borrowed.notes.visible);
      if (notes.locked !== borrowed.notes.locked) get().setAnnotationsLocked(borrowed.notes.locked);
    }
    const st = get();
    const grid = st.gridState;
    const relock = sameMap && grid && borrowed.locks && grid.lockedLayers !== borrowed.locks ? grid : null;
    // A new Set, as `setLayerLocked` writes, so a selector over the locks sees the change.
    if (relock) relock.lockedLayers = new Set(borrowed.locks);
    const kept = Object.fromEntries((sameMap ? [...MAP_FREE_FIELDS, ...MAP_FIELDS] : MAP_FREE_FIELDS)
      .map((key) => [key, borrowed.editing[key]])) as Partial<TourEditing>;
    const material = { tileMaterial: borrowed.editing.tileMaterial, tileMaterialPicked: borrowed.editing.tileMaterialPicked };
    // `editModeFields` derives what the arming implies over the material given back with it, then
    // the borrowed fields override it exactly.
    set({
      ...editModeFields({ ...st, ...material }, borrowed.editing.editMode),
      ...kept,
      ...(relock ? { gridState: relock } : null),
      assistantOpen: borrowed.assistant,
      shareTarget: borrowed.shareTarget,
      ...(st.modals.share === borrowed.share ? null : { modals: { ...st.modals, share: borrowed.share } }),
    });
  });
  /** The one move of a run: to `phase`, running or not, in one update with what a Show me it leaves
   *  gives back. A Show me it would start that cannot start (`showMeOpenable`) is refused. */
  const moveRun = (running: boolean, phase: TourPhase): void => {
    const st = get();
    const was = st.tourPhase;
    const stays = running && phase.kind === 'show' && was.kind === 'show' && was.card === phase.card;
    if (phase.kind === 'show' && !stays && !showMeOpenable(st)) return;
    if (!stays && st.tourBorrow) giveBack(st.tourBorrow, running, phase);
    else set({ tourRunning: running, tourPhase: phase });
  };
  return {
    modals: Object.fromEntries(MODAL_IDS.map((id) => [id, false])) as Record<ModalId, boolean>,
    shareTarget: null,
    setShareTarget: (section) => set({ shareTarget: section }),
    openShare: (section) => set((st) => ({ shareTarget: section, modals: { ...st.modals, share: true } })),
    setModal: (id, open) => set((st) => {
      if (st.modals[id] === open) return st;
      // Change Planet closing takes its import window and its place to return to with it.
      const closesPlanets = id === 'newProject' && !open;
      if (closesPlanets && st.planetSwitching) return st;
      return {
        modals: { ...st.modals, [id]: open, ...(closesPlanets ? { planetImport: false } : null) },
        ...(closesPlanets ? { planetReturn: null } : null),
        ...(id === 'preview3d' && !open ? { preview3DEdit: null } : null),
      };
    }),
    planetSwitching: false,
    setPlanetSwitching: (on) => set((st) => (st.planetSwitching === on ? st : { planetSwitching: on })),
    planetReturn: null,
    returnToPlanets: (chosen) => set((st) => ({ planetReturn: { chosen }, modals: { ...st.modals, newProject: true } })),
    aboutTarget: null,
    setAboutTarget: (id) => set({ aboutTarget: id }),
    openAbout: (target) => set((st) => ({ aboutTarget: target, modals: st.modals.about ? st.modals : { ...st.modals, about: true } })),
    takeAboutTarget: () => {
      const target = get().aboutTarget;
      if (target) set({ aboutTarget: null });
      return target;
    },
    helpTarget: null,
    setHelpTarget: (target) => set({ helpTarget: target }),
    openHelpAt: (target) => set((st) => ({ helpTarget: target, whatsThis: false, modals: st.modals.help ? st.modals : { ...st.modals, help: true } })),
    whatsThis: false,
    setWhatsThis: (on) => set((st) => (st.whatsThis === on ? st : { whatsThis: on })),
    interfaceHiding: null,
    setInterfaceHidden: (on) => set((st) => {
      if (on === interfaceHidden(st) || (on && !interfaceHideable(st))) return st;
      return { interfaceHiding: on ? { session: framePose(st) !== 'map' } : null };
    }),
    toggleWhatsThis: () => set((st) => (st.whatsThis ? { whatsThis: false } : {
      whatsThis: true,
      ...(st.modals.help ? { modals: { ...st.modals, help: false } } : null),
    })),
    inputMode: startMode,
    setInputMode: (mode) => {
      // Each mode keeps its own UI scale, so the scale in force follows the mode.
      set((st) => (st.inputMode === mode ? st : { inputMode: mode, uiZoom: readPref(UI_ZOOM_PREFS[scaleProfileOf(mode, st.layoutShape)]) }));
      // A mouse or key has no touch latch: PC presses read the modifier key alone.
      if (mode === 'pc') get().endTouchLatches();
    },
    layoutShape: readLayoutShape('landscape'),
    // Touch mode keeps a scale for each arrangement, so turning the screen brings the other one.
    setLayoutShape: (shape) => set((st) => (st.layoutShape === shape ? st
      : { layoutShape: shape, uiZoom: readPref(UI_ZOOM_PREFS[scaleProfileOf(st.inputMode, shape)]) })),
    tourRunning: false,
    setTourRunning: (running) => {
      if (!running) get().finishTour();
      else if (!get().tourRunning && tourOpenable(get())) moveRun(true, FIRST_TOUR_PHASE);
    },
    tourPhase: FIRST_TOUR_PHASE,
    setTourPhase: (phase) => { if (get().tourRunning) moveRun(true, phase); },
    moveTour: (move, deck) => {
      const phase = tourPhaseAfter(get().tourPhase, move, deck);
      if (phase) get().setTourPhase(phase);
    },
    modeRowOpen: false,
    setModeRowOpen: (open) => set((st) => (st.modeRowOpen === open ? st : { modeRowOpen: open })),
    tourBorrow: null,
    startTour: (version) => {
      if (!tourOpenable(get())) return;
      recordTourOffered(version);
      moveRun(true, FIRST_TOUR_PHASE);
    },
    finishTour: () => moveRun(false, FIRST_TOUR_PHASE),
    leaveShowMe: () => {
      const { tourPhase: phase } = get();
      if (phase.kind === 'show') get().setTourPhase({ kind: 'deck', card: phase.card });
    },
    poseTour: (pose) => {
      if (!showMeStands(get())) return;
      // A save step's stand-in has no place in what a Show me gives back: it stands back to its frame
      // step first, which comes back whole.
      if (!get().tourBorrow) get().backToBlueprintFrame(undefined, true);
      const st = get();
      if (!st.tourBorrow) {
        const editing = Object.fromEntries([...MAP_FREE_FIELDS, ...MAP_FIELDS].map((key) => [key, st[key]])) as TourEditing;
        set({ tourBorrow: {
          editing, view: st.viewMode, assistant: st.assistantOpen, share: st.modals.share, shareTarget: st.shareTarget,
          map: st.gridState, history: st.commandExecutor?.markHistory() ?? null, locks: st.gridState?.lockedLayers ?? null,
          notes: notesShownOf(st.gridState),
        } });
      }
      if (pose.mode !== undefined && get().editMode.mode !== pose.mode) get().setEditMode({ mode: pose.mode });
      if (pose.view !== undefined && get().viewMode !== pose.view) get().setViewMode(pose.view);
      if (pose.share === null) get().setModal('share', false);
      else if (pose.share !== undefined) get().openShare(pose.share);
      if (pose.blueprint === 'strip') {
        get().backToBlueprintFrame(undefined, true);
        const step = get().blueprintStep;
        if (step.at === 'frame') get().leaveBlueprintFrame(step.id);
        get().foldBlueprintExplorer();
      }
    },
    // Every session boots with the panel closed, docked or not: the open state is never persisted.
    // The pin remembers the shape the panel opens in (`useAssistantDocked`: asked for, open and room),
    // and the conversation comes back on its own (`agent/session/persist.ts`).
    assistantOpen: false,
    setAssistantOpen: (open) => set((st) => (st.assistantOpen === open ? st : { assistantOpen: open })),
    assistantPinned: readPref('assistantPinned'),
    setAssistantPinned: (pinned) => set((st) => {
      if (st.assistantPinned === pinned) return st;
      writePref('assistantPinned', pinned);
      return { assistantPinned: pinned };
    }),
    assistantDockSide: readPref('assistantDockSide'),
    setAssistantDockSide: (side) => set((st) => {
      if (st.assistantDockSide === side) return st;
      writePref('assistantDockSide', side);
      return { assistantDockSide: side };
    }),
    export3dShots: [],
    setExport3dShots: (next) => set({ export3dShots: next }),
    preview3DEdit: null,
    setPreview3DEdit: (v) => set({ preview3DEdit: v }),
    // Neither floating surface opens while the tour runs: the tour's dim takes no pointer events, and
    // both sit at z.contextMenu, above z.tour, so either would paint over the walkthrough. Closing is
    // always allowed. Every opener (a right-click, a selection corner handle, a keybinding) passes
    // through these two setters.
    contextMenu: null,
    // A refusal returns `s` itself, not `{}`: zustand notifies every subscriber of a new state
    // object either way, but `Object.is(s, s)` lets `set` skip that notification entirely.
    setContextMenu: (menu) => {
      set((s) => (menu && s.tourRunning ? s : { contextMenu: menu && { ...menu, opened: surfaceTicket(s) } }));
      if (get().contextMenu) watchSurfaces();
    },
    deletePopover: null,
    deletePopoverOpened: null,
    setDeletePopover: (sel) => {
      set((s) => (sel && s.tourRunning ? s : { deletePopover: sel, ...(sel ? { deletePopoverOpened: surfaceTicket(s) } : null) }));
      if (get().deletePopover) watchSurfaces();
    },
    keepSurfacesThrough: (body) => {
      keeping++;
      try { body(); } finally { keeping--; }
      const s = get();
      if (!s.contextMenu && !s.deletePopover) return;
      set({
        ...(s.contextMenu ? { contextMenu: { ...s.contextMenu, opened: surfaceTicket(s) } } : null),
        ...(s.deletePopover ? { deletePopoverOpened: surfaceTicket(s) } : null),
      });
      closeStale();
    },
    handedImport: null,
    handImport: (hand) => set((st) => ({ handedImport: hand, modals: { ...st.modals, ...HAND_DESTINATION[hand.kind] } })),
    takeHandedImport: (kind) => {
      const hand = get().handedImport;
      if (hand?.kind !== kind) return null;
      set({ handedImport: null });
      return hand.file;
    },
  };
};
