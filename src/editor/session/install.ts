/**
 * The live editor's page-wide wiring. `prepareEditor` runs before the first render; the edition
 * root installs `installEditorSession` once and disposes it with itself, so a remount (StrictMode's
 * double effect included) tears every piece down before installing it again.
 */
import { watchBackStack } from '../back/back-out';
import { watchBackGesture } from '../../platform/input/back-gesture';
import type { GridState } from '../../core/model/types';
import { DEFAULT_MAP } from '../../config/maps';
import { useEditorStore } from '../../state/store';
import { setReducedMotion } from '../../platform/channels/motion-state';
import { osReducesMotion, watchOsReducedMotion } from '../../platform/device/os-motion';
import { resolveReducedMotion } from '../../platform/storage/prefs';
import { textVerdictKnown } from '../../state/text-verdicts';
import { versionStore } from '../../state/stylize-versions';
import { installStencilBrowser } from '../../tools/generation/stencil';
import { installSelectionViewSync } from '../../view/shared/overlay/selection-view-sync';
import { installOverlayViewSync } from '../../view/shared/overlay/overlay-view-sync';
import { DOM_STENCIL_BROWSER } from '../host/stencil-dom';
import { startRegionBrush, watchAgentRegionBrush, watchRegionOverlay } from '../editing/region-brush';
import { watchCappedArming } from '../editing/object-shelf';
import { installClipboardBridge } from '../editing/clipboard';
import {
  editorBlueprintLibrary, giveBlueprintExamples, watchArmedBlueprint, watchBlankThumbs, watchUnreviewedBlueprints,
} from '../editing/blueprint';
import { BlueprintLibraryWiped } from '../../io/storage/blueprint-library';
import { newMap } from '../operations/map';
import { reviewBlueprintText, reviewCustomTags, reviewGroupText, reviewPlanetNames } from '../review/edition-review';
import { autosave } from './autosave';
import { installDeviceWiring } from './device-wiring';
import { editorPort } from './context';
import { startEditorTools } from './editor-tools';
import { watchCurveSession } from './tool-wiring';
import { installPlanetOverlays } from './planet-overlays';
import { installRepairWatch } from './landmark-repair';
import { onSessionLibraryChange, sessionLibraryPlace, whenAssistantJobRuns } from './planet-editing';
import { whenRestoreDeclined } from './restore';
import { announceArrival } from './arrival';
import { watchUncheckedPlanetNames } from './planet-library';
import { offerTourAtStart } from './tour';

/** Resolves the motion preference against the device's own setting and publishes the effective
 *  value to the gates that cannot read the store: the canvas loops and Framer's reading
 *  (`platform/channels/motion-state.ts`) and CSS (`<html data-reduced-motion>`). */
function publishReducedMotion(): void {
  const reduced = resolveReducedMotion(useEditorStore.getState().motionPref, osReducesMotion());
  setReducedMotion(reduced);
  // Always a definitive value, never absent, so a Full override beats an OS that asks for reduce.
  if (typeof document !== 'undefined') document.documentElement.dataset.reducedMotion = reduced ? '1' : '0';
}

/** Publishes the effective reduced-motion value now and after every change of the preference or of
 *  the device's setting; returns the stop. */
export function watchReducedMotion(): () => void {
  publishReducedMotion();
  const offStore = useEditorStore.subscribe((next, previous) => { if (next.motionPref !== previous.motionPref) publishReducedMotion(); });
  const offOs = watchOsReducedMotion(publishReducedMotion);
  return () => { offStore(); offOs(); };
}

/** Readies the page before the first render: the DOM stencil browser every shelf draws stencils
 *  with, the device detectors' store mirror (page-wide, never stopped), the reduced-motion gates'
 *  first value, so no frame is drawn before it, the blueprint library's
 *  first read, its examples on a first visit and the text review of what it holds, and the first map when none is live, so the views mount over a map rather than
 *  installing one themselves. */
export function prepareEditor(): void {
  installStencilBrowser(DOM_STENCIL_BROWSER);
  installDeviceWiring();
  publishReducedMotion();
  const library = editorBlueprintLibrary();
  // A local data wipe cutting the start short is no failure; the page reloads.
  const failed = (what: string) => (err: unknown): void => { if (!(err instanceof BlueprintLibraryWiped)) console.error(`[blueprint-library] ${what} failed:`, err); };
  void library.load()
    .then(() => giveBlueprintExamples(library).catch(failed('examples')))
    .then(reviewBlueprintText).catch(failed('load'));
  if (!editorPort.live()) newMap(editorPort, DEFAULT_MAP);
}

