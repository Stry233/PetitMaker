/**
 * The planet session with persistence around it: the map being parked has its pending autosave
 * written first, autosave stays off while the scratch canvas is live, and finishing saves the
 * planet to the library before the parked map comes back.
 */
import { flushAutosave, setAutosaveSuspended } from '../../../io/autosave';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
import {
  defaultPlanetName, listPlanets, onPlanetLibraryChange, planetLibraryVersion, savePlanet, shownEntryName, type PlanetEntry,
} from '../../../io/planet-library';
import { reviewPlanetNames } from '../../chrome/modals/export/edition-export';
import { enterPlanetSession, finishPlanetSession, leavePlanetSession, type PlanetDraft } from '../../../kit/operations/planet-session';
import { host } from '../../../kit/host';
import { assistantJobRunning, useAssistantJobRunning } from '../edition-surfaces';
import { useEditorStore, type EditorStore } from '../../../state/store';

type FinishPlanetResult = { ok: true; entry: PlanetEntry } | { ok: false; reason: 'quota' | 'empty' };

/**
 * Whether a planet session may open over the current map: there is a map, no session is open, the
 * tour is not running, no assistant job is working on the map and no annotation draft is waiting
 * for its answer.
 */
export function canStartPlanetEditing(
  state: Pick<EditorStore, 'gridState' | 'planetSession' | 'annotationDraft' | 'tourRunning'>,
  jobRunning: boolean = assistantJobRunning(),
): boolean {
  return !!state.gridState && !state.planetSession && !state.annotationDraft && !state.tourRunning && !jobRunning;
}

/** `canStartPlanetEditing` for the live editor, updating as the store and the assistant job change. */
export function useCanStartPlanetEditing(): boolean {
  const jobRunning = useAssistantJobRunning();
  return useEditorStore((s) => canStartPlanetEditing(s, jobRunning));
}

/** The stored library entry the session edits, as it stands now; null for a new planet or one since removed. */
function sessionEntry(entryId: string | null): PlanetEntry | null {
  return entryId === null ? null : listPlanets().find((e) => e.entryId === entryId) ?? null;
}

/**
 * The session planet's name as shown: the edited entry's name once it has passed the text check,
 * otherwise its default name; for a new planet the next free default name.
 */
export function sessionPlanetName(): string {
  const { planetSession: session, locale } = useEditorStore.getState();
  const entries = listPlanets();
  const live = sessionEntry(session?.entryId ?? null);
  if (live) return shownEntryName(live, entries.indexOf(live), locale);
  return session?.nameReviewed && session.name.trim() ? session.name : defaultPlanetName(locale, entries.length);
}

/** `sessionPlanetName` for the nameplate: follows the locale, the library and the background name check, and starts the check the name still needs. */
export function useSessionPlanetName(): string {
  const locale = useEditorStore((s) => s.locale);
  const session = useEditorStore((s) => s.planetSession);
  const version = useSyncExternalStore(onPlanetLibraryChange, planetLibraryVersion);
  const name = useMemo(() => sessionPlanetName(), [locale, session, version]); // eslint-disable-line react-hooks/exhaustive-deps -- the name reads these through the store and the library
  const pending = sessionEntry(session?.entryId ?? null)?.nameReviewed === false;
  useEffect(() => { if (pending) void reviewPlanetNames(); }, [pending, version]);
  return name;
}

/**
 * Opens `source` over the current map: a saved entry, a draft as a new planet (one read from a
 * scan), or a blank new planet when null. The stored entry is opened, whatever name it was shown under.
 */
export function startPlanetEditing(source: PlanetEntry | PlanetDraft | null): void {
  if (!canStartPlanetEditing(useEditorStore.getState())) return;
  flushAutosave();
  setAutosaveSuspended(true);
  try {
    const view2d = host.camera.get2d();
    const view3d = host.camera.get3d();
    const opened = source && 'entryId' in source ? sessionEntry(source.entryId) ?? source : source;
    enterPlanetSession(opened, {
      ...(view2d ? { view2d } : {}), ...(view3d ? { view3d } : {}),
    });
  } finally {
    // With no session open (no map to park, or entry failed) autosave carries on.
    if (!useEditorStore.getState().planetSession) setAutosaveSuspended(false);
  }
}

/** Leaves without saving the planet. */
export function stopPlanetEditing(): void {
  const session = useEditorStore.getState().planetSession;
  try {
    const cameras = leavePlanetSession();
    if (session) host.camera.queue(cameras);
  } finally {
    setAutosaveSuspended(false);
  }
  if (session) useEditorStore.getState().setPlanetReturn({ chosen: session.entryId });
}

/**
 * Saves the planet as `name`, replacing the entry being edited unless `asCopy`, then leaves.
 * A name still awaiting the text check, left as the default name it is shown under, is saved as it
 * was stored and stays unchecked; only a name the visitor gave replaces it. A failed save keeps the
 * session open so nothing drawn is lost.
 */
export function finishPlanetEditing(name: string, asCopy: boolean): FinishPlanetResult {
  const session = useEditorStore.getState().planetSession;
  if (!session) return { ok: false, reason: 'empty' };
  const live = sessionEntry(session.entryId);
  const stored = live ?? (session.entryId !== null ? { name: session.name, nameReviewed: session.nameReviewed } : null);
  const keep = !!stored && !stored.nameReviewed && name === sessionPlanetName();
  const finished = finishPlanetSession(keep ? stored.name : name);
  if (!finished.ok) return { ok: false, reason: 'empty' };
  const saved = savePlanet(finished.template.name.en ?? '', finished.template, {
    ...(asCopy || session.entryId === null ? {} : { replaceEntryId: session.entryId }),
    nameReviewed: !keep,
    rimSand: finished.rimSand,
  });
  if (!saved.ok) return saved;
  stopPlanetEditing();
  useEditorStore.getState().setPlanetReturn({ chosen: saved.entry.entryId });
  return saved;
}
