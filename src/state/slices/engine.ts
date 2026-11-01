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
import { activeToolOf, holdsSelection, isBrushTool, nextEditMode } from '../editing/edit-mode';
import { parkedFields, type ParkedEditor } from './planet-session';
import { ANNOTATION_SESSION_RESET, type AnnotationsSlice } from './annotations';

export interface EngineSlice {
  loadLimitNotice: boolean;
  setLoadEnforced: (enabled: boolean) => void;
  dismissLoadLimitNotice: () => void;
  gridState: GridState | null;
  eventBus: EventBus<EditorEvents>;
  commandExecutor: CommandExecutor | null;
  /** How long the undo stack was when the map was last exported — an image or a JSON, either
   *  counts, since both carry the whole map. `null` = this map has never left the browser.
   *  Everything after that point exists only here, which is what "New map" has to warn about. */
  exportedAt: number | null;
  markExported: () => void;
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
  /** Clears the selection and the picked block (Escape, Done, a map swap). */
  clearSelection: (opts?: SelectionWrite) => void;
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

type Deps = EditSlice
  & Pick<AnnotationsSlice, 'annotationsEpoch' | keyof typeof ANNOTATION_SESSION_RESET>;

/**
 * The update a selection write makes, or null for none. On a map that limits presses
 * (`GridState.unsettled`) only those objects are kept. A selection stands only under a tool that
 * holds one (`editing/edit-mode.ts:holdsSelection`): written while a terrain brush is up, it puts
 * the brush away for the Hand tool in the same update, keeping the build surface (`tool: 'none'`);
 * under any other such tool the write is dropped.
 */
function selectionFields(s: EngineSlice & Deps, requested: BlockRef[]): Partial<EngineSlice & Deps> | null {
  const unsettled = s.gridState?.unsettled;
  const next = unsettled ? requested.filter((r) => r.kind === 'object' && unsettled.has(r.id)) : requested;
  const tool = activeToolOf(s);
  // Any selection write spends the move latch.
  const latch = s.moveLatched ? { moveLatched: false } : null;
  // Any selection write drops the picked block; `pickCell` sets it after.
  const unpick = s.pickedCell ? { pickedCell: null } : null;
  if (next.length === 0 || holdsSelection(tool)) return { selection: next, ...latch, ...unpick };
  if (isBrushTool(tool)) return { ...editModeFields(s, nextEditMode(s.editMode, { arm: { kind: 'none' } })), selection: next, ...latch, ...unpick };
  return null;
}

/** What every map swap resets: no display floor and a fresh annotation session (the bump tells the
 *  annotation views the data under them was swapped, not edited). */
const swappedSession = (s: Deps) => ({
  displayLayer: null,
  ...ANNOTATION_SESSION_RESET,
  annotationsEpoch: s.annotationsEpoch + 1,
});

export const createEngineSlice: StateCreator<EngineSlice & Deps, [], [], EngineSlice> = (set, get, api) => {
  /** Writes `next` as `selectionFields` allows; a recorded write that changed it is an undo step. */
  const writeSelection = (next: BlockRef[], record: boolean, picked: MacroCoord | null = null): void => {
    const s = get();
    const fields = selectionFields(s, next);
    if (!fields) return;
    set(picked && fields.selection?.length === next.length ? { ...fields, pickedCell: picked } : fields);
    if (record && fields.selection) s.commandExecutor?.recordAside(s.selection);
  };
  /** Whether a selection shows under the tool up now: under any other, every selection shows the
   *  same nothing, so an undo or redo neither writes one nor puts the tool away for one. */
  const showsSelection = (): boolean => holdsSelection(activeToolOf(get()));
  /** The selection as the map's history carries it: an undo or redo writes it back unrecorded,
   *  without the objects the map no longer holds. */
  const selectionAside: HistoryAside<BlockRef[]> = {
    read: () => get().selection,
    write: (value) => {
      if (!showsSelection()) return;
      const grid = get().gridState;
      writeSelection(grid ? standingRefs(grid, value) : value, false);
    },
    same: (a, b) => !showsSelection() || sameSelection(a, b),
  };
  // Whichever executor the store holds carries the selection, however it was installed.
  api.subscribe((s, prev) => { if (s.commandExecutor !== prev.commandExecutor) s.commandExecutor?.attachAside(selectionAside); });
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
    eventBus: new EventBus<EditorEvents>(),
    commandExecutor: null,
    exportedAt: null,
    markExported: () => set({ exportedAt: get().commandExecutor?.historyDepth() ?? 0 }),
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
      const executor = createExecutor(gridState, registry, eventBus);
      set((s) => ({
        gridState,
        commandExecutor: executor,
        loadLimitNotice: overloaded,
        pickedCell: null,
        // Per-map layer state: a new map opens with Ground selected, automatic and all shown.
        activeLayer: 0,
        layerPinned: false,
        layerVisibility: {},
        ...swappedSession(s),
      }));
    },

    // The parked map keeps its own policy: the planet session offers no load switch.
    restoreParkedEditor: (parked) => {
      set((s) => ({
        gridState: parked.gridState,
        commandExecutor: parked.executor,
        selection: parked.selection,
        pickedCell: null,
        ...swappedSession(s),
        ...parkedFields(parked),
      }));
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
    // Clearing ends the touch latches too, so Escape leaves multi-select as Done does.
    clearSelection: (opts) => {
      const s = get();
      if (s.selection.length > 0 || s.pickedCell || s.multiSelectLatched || s.moveLatched) {
        set({ selection: [], pickedCell: null, multiSelectLatched: false, moveLatched: false });
      }
      if (opts?.record ?? true) s.commandExecutor?.recordAside(s.selection);
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
