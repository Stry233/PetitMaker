/**
 * The engine's own handles: the live `GridState`, its `CommandExecutor`, the shared `EventBus`,
 * the selection set, and the export/undo-stack bookkeeping that reads the executor. Everything
 * a shell must never reach around — a shell field that needs one of these is the engine-coupling
 * the slice split exists to catch.
 *
 * `initMap`/`loadMap` reset the edit slice's per-map layer state (a fresh or loaded map carries no
 * locks/hidden layers over — see the inline comment at the reset), so this slice takes one narrow
 * cross-slice dependency: write access to those layer fields (`Deps` below).
 */
import { readPref, writePref } from '../../core/runtime/prefs';
import { CHUNK_LOAD_LIMIT } from '../../core/model/game-profile';
import { getMapStats } from '../map-stats';
import type { StateCreator } from 'zustand';
import {
  type GridState,
  type MapTemplate,
  type EditorEvents,
  type BlockRef,
} from '../../core/model/types';
import { createGridState } from '../../core/model/planet';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import type { RuleRegistry } from '../../rules/registry';
import { createExecutor } from '../executor';
import type { MapNotes } from '../../core/model/types';
import { limitNotes } from '../../core/model/notes';
import { attributedNotes } from '../../core/provenance/image-attribution';
import { sameRef } from '../selection';
import type { EditSlice } from './edit';
import { parkedFields, type ParkedEditor } from './planet-session';
import { ANNOTATION_SESSION_RESET, type AnnotationsSlice } from './annotations';

export interface EngineSlice {
  loadPolicyEpoch: number;
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
  /** Bumped whenever `gridState.notes` changes or the map is swapped, since notes live on the grid state. */
  notesEpoch: number;
  /** Writes the title and description onto the live map as typed, within the limits; blank fields clear the record. */
  setMapNotes: (notes: MapNotes) => void;
  initMap: (template: MapTemplate, registry: RuleRegistry) => void;
  loadMap: (state: GridState, registry: RuleRegistry) => void;
  /** Reinstates a parked map with its own executor, selection, layer state and annotation lanes; constructs nothing. */
  restoreParkedEditor: (parked: ParkedEditor) => void;
  /**
   * The selected blocks, in the order they were added. `[]` is the ONE representation of
   * "nothing selected"; there is no scalar beside this list. A consumer that can only express one
   * member reads `selection.singleSelection`.
   */
  selection: BlockRef[];
  setSelection: (next: BlockRef[]) => void;
  toggleSelection: (ref: BlockRef) => void;
  clearSelection: () => void;
}

type Deps = Pick<EditSlice, 'activeLayer' | 'layerPinned' | 'displayLayer' | 'layerVisibility' | 'layerLocked'>
  & Pick<AnnotationsSlice, 'annotationsEpoch' | keyof typeof ANNOTATION_SESSION_RESET>;

/** What every map swap resets: no display floor, a fresh annotation session (the bump tells the
 *  annotation views the data under them was swapped, not edited) and a notes bump. */
const swappedSession = (s: Deps & Pick<EngineSlice, 'notesEpoch'>) => ({
  displayLayer: null,
  ...ANNOTATION_SESSION_RESET,
  annotationsEpoch: s.annotationsEpoch + 1,
  notesEpoch: s.notesEpoch + 1,
});

export const createEngineSlice: StateCreator<EngineSlice & Deps, [], [], EngineSlice> = (set, get) => ({
  loadPolicyEpoch: 0,
  loadLimitNotice: false,
  dismissLoadLimitNotice: () => set({ loadLimitNotice: false }),
  setLoadEnforced: (enabled) => {
    const grid = get().gridState;
    if (grid) grid.ignoreChunkLoad = !enabled;
    writePref('enforceChunkLoad', enabled);
    set((s) => ({ loadPolicyEpoch: s.loadPolicyEpoch + 1, loadLimitNotice: false }));
  },
  gridState: null,
  eventBus: new EventBus<EditorEvents>(),
  commandExecutor: null,
  exportedAt: null,
  markExported: () => set({ exportedAt: get().commandExecutor?.getUndoStackSize() ?? 0 }),
  notesEpoch: 0,
  setMapNotes: (notes) => {
    const gridState = get().gridState;
    if (!gridState) return;
    const next = limitNotes(attributedNotes(gridState, notes) ?? {});
    if (next) gridState.notes = next; else delete gridState.notes;
    set((s) => ({ notesEpoch: s.notesEpoch + 1 }));
  },

  initMap: (template, registry) => get().loadMap(createGridState(template), registry),

  loadMap: (gridState, registry) => {
    // An overloaded map opens with the limit off for itself only; the preference stays the user's.
    const overloaded = [...getMapStats(gridState).chunks.values()].some((chunk) => chunk.load > CHUNK_LOAD_LIMIT);
    gridState.ignoreChunkLoad = overloaded || !readPref('enforceChunkLoad');
    const { eventBus } = get();
    const executor = createExecutor(gridState, registry, eventBus);
    set((s) => ({
      gridState,
      commandExecutor: executor,
      loadLimitNotice: overloaded,
      loadPolicyEpoch: s.loadPolicyEpoch + 1,
      // Per-map layer state: a new map opens with Ground selected and nothing chosen by hand, so the
      // water brush follows the ground. Carrying the old map's floor, pin, locks or hidden layers
      // over would describe terrain this map does not have, show a lock the rules don't enforce
      // (the gridState mirror only re-syncs on change) and hide fresh paint with no visible cause.
      activeLayer: 0,
      layerPinned: false,
      layerVisibility: {},
      layerLocked: {},
      ...swappedSession(s),
    }));
  },

  // The parked map keeps its own policy: the planet session offers no load switch.
  restoreParkedEditor: (parked) => {
    set((s) => ({
      gridState: parked.gridState,
      commandExecutor: parked.executor,
      loadPolicyEpoch: s.loadPolicyEpoch + 1,
      selection: parked.selection,
      ...swappedSession(s),
      ...parkedFields(parked),
    }));
  },

  selection: [],
  setSelection: (next) => set({ selection: next }),
  toggleSelection: (ref) => set((s) => ({
    selection: s.selection.some((r) => sameRef(r, ref))
      ? s.selection.filter((r) => !sameRef(r, ref))
      : [...s.selection, ref],
  })),
  // Guarded so clearing an already-empty selection publishes no store update: subscribers to
  // `selection` would otherwise see a fresh `[]` identity on every menu navigation and tool switch.
  clearSelection: () => { if (get().selection.length > 0) set({ selection: [] }); },
});
