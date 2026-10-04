/**
 * The live editor, handed to every operation explicitly.
 *
 * `kit/operations/` must never import the store itself: an operation that reached for it directly
 * could only ever have one caller, since a live `useEditorStore` bakes in one instance. Instead the
 * UI passes `currentKit()`, the agent builds a `KitContext` from its own deps, and a test constructs
 * one by hand — three callers running the same operation code. `installMap`/`installLoadedMap`
 * below are the one sanctioned path in, which is what `kit/operations/map.ts` calls instead of
 * touching the store.
 *
 * `kit/host.ts`, `kit/commands.ts` and `kit/group-edit.ts` read the store live too, same as this
 * file — they sit beside `operations/` rather than in it, each with exactly one caller (the app
 * shell), so the single-caller argument that binds an operation doesn't bind them.
 */
import type { EditorEvents, GridState, MapTemplate } from '../core/model/types';
import type { EventBus } from '../core/commands/event-bus';
import { bumpObjectsVersion, templateLandmark } from '../core/model/grid-model';
import type { RuleRegistry } from '../rules/registry';
import type { MacroContext } from '../tools/macros';
import { useEditorStore } from '../state/store';
import type { ParkedEditor, PlanetSession } from '../state/slices/planet-session';
import { parkedFields } from '../state/slices/planet-session';

/** The `{state, executor, registry}` triple, defined once in `tools/macros/context.ts` — the
 *  operations layer and the macros run against the same editor shape. */
export type KitContext = MacroContext;

/** The live editor, or null before a map is loaded. */
export function currentKit(): KitContext | null {
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
export function currentPlanetSession(): PlanetSession | null {
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
 * its plaza movable. All or nothing: a throw puts `session.parked` back as the live map and rethrows.
 */
export function installPlanetCanvas(template: MapTemplate, registry: RuleRegistry, session: PlanetSession): void {
  const store = useEditorStore.getState();
  try {
    store.setViewMode('2d');
    store.initMap(template, registry);
    const state = useEditorStore.getState().gridState!;
    const plaza = templateLandmark(state);
    if (plaza) {
      // The canvas has no history yet, so the plaza is swapped in place rather than by a command.
      const movable = { ...plaza, locked: false };
      state.objects.set(plaza.id, movable);
      bumpObjectsVersion(state, { removed: [plaza], added: [movable] });
    }
    store.clearSelection();
    store.setDeletePopover(null);
    store.setSelectingRegion(false);
    store.setRegion([]);
    store.setPlanetSession(session);
    store.setPlanetMaterial('mountain');
    store.setEditMode({ mode: 'mountain', tool: 'brush' });
  } catch (err) {
    restoreParkedMap(session.parked);
    throw err;
  }
}

/** Reinstates the parked map with its edit mode and view mode, and ends the session. */
export function restoreParkedMap(parked: ParkedEditor): void {
  const store = useEditorStore.getState();
  store.restoreParkedEditor(parked);
  store.restoreEditMode(parked.editMode);
  store.setRegion(parked.region);
  store.setViewMode(parked.viewMode);
  store.setPlanetSession(null);
}
