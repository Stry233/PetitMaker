/**
 * The engine's own handles: the live `GridState`, its `CommandExecutor`, the shared `EventBus`,
 * the selection set, and the export/undo-stack bookkeeping that reads the executor. Everything
 * a shell must never reach around — a shell field that needs one of these is the engine-coupling
 * the slice split exists to catch.
 *
 * `initMap`/`loadMap` reset the edit slice's per-map layer state (a fresh or loaded map carries no
 * locks/hidden layers over; see the inline comment at the reset), and a selection write can put a
 * brush away (`selectionFields`), so this slice reads and writes the edit slice (`Deps` below).
 */
import { readPref, writePref } from '../../platform/storage/prefs';
import { isOverBudget } from '../../core/model/load';
import { getMapStats } from '../map-stats';
import type { StateCreator } from 'zustand';
import { type GridState, type MacroCoord, type MapTemplate } from '../../core/model/types';
import { type BlockRef, sameRef, sameSelection, standingRefs } from '../selection';
import { type EditorEvents } from '../editing/events';
import { createGridState } from '../../core/model/template';
import type { CommandExecutor, HistoryAside } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { createExecutor } from '../executor';
import type { MapNotes } from '../../core/model/types';
import { limitNotes } from '../../core/model/notes';
import { attributedNotes } from '../notes-attribution';
import { editModeFields, type EditSlice } from './edit';
import { activeToolOf, holdsSelection, nextEditMode } from '../editing/edit-mode';
import { parkedFields, type ParkedEditor } from './planet-session';
import type { ANNOTATION_SESSION_RESET, AnnotationsSlice } from './annotations';
import { mapSessionReset, type ShellSlice } from './shell';
import { cancelEditsInFlight } from '../edits-in-flight';
import type { BlueprintSlice, BlueprintUi } from './blueprint';
import { leftBehindFields, selectionHeld, selectionWrite, type SelectionSurfaces } from '../editing/intent';
import type { MapStandIn } from '../map-stand-in';

export interface EngineSlice {
  loadLimitNotice: boolean;
  setLoadEnforced: (enabled: boolean) => void;
  dismissLoadLimitNotice: () => void;
  gridState: GridState | null;
  /** A map the views draw in place of `gridState`, which stays the map everything else works on
   *  (`map-stand-in.ts:shownMap`); null for none. */
  mapStandIn: MapStandIn | null;
  setMapStandIn: (next: MapStandIn | null) => void;
  eventBus: EventBus<EditorEvents>;
  commandExecutor: CommandExecutor | null;
  /** How long the undo stack was when the map was last exported — an image or a JSON, either
   *  counts, since both carry the whole map. `null` = this map has never left the browser.
   *  Everything after that point exists only here, which is what "New map" has to warn about. */
  exportedAt: number | null;
  markExported: () => void;
  /** The Generate card whose run stands on the map, which a moved maze end lands again, with the
   *  history depth its landing left; null for none. Undoing that landing ends it, and so does
   *  another map (`mapSessionReset`). */
  generateApplied: { card: number; depth: number } | null;
  /** Marks `card` as the one whose run the newest map step landed, or none. */
  setGenerateApplied: (card: number | null) => void;
  /** Writes the title and description onto the live map as typed, within the limits; blank fields
   *  clear the record. The map's `notes` is a new object on every write, so a selector over
   *  `gridState.notes` sees the change. */
  setMapNotes: (notes: MapNotes) => void;
  initMap: (template: MapTemplate, registry: RuleDispatcher) => void;
  loadMap: (state: GridState, registry: RuleDispatcher) => void;
  /** Reinstates a parked map with its own executor, selection, layer state and annotation lanes; constructs nothing. */
  restoreParkedEditor: (parked: ParkedEditor) => void;
  /**
   * The selected blocks, in the order they were added. `[]` is the one representation of
   * "nothing selected"; there is no scalar beside this list. A consumer that can only express one
   * member reads `selection.singleSelection`.
   */
  selection: BlockRef[];
  /** A change the user makes is one undo step of the map's history (`CommandExecutor.recordAside`);
   *  `{ record: false }` writes one the history must not take as its own step, such as what an edit
   *  selects as its result, which the edit's step carries. */
  setSelection: (next: BlockRef[], opts?: SelectionWrite) => void;
  toggleSelection: (ref: BlockRef) => void;
  /** Puts down the selection, the picked block and the touch latches (`editing/intent.ts:leftBehindFields`),
   *  as Escape and Done do. */
  clearSelection: (opts?: SelectionWrite) => void;
  /** A press that acts on the map is starting: the unfolded explorer, whose own selection would
   *  otherwise stand beside the map's, folds. A press that only moves the camera calls nothing. */
  beginMapPress: () => void;
  /** Writes back a selection that stood before, as no step and without the objects the map no longer
   *  holds: an undo's, or the one a carry or a frame step put down when it was backed out of. */
  restoreSelection: (refs: readonly BlockRef[]) => void;
  /**
   * The picked block: the placement cell the last plain click or tap on open ground, mountain or
   * water landed on, where the paste key puts a copy's top-left (EDIT-54). It is no selection and no
   * undo step of its own; every selection write without a `pick` and every change of arming drops it
   * (`slices/edit.ts:editModeFields`).
   */
  pickedCell: MacroCoord | null;
  /** Picks `cell`, clearing the selection as a click that clears it does (EDIT-71). */
  pickCell: (cell: MacroCoord) => void;
}

