/**
 * The engine's own handles: the live `GridState`, its `CommandExecutor`, the shared `EventBus`,
 * the selection set, and the export/undo-stack bookkeeping that reads the executor. Everything
 * a shell must never reach around — a shell field that needs one of these is the engine-coupling
 * the slice split exists to catch.
 *
 * `initMap`/`loadMap` reset the edit slice's per-map layer state (a fresh or loaded map carries no
 * locks/hidden layers over — see the inline comment at the reset), so this slice takes one narrow
 * cross-slice dependency: write access to those four layer fields.
 */
import type { StateCreator } from 'zustand';
import {
  type GridState,
  type MapTemplate,
  type EditorEvents,
  type PlacedObject,
  type BlockRef,
} from '../../core/model/types';
import { createGrid, createPlazaObject } from '../../core/model/grid-model';
import { CommandExecutor } from '../../core/commands/command-executor';
import { EventBus } from '../../core/commands/event-bus';
import type { RuleRegistry } from '../../rules/registry';
import { roadLookup } from '../object-index';
import type { MapNotes } from '../../core/model/types';
import { limitNotes } from '../../core/model/notes';
import { attributedNotes } from '../../core/provenance/image-attribution';
import { catalogLoadValue } from '../catalog';
import { sameRef } from '../selection';
import type { EditSlice } from './edit';
import { ANNOTATION_SESSION_RESET, type AnnotationsSlice } from './annotations';

export interface EngineSlice {
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

export const createEngineSlice: StateCreator<EngineSlice & Deps, [], [], EngineSlice> = (set, get) => ({
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

  initMap: (template, registry) => {
    const cells = createGrid(template);
    const objects = new Map<string, PlacedObject>();
    const plaza = createPlazaObject(template);
    if (plaza) objects.set(plaza.id, plaza);
    const gridState: GridState = {
      template,
      cells,
      objects,
      lockedLayers: new Set(),
    };
    const { eventBus } = get();
    const executor = new CommandExecutor(gridState, eventBus, registry, roadLookup(gridState), catalogLoadValue);
    set((s) => ({
      gridState,
      commandExecutor: executor,
      activeLayer: 0,      // a fresh map opens with Ground selected, not an empty Layer 1
      layerPinned: false,  // and with nothing chosen by hand, so the water brush follows the ground
      displayLayer: null,
      // Per-map layer state: carrying the old map's locks/hidden layers over would
      // show a lock the rules don't enforce (the gridState mirror only re-syncs on
      // change) and hide fresh paint with no visible cause.
      layerVisibility: {},
      layerLocked: {},
      // The annotation SESSION follows the map the same way; the bump is what tells the
      // annotation views the data under them was swapped, not edited.
      ...ANNOTATION_SESSION_RESET,
      annotationsEpoch: s.annotationsEpoch + 1,
      notesEpoch: s.notesEpoch + 1,
    }));
  },

  loadMap: (gridState, registry) => {
    const { eventBus } = get();
    const executor = new CommandExecutor(gridState, eventBus, registry, roadLookup(gridState), catalogLoadValue);
    set((s) => ({
      gridState,
      commandExecutor: executor,
      // Per-map, exactly as in `initMap`: a floor chosen for the map being left, and a hand's pin
      // on it, describe terrain the loaded map does not have — and the pin GOVERNS what the water
      // brush does, so carrying one over would have the previous session quietly steering this one.
      activeLayer: 0,
      layerPinned: false,
      displayLayer: null,
      layerVisibility: {},
      layerLocked: {},
      ...ANNOTATION_SESSION_RESET,
      annotationsEpoch: s.annotationsEpoch + 1,
      notesEpoch: s.notesEpoch + 1,
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