/** What the session reads from the presentation layer and the edition. */
interface EditorSessionOptions {
  /** The planet frame flash's length, which the motion registry declares. */
  frameFlashMs: number;
  /** The edition's own part of declining the saved session (`restore.ts:declineRestoreOffer`): the
   *  assistant's session of the declined map is wiped where the edition has one. */
  onRestoreDeclined?: () => void;
  /** Whether an assistant job is working on the map, where the edition has an assistant: the planet
   *  editor does not open over one (`planet-editing.ts:whenAssistantJobRuns`). */
  assistantJobRunning?: () => boolean;
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

/** A map's placed blueprint groups have their names and original authors checked as the map arrives
 *  and as groups join it, as a copy pasted from another tab does; groups placed on this page carry
 *  text the page already showed. */
function watchGroupText(): () => void {
  const check = (map: GridState | null): void => {
    if (map?.groups?.some((g) => !textVerdictKnown(g.name) || (g.origin !== null && !textVerdictKnown(g.origin)))) void reviewGroupText();
  };
  let seen = useEditorStore.getState().gridState?.groups;
  check(useEditorStore.getState().gridState);
  // The live map's groups are replaced, never mutated, by each edit that changes them.
  return useEditorStore.subscribe((next) => {
    if (next.gridState?.groups === seen) return;
    seen = next.gridState?.groups;
    check(next.gridState);
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
 * annotations, never while a planet session holds the scratch canvas or a landmark repair is under
 * way, and not for the map a cancelled repair brings back, which the autosave already holds. The map
 * live at install, or the first one installed after none, is saved as `initialize`. The autosave is
 * held while a Show me has the map on loan (`tourBorrow`), so a try is never saved, and let go as
 * the Show me gives the map back.
 */
function installAutosaveTriggers(): () => void {
  const bus = useEditorStore.getState().eventBus;
  const save = (): void => {
    const { gridState: map, planetSession, repairSession } = useEditorStore.getState();
    if (map && !planetSession && !repairSession) autosave.schedule(map);
  };
  bus.on('cells-changed', save);
  bus.on('objects-changed', save);
  const initial = useEditorStore.getState();
  autosave.setHeld(initial.tourBorrow !== null);
  if (initial.gridState && !initial.planetSession) autosave.schedule(initial.gridState, 'initialize');
  // The live map's notes are replaced on the map itself, so the last ones seen are kept here.
  let notes = initial.gridState?.notes;
  const offStore = useEditorStore.subscribe((next, previous) => {
    if (next.tourBorrow !== previous.tourBorrow) autosave.setHeld(next.tourBorrow !== null);
    const notesChanged = next.gridState?.notes !== notes;
    notes = next.gridState?.notes;
    if (!next.gridState || next.planetSession || next.repairSession) return;
    const was = previous.repairSession;
    if (was?.phase === 'hand' && next.gridState === was.cancelTo?.gridState) return;
    if (next.gridState !== previous.gridState || next.annotationsEpoch !== previous.annotationsEpoch || notesChanged) {
      if (previous.gridState) autosave.schedule(next.gridState);
      else autosave.schedule(next.gridState, 'initialize');
    }
  });
  return () => { bus.off('cells-changed', save); bus.off('objects-changed', save); offStore(); autosave.setHeld(false); };
}

/** The map whose opening the session announced; a session installed again over it announces none. */
let bootAnnouncedFor: GridState | null = null;

/** Announces the map the session is installed over as an arrival, as soon as there is one. Later maps
 *  announce themselves where they open: a planet switch and a restore do, a file opened does not.
 *  Returns the stop. */
function announceBootArrival(): () => void {
  const announce = (): boolean => {
    const map = useEditorStore.getState().gridState;
    if (!map) return false;
    if (map !== bootAnnouncedFor) {
      bootAnnouncedFor = map;
      announceArrival({ kind: 'boot' });
    }
    return true;
  };
  if (announce()) return () => {};
  const off = useEditorStore.subscribe(() => { if (announce()) off(); });
  return off;
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
 * Installs the editor around the live map: the reduced-motion gates' value, the session's tools, what
 * closes an open curve and where its footprint draws, the selection and region view
 * syncs, the background checks of a map's custom tags, the session planet's name and the blueprints the
 * library stores unreviewed, the autosave triggers, the clipboard's page listeners, the disarming of a
 * blueprint the library lost and the redrawing of its blank pictures, the region brush and its overlay,
 * the release of the assistant's brush as its panel closes,
 * the planet session's overlays, the retirement of illustration takes a map edit made stale, open
 * window or not, and the back stack's reading of the editor's states from the start, so it holds
 * them in the order they were entered, with Android's back answering it. The visit's offer of the
 * welcome tips is made first, before anything here writes the autosave it reads. Returns the stop,
 * which removes them in reverse order.
 */
export function installEditorSession({ frameFlashMs, onRestoreDeclined, assistantJobRunning }: EditorSessionOptions): () => void {
  offerTourAtStart();
  const stops = [
    announceBootArrival(),
    watchReducedMotion(),
    onRestoreDeclined ? whenRestoreDeclined(onRestoreDeclined) : () => {},
    assistantJobRunning ? whenAssistantJobRuns(assistantJobRunning) : () => {},
    startEditorTools(),
    watchCurveSession(),
    watchRegionBrush(),
    watchRegionOverlay(),
    watchAgentRegionBrush(),
    watchCappedArming(),
    installPlanetOverlays(frameFlashMs),
    installRepairWatch(),
    installSelectionViewSync(),
    watchCustomTags(),
    watchGroupText(),
    watchSessionPlanetName(),
    watchUncheckedPlanetNames(() => { void reviewPlanetNames(); }),
    installOverlayViewSync(),
    installAutosaveTriggers(),
    installClipboardBridge(),
    watchArmedBlueprint(),
    watchUnreviewedBlueprints(() => { void reviewBlueprintText(); }),
    watchBlankThumbs(),
    versionStore.bindMapEvents(useEditorStore.getState().eventBus),
    watchBackStack(),
    watchBackGesture(),
  ];
  return () => { for (const stop of stops.reverse()) stop(); };
}
