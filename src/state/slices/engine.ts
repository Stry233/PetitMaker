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
import { type GridState, type MapTemplate } from '../../core/model/types';
import { type BlockRef, sameRef } from '../selection';
import { type EditorEvents } from '../editing/events';
import { createGridState } from '../../core/model/template';
import type { CommandExecutor } from '../../core/commands/command-executor';
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
  setSelection: (next: BlockRef[]) => void;
  toggleSelection: (ref: BlockRef) => void;
  clearSelection: () => void;
}

type Deps = EditSlice
  & Pick<AnnotationsSlice, 'annotationsEpoch' | keyof typeof ANNOTATION_SESSION_RESET>;

/**
 * The update a selection write makes, or null for none. A selection stands only under a tool that
 * holds one (`editing/edit-mode.ts:holdsSelection`): written while a terrain brush is up, it puts
 * the brush away for the Hand tool in the same update, keeping the build surface (`tool: 'none'`);
 * under any other such tool the write is dropped.
 */
function selectionFields(s: EngineSlice & Deps, next: BlockRef[]): Partial<EngineSlice & Deps> | null {
  const tool = activeToolOf(s);
  if (next.length === 0 || holdsSelection(tool)) return { selection: next };
  if (isBrushTool(tool)) return { ...editModeFields(s, nextEditMode(s.editMode, { arm: { kind: 'none' } })), selection: next };
  return null;
}

/** What every map swap resets: no display floor and a fresh annotation session (the bump tells the
 *  annotation views the data under them was swapped, not edited). */
const swappedSession = (s: Deps) => ({
  displayLayer: null,
  ...ANNOTATION_SESSION_RESET,
  annotationsEpoch: s.annotationsEpoch + 1,
});

export const createEngineSlice: StateCreator<EngineSlice & Deps, [], [], EngineSlice> = (set, get) => ({
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
      ...swappedSession(s),
      ...parkedFields(parked),
    }));
  },

  selection: [],
  setSelection: (next) => {
    const fields = selectionFields(get(), next);
    if (fields) set(fields);
  },
  toggleSelection: (ref) => {
    const { selection } = get();
    get().setSelection(selection.some((r) => sameRef(r, ref))
      ? selection.filter((r) => !sameRef(r, ref))
      : [...selection, ref]);
  },
  // Guarded so clearing an already-empty selection publishes no store update: subscribers to
  // `selection` would otherwise see a fresh `[]` identity on every menu navigation and tool switch.
  clearSelection: () => { if (get().selection.length > 0) set({ selection: [] }); },
});
