/**
 * The live editor, handed to every operation explicitly.
 *
 * `editor/operations/` must never import the store itself: an operation that reached for it directly
 * could only ever have one caller, since a live `useEditorStore` bakes in one instance. Instead the
 * UI passes `currentEditor()`, the agent builds an `EditContext` from its own deps, and a test constructs
 * one by hand — three callers running the same operation code. An operation that opens a map or a
 * planet session takes the editor as a port (`MapPort`, `SessionPort`) and never imports this file's
 * values: `editorPort` below is the store-backed port the shell passes, and a test may pass its own.
 *
 * The modules beside `operations/` (host, commands, group edits, the brushes and pickers) read the
 * store live too, as this file does: each serves the one app shell, so the single-caller argument
 * that binds an operation does not bind them.
 */
import type { GridState, MapTemplate } from '../../core/model/types';
import type { EditorEvents } from '../../state/editing/events';
import type { EventBus } from '../../core/commands/event-bus';
import { bumpObjectsVersion } from '../../core/model/grid-model';
import { landmarkObjects } from '../../core/model/landmarks';
import type { RuleRegistry } from '../../rules/registry';
import type { EditContext } from '../../core/commands/edit-context';
import { batchStore, useEditorStore } from '../../state/store';
import type { ParkedEditor, PlanetSession } from '../../state/slices/planet-session';
import { parkedFields } from '../../state/slices/planet-session';

/** The live editor, or null before a map is loaded. */
export function currentEditor(): EditContext | null {
  const { gridState, commandExecutor } = useEditorStore.getState();
  if (!gridState || !commandExecutor) return null;
  return {
    state: gridState,
    executor: commandExecutor,
    registry: commandExecutor.getRegistry(),
  };
}

/** The editor's event bus, which outlives every installed map. */
export function editorEventBus(): EventBus<EditorEvents> {
  return useEditorStore.getState().eventBus;
}

/** Opens `template` as the live map. The mechanism `newMap` calls. */
export function installMap(template: MapTemplate, registry: RuleRegistry): void {
  useEditorStore.getState().initMap(template, registry);
}

/** Opens `state` as the live map. The mechanism `loadMap` calls. */
export function installLoadedMap(state: GridState, registry: RuleRegistry): void {
  useEditorStore.getState().loadMap(state, registry);
}

/** The planet session in progress, or null. */
function currentPlanetSession(): PlanetSession | null {
  return useEditorStore.getState().planetSession;
}

/** The live editor by identity, with the cameras the caller read; null before a map is loaded. */
export function parkLiveEditor(camera2d: ParkedEditor['camera2d'], camera3d: ParkedEditor['camera3d']): ParkedEditor | null {
  const s = useEditorStore.getState();
  if (!s.gridState || !s.commandExecutor) return null;
  return {
    gridState: s.gridState,
    executor: s.commandExecutor,
    selection: s.selection,
    region: s.region,
    ...parkedFields(s),
    editMode: s.editMode,
    camera2d,
    camera3d,
    viewMode: s.viewMode,
  };
}

/**
 * Opens the planet canvas as the live map in the 2D view and mountain mode with the brush armed,
 * its landmarks movable, with the assistant folded away, since a planet session draws without it.
 * All or nothing: a throw puts `session.parked` back as the live map and rethrows.
 */
export function installPlanetCanvas(template: MapTemplate, registry: RuleRegistry, session: PlanetSession): void {
  try {
    batchStore(() => {
      const store = useEditorStore.getState();
      store.setViewMode('2d');
      store.initMap(template, registry);
      const state = useEditorStore.getState().gridState!;
      for (const landmark of landmarkObjects(state)) {
        // The canvas has no history yet, so each landmark is swapped in place rather than by a command.
        const movable = { ...landmark, locked: false };
        state.objects.set(landmark.id, movable);
        bumpObjectsVersion(state, { removed: [landmark], added: [movable] });
      }
      store.clearSelection();
      store.setDeletePopover(null);
      store.setSelectingRegion(false);
      store.setRegion([]);
      store.setPlanetSession(session);
      store.setAssistantOpen(false);
      store.setPlanetMaterial('mountain');
      store.setEditMode({ mode: 'mountain', arm: { kind: 'brush' } });
    });
  } catch (err) {
    restoreParkedMap(session.parked);
    throw err;
  }
}

/** Reinstates the parked map with its edit mode and view mode, and ends the session. */
export function restoreParkedMap(parked: ParkedEditor): void {
  batchStore(() => {
    const store = useEditorStore.getState();
    store.restoreParkedEditor(parked);
    store.restoreEditMode(parked.editMode);
    store.setRegion(parked.region);
    store.setViewMode(parked.viewMode);
    store.setPlanetSession(null);
  });
}

/** What opening a map asks of the editor. */
export interface MapPort {
  /** Opens `template` as the live map under `registry`. */
  install(template: MapTemplate, registry: RuleRegistry): void;
  /** Opens `state` as the live map under `registry`. */
  installLoaded(state: GridState, registry: RuleRegistry): void;
}

/** What a planet session asks of the editor. */
export interface SessionPort {
  /** The live editor, or null before a map is loaded. */
  live(): EditContext | null;
  /** The editor's event bus, which outlives every installed map. */
  events(): EventBus<EditorEvents>;
  /** The planet session in progress, or null. */
  planetSession(): PlanetSession | null;
  /** The live editor by identity with the cameras the caller read; null before a map is loaded. */
  park(camera2d: ParkedEditor['camera2d'], camera3d: ParkedEditor['camera3d']): ParkedEditor | null;
  /** Opens the planet canvas as the live map (`installPlanetCanvas`). */
  openPlanetCanvas(template: MapTemplate, registry: RuleRegistry, session: PlanetSession): void;
  /** Reinstates the parked map and ends the session (`restoreParkedMap`). */
  endSession(parked: ParkedEditor): void;
}

/** The editor as one port: both halves, backed by the live store. */
export type EditorPort = MapPort & SessionPort;

/** The live editor's port, which the shell hands to the operations. */
export const editorPort: EditorPort = {
  install: installMap,
  installLoaded: installLoadedMap,
  live: currentEditor,
  events: editorEventBus,
  planetSession: currentPlanetSession,
  park: parkLiveEditor,
  openPlanetCanvas: installPlanetCanvas,
  endSession: restoreParkedMap,
};
