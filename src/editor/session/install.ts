/**
 * The live editor's page-wide wiring. `prepareEditor` runs before the first render; the edition
 * root installs `installEditorSession` once and disposes it with itself, so a remount (StrictMode's
 * double effect included) tears every piece down before installing it again.
 */
import type { GridState } from '../../core/model/types';
import { DEFAULT_MAP } from '../../config/maps';
import { useEditorStore } from '../../state/store';
import { textVerdictKnown } from '../../state/text-verdicts';
import { versionStore } from '../../state/stylize-versions';
import { installStencilBrowser } from '../../tools/generation/stencil';
import { installSelectionViewSync } from '../../view/shared/overlay/selection-view-sync';
import { installOverlayViewSync } from '../../view/shared/overlay/overlay-view-sync';
import { DOM_STENCIL_BROWSER } from '../host/stencil-dom';
import { startRegionBrush } from '../editing/region-brush';
import { newMap } from '../operations/map';
import { reviewCustomTags, reviewPlanetNames } from '../review/edition-review';
import { autosave } from './autosave';
import { editorPort } from './context';
import { startEditorTools } from './editor-tools';
import { installPlanetOverlays } from './planet-overlays';
import { onSessionLibraryChange, sessionLibraryPlace } from './planet-editing';

/** Readies the page before the first render: the DOM stencil browser every shelf draws stencils
 *  with, and the first map when none is live, so the views mount over a map rather than installing
 *  one themselves. */
export function prepareEditor(): void {
  installStencilBrowser(DOM_STENCIL_BROWSER);
  if (!editorPort.live()) newMap(editorPort, DEFAULT_MAP);
}

/** What the session reads from the presentation layer. */
export interface EditorSessionOptions {
  /** The planet frame flash's length, which the motion registry declares. */
  frameFlashMs: number;
}

/** A map's custom tags are checked as the map arrives and as tags join it; only approved text is drawn. */
function watchCustomTags(): () => void {
  const check = (map: GridState | null): void => {
    if (map?.annotations?.customTags?.some((t) => !textVerdictKnown(t.text))) void reviewCustomTags();
  };
  check(useEditorStore.getState().gridState);
  return useEditorStore.subscribe((next, previous) => {
    if (next.gridState !== previous.gridState || next.annotationsEpoch !== previous.annotationsEpoch) check(next.gridState);
  });
}

/** While a planet session edits a library entry whose name has not passed the text check, the
 *  check runs as the entry becomes pending and after each library write, as the nameplate showed it. */
function watchSessionPlanetName(): () => void {
  let pending = false;
  const check = (libraryWrite: boolean): void => {
    const session = useEditorStore.getState().planetSession;
    const was = pending;
    pending = !!session && sessionLibraryPlace().entry?.nameReviewed === false;
    if (pending && (libraryWrite || !was)) void reviewPlanetNames();
  };
  const offStore = useEditorStore.subscribe((next, previous) => { if (next.planetSession !== previous.planetSession) check(false); });
  const offLibrary = onSessionLibraryChange(() => check(true));
  check(false);
  return () => { offStore(); offLibrary(); };
}

/**
 * Schedules an autosave after every map edit and every change of the map, its notes or its
 * annotations, never while a planet session holds the scratch canvas. The map live at install, or
 * the first one installed after none, is saved as `initialize`.
 */
function installAutosaveTriggers(): () => void {
  const bus = useEditorStore.getState().eventBus;
  const save = (): void => {
    const { gridState: map, planetSession } = useEditorStore.getState();
    if (map && !planetSession) autosave.schedule(map);
  };
  bus.on('cells-changed', save);
  bus.on('objects-changed', save);
  const initial = useEditorStore.getState();
  if (initial.gridState && !initial.planetSession) autosave.schedule(initial.gridState, 'initialize');
  // The live map's notes are replaced on the map itself, so the last ones seen are kept here.
  let notes = initial.gridState?.notes;
  const offStore = useEditorStore.subscribe((next, previous) => {
    const notesChanged = next.gridState?.notes !== notes;
    notes = next.gridState?.notes;
    if (!next.gridState || next.planetSession) return;
    if (next.gridState !== previous.gridState || next.annotationsEpoch !== previous.annotationsEpoch || notesChanged) {
      if (previous.gridState) autosave.schedule(next.gridState);
      else autosave.schedule(next.gridState, 'initialize');
    }
  });
  return () => { bus.off('cells-changed', save); bus.off('objects-changed', save); offStore(); };
}

/** The region brush collects strokes for as long as region selection is on, wherever the control that arms it lives. */
function watchRegionBrush(): () => void {
  let stop: (() => void) | null = null;
  let starting = false;
  const sync = (): void => {
    const on = useEditorStore.getState().selectingRegion;
    if (on && !stop && !starting) {
      // A store write made while the brush starts reaches this listener again before `stop` is set.
      starting = true;
      try { stop = startRegionBrush(); } finally { starting = false; }
    } else if (!on && stop) { const done = stop; stop = null; done(); }
  };
  const off = useEditorStore.subscribe(sync);
  sync();
  return () => { off(); stop?.(); stop = null; };
}

/**
 * Installs the editor around the live map: the session's tools, the selection and region view
 * syncs, the background checks of a map's custom tags and the session planet's name, the autosave
 * triggers, the region brush, the planet session's overlays, and the retirement of illustration
 * takes a map edit made stale, open window or not. Returns the stop, which removes them in reverse
 * order.
 */
export function installEditorSession({ frameFlashMs }: EditorSessionOptions): () => void {
  const stops = [
    startEditorTools(),
    watchRegionBrush(),
    installPlanetOverlays(frameFlashMs),
    installSelectionViewSync(),
    watchCustomTags(),
    watchSessionPlanetName(),
    installOverlayViewSync(),
    installAutosaveTriggers(),
    versionStore.bindMapEvents(useEditorStore.getState().eventBus),
  ];
  return () => { for (const stop of stops.reverse()) stop(); };
}
