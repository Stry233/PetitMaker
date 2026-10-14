/**
 * The planet session with persistence around it: the map being parked has its pending autosave
 * written first, autosave stays off while the scratch canvas is live, and finishing saves the
 * planet to the library before the parked map comes back.
 */
import {
  listPlanets, onPlanetLibraryChange, planetLibraryVersion, savePlanet, type PlanetEntry,
} from '../../io/storage/planet-library';
import { useEditorStore, type EditorStore } from '../../state/store';
import { enterPlanetSession, finishPlanetSession, leavePlanetSession, type PlanetDraft } from '../operations/planet-session';
import { host } from '../host/host';
import { autosave } from './autosave';
import { editorPort } from './context';

export type FinishPlanetResult = { ok: true; entry: PlanetEntry } | { ok: false; reason: 'quota' | 'empty' };

/**
 * Whether a planet session may open over the current map: there is a map, no session is open, the
 * tour is not running, no assistant job (`jobRunning`) is working on the map and no annotation
 * draft is waiting for its answer.
 */
export function canStartPlanetEditing(
  state: Pick<EditorStore, 'gridState' | 'planetSession' | 'annotationDraft' | 'tourRunning'>,
  jobRunning: boolean,
): boolean {
  return !!state.gridState && !state.planetSession && !state.annotationDraft && !state.tourRunning && !jobRunning;
}

/** The stored library entry `entryId` names, as it stands now; null for a new planet or one since removed. */
function storedEntry(entryId: string | null): PlanetEntry | null {
  return entryId === null ? null : listPlanets().find((e) => e.entryId === entryId) ?? null;
}

/** Where the session's planet stands in the library: the entry it edits (null for a new planet or
 *  one since removed), that entry's index, and how many entries the library holds. */
export interface SessionLibraryPlace {
  entry: PlanetEntry | null;
  index: number;
  count: number;
}

let place: { version: number; session: EditorStore['planetSession']; value: SessionLibraryPlace } | null = null;

/** The live session planet's `SessionLibraryPlace`, the same object until the library is written
 *  (`onSessionLibraryChange`) or the session changes. */
export function sessionLibraryPlace(): SessionLibraryPlace {
  const version = planetLibraryVersion();
  const session = useEditorStore.getState().planetSession;
  if (place && place.version === version && place.session === session) return place.value;
  const entries = listPlanets();
  const entry = storedEntry(session?.entryId ?? null);
  place = { version, session, value: { entry, index: entry ? entries.indexOf(entry) : -1, count: entries.length } };
  return place.value;
}

/** Calls `listener` after every library write, which may move the session's `SessionLibraryPlace`; returns the stop. */
export function onSessionLibraryChange(listener: () => void): () => void {
  return onPlanetLibraryChange(listener);
}

/**
 * Opens `source` over the current map: a saved entry, a draft as a new planet (one read from a
 * scan), or a blank new planet when null. The stored entry is opened, whatever name it was shown
 * under. Returns whether a session opened; `jobRunning` says an assistant job owns the map.
 */
export function startPlanetEditing(source: PlanetEntry | PlanetDraft | null, jobRunning: boolean): boolean {
  if (!canStartPlanetEditing(useEditorStore.getState(), jobRunning)) return false;
  autosave.flush();
  autosave.setSuspended(true);
  try {
    const view2d = host.camera.get2d();
    const view3d = host.camera.get3d();
    const opened = source && 'entryId' in source ? storedEntry(source.entryId) ?? source : source;
    enterPlanetSession(editorPort, opened, {
      ...(view2d ? { view2d } : {}), ...(view3d ? { view3d } : {}),
    });
  } finally {
    // With no session open (no map to park, or entry failed) autosave carries on.
    if (!useEditorStore.getState().planetSession) autosave.setSuspended(false);
  }
  return useEditorStore.getState().planetSession !== null;
}

/** Leaves without saving the planet and reopens Change Planet on `returnTo`, by default the entry edited. */
export function stopPlanetEditing(returnTo?: string | null): void {
  const session = useEditorStore.getState().planetSession;
  try {
    const cameras = leavePlanetSession(editorPort);
    if (session) host.camera.queue(cameras);
  } finally {
    autosave.setSuspended(false);
  }
  if (session) useEditorStore.getState().returnToPlanets(returnTo === undefined ? session.entryId : returnTo);
}

/**
 * Saves the planet as `name`, replacing the entry being edited unless `asCopy`, then leaves.
 * `shownName` is the name the session planet is shown under. A name still awaiting the text
 * check, left as that shown name, is saved as it was stored and stays unchecked; only a name the
 * visitor gave replaces it. A failed save keeps the session open so nothing drawn is lost.
 */
export function finishPlanetEditing(name: string, asCopy: boolean, shownName: string): FinishPlanetResult {
  const session = useEditorStore.getState().planetSession;
  if (!session) return { ok: false, reason: 'empty' };
  const live = storedEntry(session.entryId);
  const stored = live ?? (session.entryId !== null ? { name: session.name, nameReviewed: session.nameReviewed } : null);
  const keep = !!stored && !stored.nameReviewed && name === shownName;
  const finished = finishPlanetSession(editorPort, keep ? stored.name : name);
  if (!finished.ok) return { ok: false, reason: 'empty' };
  const saved = savePlanet(finished.template.name.en ?? '', finished.template, {
    ...(asCopy || session.entryId === null ? {} : { replaceEntryId: session.entryId }),
    nameReviewed: !keep,
    rimSand: finished.rimSand,
  });
  if (!saved.ok) return saved;
  stopPlanetEditing(saved.entry.entryId);
  return saved;
}
