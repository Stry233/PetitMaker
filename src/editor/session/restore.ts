/**
 * Resuming the session this browser saved: the offer the live shell stands as it mounts and every
 * way of declining it, the visitor setting to work, which declines it (a surface they chose, as ui
 * publishes, or their first edit), the clock after which the offer on screen resumes by itself, and
 * the restore, which announces its arrival and reports itself to whoever keeps something with the map.
 */
import { readRestorableAutosave, type RestoredAutosave } from '../../io/storage/autosave';
import { createSignal } from '../../core/base/signal';
import { adoptInstalledPlanet } from '../../io/storage/planet-library';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { useEditorStore } from '../../state/store';
import { host } from '../host/host';
import { loadMap } from '../operations/map';
import { watchUndoDepth } from '../operations/undo-depth';
import { editorPort } from './context';
import { openThroughRepair } from './landmark-repair';
import { saveFileName } from '../export/json-export';
import { announceArrival } from './arrival';
import type { LoadedOriginal } from '../../state/slices/repair-session';

/** The page's one standing offer, null once declined or taken. */
let offer: RestoredAutosave | null = null;
const offerMoved = createSignal();
/** The edition's own part of a decline: the assistant's session of the declined map goes with it. */
let onDeclined: (() => void) | null = null;

/** Ends the standing offer's watch for the visitor setting to work. */
let stopEngagedWatch = (): void => {};

/** Sets the page's offer and starts or ends what stands with it: its clock, whole again for a new
 *  offer, and the watch that declines it once the visitor sets to work. */
function setOffer(next: RestoredAutosave | null): void {
  offer = next;
  stopEngagedWatch();
  stopEngagedWatch = () => {};
  settleDeadline(next !== null);
  offerMoved.emit();
  if (next) stopEngagedWatch = watchVisitorEngaged(declineRestoreOffer);
}

/** Stands the saved session as the page's offer, read now: the live shell does as it mounts, and a
 *  save written later is this session's own. */
export function standRestoreOffer(): RestoredAutosave | null {
  setOffer(readRestorableAutosave());
  return offer;
}

/** The standing offer, or null. */
export function restoreOffer(): RestoredAutosave | null {
  return offer;
}

export function subscribeRestoreOffer(listener: () => void): () => void {
  return offerMoved.subscribe(listener);
}

/** Declines the standing offer, as Start fresh, the arrival notice's answers, a handed file and the
 *  visitor setting to work all do: the saved session is let go, with the assistant's session of its
 *  map. Nothing when none stands, so a caller never asks whether one does. */
export function declineRestoreOffer(): void {
  if (!offer) return;
  onDeclined?.();
  setOffer(null);
}

/** Takes the standing offer to restore it (`restoreSession`); null when none stands. */
function takeRestoreOffer(): RestoredAutosave | null {
  const taken = offer;
  if (!taken) return null;
  setOffer(null);
  return taken;
}

/** What covers the map as a restore lands: the edition root's fade. */
let beforeRestore: (() => void) | null = null;

/** Registers what runs just before a restore replaces the map, page-wide; returns its release. */
export function whenRestoreBegins(run: () => void): () => void {
  beforeRestore = run;
  return () => { if (beforeRestore === run) beforeRestore = null; };
}

/** Resumes the saved session on offer, as Resume and the offer's own clock do: the offer is taken,
 *  the map is covered (`whenRestoreBegins`) and the session restored. False when no offer stands. */
export function acceptRestoreOffer(): boolean {
  const taken = takeRestoreOffer();
  if (!taken) return false;
  beforeRestore?.();
  restoreSession(taken);
  return true;
}

/** Registers the edition's own part of a decline, page-wide; returns its release. */
export function whenRestoreDeclined(run: () => void): () => void {
  onDeclined = run;
  return () => { if (onDeclined === run) onDeclined = null; };
}

/** Tests only: stands `next` as the offer without reading the autosave. */
export function __setRestoreOffer(next: RestoredAutosave | null): void {
  setOffer(next);
}

/** How long the offer stands on screen before it resumes by itself, in ms. */
export const RESTORE_AFTER_MS = 12_000;

/** How often a running clock is read again for its surface, in ms: a surface that steps instead of
 *  gliding steps at this rate. */
const DEADLINE_BEAT_MS = 1000;

/** The offer's clock as its surface draws it. */
interface RestoreDeadline {
  /** How much of `RESTORE_AFTER_MS` is spent as of this reading, in ms. */
  spentMs: number;
  /** The clock runs: the offer is on screen and nothing holds it. */
  running: boolean;
  /** Keyboard focus reached the control that carries the clock, so the offer no longer resumes by itself. */
  stopped: boolean;
}

let deadline: RestoreDeadline = { spentMs: 0, running: false, stopped: false };
const deadlineMoved = createSignal();
/** Whether the offer's surface is on screen, and whether something there holds its clock. */
let onScreen = false;
let held = false;
/** When the running clock was last read, in epoch ms, and its two timers. */
let readAt = 0;
let expiry: ReturnType<typeof setTimeout> | null = null;
let beat: ReturnType<typeof setTimeout> | null = null;

/** Reads the clock now, whole and unstopped again where `afresh`, and starts or stops it by what
 *  stands: an offer, on screen, not held, not stopped. */