/** How a selection write meets the undo history. */
interface SelectionWrite {
  /** False for a write that is no step of its own. */
  record?: boolean;
  /** Also picks this cell (`pickedCell`), as a press on mountain or water does; dropped with a
   *  selection the map refuses. */
  pick?: MacroCoord;
}

type Deps = EditSlice & { blueprint: Pick<BlueprintUi, 'armed'> } & Pick<BlueprintSlice, 'blueprintStep' | 'foldBlueprintExplorer'> & SelectionSurfaces
  & Pick<AnnotationsSlice, 'annotationsEpoch' | keyof typeof ANNOTATION_SESSION_RESET>
  & Pick<ShellSlice, 'contextMenu' | 'deletePopover'>;

/** The update a selection write makes, or null for none (`editing/intent.ts:selectionWrite`); a
 *  write that puts a brush away arms none in the same update, keeping the build surface. */
function selectionFields(s: EngineSlice & Deps, requested: BlockRef[]): Partial<EngineSlice & Deps> | null {
  const write = selectionWrite(s, activeToolOf(s), requested);
  if (!write) return null;
  return write.brushAway ? { ...editModeFields(s, nextEditMode(s.editMode, { arm: { kind: 'none' } })), ...write.fields } : write.fields;
}

/** The selection as a map's history carries it, read by `read`: an undo or redo writes it back
 *  through `restore`, and only while `shows` (a tool that holds one is up), since under any other
 *  every selection shows the same nothing. */
export function selectionAside(read: () => BlockRef[], restore: (refs: BlockRef[]) => void, shows: () => boolean): HistoryAside<BlockRef[]> {
  return {
    read,
    write: (value) => { if (shows()) restore(value); },
    same: (a, b) => !shows() || sameSelection(a, b),
  };
}

/** What every map swap resets: every map-owned transient (`mapSessionReset`), with the bump that
 *  tells the annotation views the data under them was swapped, not edited. Edits still landing on
 *  the map it replaces are cancelled first, while that map is still the live one. */
const swappedSession = (s: Deps) => {
  cancelEditsInFlight();
  return { ...mapSessionReset(), annotationsEpoch: s.annotationsEpoch + 1 };
};

export const createEngineSlice: StateCreator<EngineSlice & Deps, [], [], EngineSlice> = (set, get, api) => {
  /** Writes `next` as `selectionFields` allows; a recorded write that changed it is an undo step.
   *  Every selection write passes here, so a map selection landing while Blueprint's explorer stands
   *  folds it first, ending its own selection and giving back the one it set aside, which the write
   *  then replaces: one selection is ever live. */
  const writeSelection = (next: BlockRef[], record: boolean, picked: MacroCoord | null = null): void => {
    if (get().blueprintStep.at === 'explorer' && (selectionFields(get(), next)?.selection?.length ?? 0) > 0) get().foldBlueprintExplorer();
    const s = get();
    const fields = selectionFields(s, next);
    if (!fields) return;
    set(picked && fields.selection?.length === next.length ? { ...fields, pickedCell: picked } : fields);
    if (record && fields.selection) s.commandExecutor?.recordAside(s.selection);
  };
  // Whichever executor the store holds carries the selection, written back unrecorded and without the
  // objects the map no longer holds; an undo or redo under a tool that holds none neither writes one
  // nor puts the tool away for one.
  const aside = selectionAside(() => get().selection, (refs) => get().restoreSelection(refs), () => holdsSelection(activeToolOf(get())));
  api.subscribe((s, prev) => { if (s.commandExecutor !== prev.commandExecutor) s.commandExecutor?.attachAside(aside); });
  const eventBus = new EventBus<EditorEvents>();
  // The applied card's landing is undone once the history holds fewer map steps than it left.
  eventBus.on('history-changed', () => {
    const { generateApplied: applied, commandExecutor } = get();
    if (applied && (commandExecutor?.historyDepth() ?? 0) < applied.depth) set({ generateApplied: null });
  });
  return {
    loadLimitNotice: false,
    dismissLoadLimitNotice: () => set({ loadLimitNotice: false }),
    setLoadEnforced: (enabled) => {
      const grid = get().gridState;
      if (grid) grid.ignoreChunkLoad = !enabled;
      writePref('enforceChunkLoad', enabled);
      // A selector over `gridState.ignoreChunkLoad` reads the change this update publishes.
      set({ loadLimitNotice: false });
    },
    gridState: null,
    mapStandIn: null,
    setMapStandIn: (next) => set({ mapStandIn: next }),
    eventBus,
    commandExecutor: null,
    exportedAt: null,
    markExported: () => set({ exportedAt: get().commandExecutor?.historyDepth() ?? 0 }),
    generateApplied: null,
    setGenerateApplied: (card) => {
      const depth = get().commandExecutor?.historyDepth();
      set({ generateApplied: card === null || depth === undefined ? null : { card, depth } });
    },
    setMapNotes: (notes) => {
      const gridState = get().gridState;
      if (!gridState) return;
      const next = limitNotes(attributedNotes(gridState, notes) ?? {});
      if (next) gridState.notes = next; else delete gridState.notes;
      set({ gridState });
    },

    initMap: (template, registry) => get().loadMap(createGridState(template), registry),

    loadMap: (gridState, registry) => {
      // An overloaded map opens with the limit off for itself only; the preference stays the user's.
      const overloaded = [...getMapStats(gridState).chunks.values()].some((chunk) => isOverBudget(chunk.load));
      gridState.ignoreChunkLoad = overloaded || !readPref('enforceChunkLoad');
      gridState.lockedLayers = new Set();
      const { eventBus } = get();
      const swapped = swappedSession(get());
      const executor = createExecutor(gridState, registry, eventBus);
      set({ gridState, commandExecutor: executor, loadLimitNotice: overloaded, ...swapped });
    },

    // The parked map keeps its own policy: the planet session offers no load switch.
    restoreParkedEditor: (parked) => {
      const swapped = swappedSession(get());
      set({
        gridState: parked.gridState,
        commandExecutor: parked.executor,
        ...swapped,
        selection: parked.selection,
        regions: parked.regions,
        ...parkedFields(parked),
      });
    },

    selection: [],
    setSelection: (next, opts) => writeSelection(next, opts?.record ?? true, opts?.pick ?? null),
    toggleSelection: (ref) => {
      const { selection } = get();
      get().setSelection(selection.some((r) => sameRef(r, ref))
        ? selection.filter((r) => !sameRef(r, ref))
        : [...selection, ref]);
    },
    // Guarded so clearing an already-empty selection publishes no store update: subscribers to
    // `selection` would otherwise see a fresh `[]` identity on every menu navigation and tool switch.
    clearSelection: (opts) => {
      const s = get();
      if (selectionHeld(s)) set(leftBehindFields(s));
      if (opts?.record ?? true) s.commandExecutor?.recordAside(s.selection);
    },
    beginMapPress: () => { if (get().blueprintStep.at === 'explorer') get().foldBlueprintExplorer(); },
    restoreSelection: (refs) => {
      const grid = get().gridState;
      writeSelection(grid ? standingRefs(grid, refs) : [...refs], false);
    },
    pickedCell: null,
    pickCell: (cell) => {
      // Only where a click selects: under any other tool nothing would show or clear the pick.
      if (!holdsSelection(activeToolOf(get()))) return;
      const now = get().pickedCell;
      if (now && now.x === cell.x && now.y === cell.y && get().selection.length === 0) return;
      writeSelection([], true, { x: cell.x, y: cell.y });
    },
  };
};