function settleDeadline(afresh = false, stopped = !afresh && deadline.stopped): void {
  const now = Date.now();
  const spentMs = afresh ? 0 : deadline.running ? Math.min(RESTORE_AFTER_MS, deadline.spentMs + now - readAt) : deadline.spentMs;
  const running = offer !== null && onScreen && !held && !stopped;
  if (expiry !== null) clearTimeout(expiry);
  if (beat !== null) clearTimeout(beat);
  expiry = beat = null;
  readAt = now;
  if (running) {
    expiry = setTimeout(acceptRestoreOffer, RESTORE_AFTER_MS - spentMs);
    beat = setTimeout(() => settleDeadline(), DEADLINE_BEAT_MS);
  }
  if (spentMs === deadline.spentMs && running === deadline.running && stopped === deadline.stopped) return;
  deadline = { spentMs, running, stopped };
  deadlineMoved.emit();
}

/** The offer's clock, the same object until it moves. */
export function restoreDeadline(): RestoreDeadline {
  return deadline;
}

export function subscribeRestoreDeadline(listener: () => void): () => void {
  return deadlineMoved.subscribe(listener);
}

/** The offer's surface came on screen, held from the start where `heldNow` (`holdRestoreDeadline`):
 *  its clock starts whole, as each showing gives the visitor the full wait. Returns what its leaving
 *  calls, which stops the clock where it stands. */
export function showRestoreDeadline(heldNow = false): () => void {
  onScreen = true;
  held = heldNow;
  settleDeadline(true);
  return () => { onScreen = false; settleDeadline(); };
}

/** Holds the clock while something on the offer's surface says the visitor is reading it or cannot
 *  see it: the pointer rests on it, focus is on one of its answers, the boot splash covers it or it
 *  is leaving. */
export function holdRestoreDeadline(on: boolean): void {
  if (held === on) return;
  held = on;
  settleDeadline();
}

/** Keyboard focus reached the control that carries the clock: the offer waits for an answer from
 *  then on. */
export function stopRestoreDeadline(): void {
  if (!deadline.stopped) settleDeadline(false, true);
}

const chosenSurfaces = createSignal(false);

/** ui's half of the visitor setting to work: whether a surface they chose (a mode, the menu, the
 *  assistant, any window but What's new) stands open, as `state/greetings.ts:shellEngagedIn` reads it. */
export function publishChosenSurfaces(open: boolean): void {
  if (chosenSurfaces.get() !== open) chosenSurfaces.emit(open);
}

/** Whether a surface the visitor chose stands open now. */
export function chosenSurfacesOpen(): boolean {
  return chosenSurfaces.get();
}

export function subscribeChosenSurfaces(listener: () => void): () => void {
  return chosenSurfaces.subscribe(() => listener());
}

/** Calls `onEngaged` once, when the visitor has set to work: a surface they chose stands open, now
 *  or later, or their first edit since this watch began (`watchFirstEdit`). The greetings of a visit
 *  give way to it alike. Returns the stop. */
export function watchVisitorEngaged(onEngaged: () => void): () => void {
  let done = false;
  let stop = (): void => {};
  const engaged = (): void => {
    if (done) return;
    done = true;
    stop();
    onEngaged();
  };
  const offEdit = watchFirstEdit(engaged);
  const offSurfaces = chosenSurfaces.subscribe((open) => { if (open) engaged(); });
  stop = () => { offEdit(); offSurfaces(); };
  if (chosenSurfaces.get()) engaged();
  return () => { done = true; stop(); };
}


/** Calls `onEdit` once the visitor's own work reaches the live map: its undo stack grew past the
 *  depth it had when watched, which opening a map never does. Follows the executor a map change
 *  installs; returns the stop. */
function watchFirstEdit(onEdit: () => void): () => void {
  let executor: CommandExecutor | null = null;
  let off = (): void => {};
  const bind = (): void => {
    const s = useEditorStore.getState();
    if (s.commandExecutor === executor) return;
    off();
    off = () => {};
    executor = s.commandExecutor;
    if (!executor) return;
    const base = executor.historyDepth();
    off = watchUndoDepth(s.eventBus, executor, (depth) => { if (depth > base) onEdit(); });
  };
  const offStore = useEditorStore.subscribe(bind);
  bind();
  return () => { offStore(); off(); };
}

const restored = createSignal();

/** Calls `listener` after each restore installed its map, for whatever is kept with the map (the
 *  assistant's session of it); returns the stop. */
export function onSessionRestored(listener: () => void): () => void {
  return restored.subscribe(() => listener());
}

/** Restores `save` over the live map: the map with its planet adopted into the library, its undo
 *  history and its parked camera, then reports the restore (`onSessionRestored`) and announces the
 *  arrival; through the landmark repair's gate, so a load that changed what stood under a landmark
 *  waits for the visitor's choice and may never install. */
export function restoreSession(save: RestoredAutosave): void {
  const original: LoadedOriginal = save.source !== undefined
    ? { kind: 'file', file: new Blob([save.source], { type: 'application/json' }), name: saveFileName(save.state, useEditorStore.getState().locale), format: 'json' }
    : { kind: 'map', state: save.state };
  openThroughRepair(save.cleared?.report, save.state, () => {
    loadMap(editorPort, save.state);
    adoptInstalledPlanet(save.state);
    if (save.history?.length) useEditorStore.getState().commandExecutor?.restoreHistory(save.history);
    host.camera.queue(save.camera ?? null);
    restored.emit();
    announceArrival({ kind: 'restored' });
  }, original);
}
