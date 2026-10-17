/**
 * The one gate every map load passes when its compatibility report changes the visitor's map
 * (`state/landmark-clearance.ts:CompatibilityReport`): the choice is asked over the map that is open,
 * which nothing touches until the visitor chooses. Repair automatically opens the decoded map and
 * lands the report's plan as one undo step; by hand opens it with the objects where the save had them
 * and lets the visitor move or delete each until none stands against the rules. Cancel, in the
 * choice or in the hand repair, leaves (or brings back) the map that was open, with its history,
 * cameras and autosave as they were.
 */
import { bumpObjectsVersion, cloneGridState, clonePlacedObject } from '../../core/model/grid-model';
import { objectRect } from '../../state/object-geometry';
import { onMapEdited } from '../../core/commands/map-edits';
import type { GridState, PlacedObject } from '../../core/model/types';
import type { GridCellRef } from '../../core/grid/grids';
import { TERRAIN_GRID } from '../../core/game/profile';
import { persistedCamera } from '../../io/save/camera';
import { createDefaultRegistry } from '../../rules';
import type { CompatibilityReport } from '../../state/landmark-clearance';
import { applyRelocation, isLegalMap, planRelocation, unresolved, type RelocationResult } from '../../state/relocation-plan';
import { repairRules } from '../../state/repair-rules';
import type { LoadedOriginal, RepairSession } from '../../state/slices/repair-session';
import { batchStore, useEditorStore } from '../../state/store';
import { coalesceToFrame } from '../../platform/async/after-paint';
import { host } from '../host/host';
import { onActiveViewChange } from '../../view/active-view';
import { forgetGenerationScope } from '../operations/generate';
import { downloadOriginal } from '../export/json-export';
import { autosave } from './autosave';
import { installLoadedMap, parkLiveEditor, restoreParkedMap } from './context';

const NONE: ReadonlySet<string> = new Set();

/** The report's object ids, in report order. */
const reportIds = (report: CompatibilityReport): string[] => report.objects.map((o) => o.object.id);

/** Cells of air the repair's pictures keep around what they show. */
const PREVIEW_MARGIN = 8;

/** The repair's two pictures of `state`: as the plan lands it (`auto`), and as a hand repair opens
 *  it, with the objects where the save had them (`hand`), both framed on the landmarks, objects and
 *  terrain involved (`fit`, cells, `x1` and `y1` exclusive). Each picture's flagged objects are what
 *  the live map would flag (`flaggedObjects`): in `handFlagged`, those a hand repair starts with; in
 *  `autoFlagged`, the objects the plan removes, where the save had them, and any it lands that would
 *  still stand against the rules. `ground` is the terrain cells whose own terrain the repair changes.
 *  Detached copies that share `state`'s notes; `state` is not changed. */
export interface RepairPreviews {
  auto: GridState;
  hand: GridState;
  autoFlagged: PlacedObject[];
  handFlagged: PlacedObject[];
  ground: GridCellRef[];
  fit: { x0: number; y0: number; x1: number; y1: number };
}

/** The objects among `ids` that `state` holds against the rules (`relocation-plan.ts:unresolved`),
 *  which a hand repair flags and leaves to take presses: the one reading of what is drawn flagged,
 *  on the live map and in the repair's pictures alike. */
function flaggedObjects(state: GridState, ids: Iterable<string>): PlacedObject[] {
  return unresolved(state, createDefaultRegistry(), ids).map((id) => state.objects.get(id)!);
}

/** The objects a hand repair answers for on `state`: the report's, in report order, then every other
 *  unlocked object, since the repair ends only on a map the rules accept whole. */
function handIds(state: GridState, report: CompatibilityReport): string[] {
  const ids = reportIds(report);
  const inReport = new Set(ids);
  for (const o of state.objects.values()) if (!o.locked && !inReport.has(o.id)) ids.push(o.id);
  return ids;
}

/** Puts the report's objects back on `state` where the save had them, as a hand repair opens the
 *  map; one already on it stays. Returns those put back. */
function putBackSaved(state: GridState, report: CompatibilityReport): PlacedObject[] {
  const back = report.objects.map((o) => clonePlacedObject(o.object)).filter((o) => !state.objects.has(o.id));
  for (const o of back) state.objects.set(o.id, o);
  bumpObjectsVersion(state, { added: back });
  return back;
}

export function repairPreviews(state: GridState, report: CompatibilityReport): RepairPreviews {
  const auto = cloneGridState(state), hand = cloneGridState(state);
  // Either choice opens the loaded map with its notes, so both pictures draw them.
  if (state.annotations) auto.annotations = hand.annotations = state.annotations;
  const landed = report.plan.moves.flatMap((m) => (m.proposal.kind === 'no-place' ? [] : [clonePlacedObject(m.proposal.to)]));
  for (const o of landed) auto.objects.set(o.id, o);
  bumpObjectsVersion(auto, { added: landed });
  putBackSaved(hand, report);
  const lost = new Set(report.plan.moves.filter((m) => m.proposal.kind === 'no-place').map((m) => m.id));
  const autoFlagged = [
    ...report.objects.filter((o) => lost.has(o.object.id)).map((o) => clonePlacedObject(o.object)),
    ...flaggedObjects(auto, landed.map((o) => o.id)),
  ];
  const handFlagged = flaggedObjects(hand, handIds(hand, report));
  const ground = report.terrain.filter((t) => t.before !== null).map(({ x, y }): GridCellRef => ({ x, y, grid: TERRAIN_GRID }));
  const rects = [
    ...report.landmarks.map((l) => ({ x: l.now.x, y: l.now.y, w: l.now.width, h: l.now.height })),
    ...[...report.objects.map((o) => o.object), ...landed].map((o) => objectRect(o)),
    ...ground.map(({ x, y }) => ({ x, y, w: 1, h: 1 })),
  ];
  const fit = {
    x0: Math.floor(Math.min(...rects.map((r) => r.x))) - PREVIEW_MARGIN,
    y0: Math.floor(Math.min(...rects.map((r) => r.y))) - PREVIEW_MARGIN,
    x1: Math.ceil(Math.max(...rects.map((r) => r.x + r.w))) + PREVIEW_MARGIN,
    y1: Math.ceil(Math.max(...rects.map((r) => r.y + r.h))) + PREVIEW_MARGIN,
  };
  return { auto, hand, autoFlagged, handFlagged, ground, fit };
}

/** Whether a load's report changes the visitor's map: objects to move or remove, or terrain of the
 *  map's own that the repair changes. The repair is asked only then; ground a template lays under a
 *  landmark where the save held none comes back silently, since it takes nothing away. */
export function asksRepair(report: CompatibilityReport | undefined): report is CompatibilityReport {
  return !!report && (report.objects.length > 0 || report.terrain.some((t) => t.before !== null));
}


/**
 * Opens a decoded map, `pending`, through `install`: at once when its report changes nothing of the
 * visitor's, else after the visitor's choice, asked over the open map, which stays untouched until
 * then. `install` opens `pending` with whatever travels with it and reports the import; `original` is
 * the map as the load brought it, which Export first downloads while the choice is asked.
 */
export function openThroughRepair(report: CompatibilityReport | undefined, pending: GridState, install: () => void, original: LoadedOriginal): void {
  if (!asksRepair(report)) { install(); return; }
  if (!useEditorStore.getState().gridState) {
    install();
    applyPlan(report);
    return;
  }
  batchStore(() => {
    const store = useEditorStore.getState();
    store.setRepairSession({ phase: 'choose', report, pending, install, original });
    store.setModal('landmarkRepair', true);
  });
}

/** The live map with `report`'s plan landed on it as one undo step. */
function applyPlan(report: CompatibilityReport): RelocationResult | null {
  const { gridState: state, commandExecutor: ex } = useEditorStore.getState();
  if (!state || !ex) return null;
  const result = applyRelocation(ex, state, report.plan);
  autosave.schedule(state);
  return result;
}

/** Downloads the asked map as the load brought it, before any repair, and leaves the choice open:
 *  the open map, its history and its exported mark stay as they are. Whether a file was written. */
export function exportUnrepaired(): boolean {
  const session = useEditorStore.getState().repairSession;
  return session?.phase === 'choose' ? downloadOriginal(session.original) : false;
}

/** Which notice Export first reads before the download: the image's for a picture opened as it came. */
export function unrepairedFormat(session: RepairSession | null): 'json' | 'image' {
  return session?.phase === 'choose' && session.original.kind === 'file' ? session.original.format : 'json';
}

/** Opens the asked map and lands its plan as one undo step: what the choice's picture showed. */
export function repairAutomatically(): RelocationResult | null {
  const session = useEditorStore.getState().repairSession;
  if (session?.phase !== 'choose') return null;
  endRepair();
  session.install();
  return applyPlan(session.report);
}

/**
 * Puts the report's objects back where the save had them and opens the map under the repair's rules
 * (`state/repair-rules.ts`), at rest, where only those objects take presses.
 */
export function repairByHand(): void {
  const session = useEditorStore.getState().repairSession;
  if (session?.phase !== 'choose') return;
  const cancelTo = parkLiveEditor(host.camera.get2d() ?? null, host.camera.get3d() ?? null);
  // Installed while the session still asks, so autosave holds still from here to the end.
  session.install();
  const state = useEditorStore.getState().gridState;
  if (!state) return;
  const ids = new Set(reportIds(session.report));
  putBackSaved(state, session.report);
  state.unsettled = ids;
  batchStore(() => {
    const store = useEditorStore.getState();
    store.loadMap(state, repairRules(createDefaultRegistry(), () => state.unsettled ?? NONE));
    forgetGenerationScope(state);
    store.setRepairSession({ phase: 'hand', report: session.report, cancelTo, left: [...ids] });
    store.setEditMode({ mode: null });
    store.setModal('landmarkRepair', false);
  });
  refreshLeft();
}

/** Plans the objects a hand repair still has and lands them, as one undo step, with the automatic
 *  repair's closing check (`applyRelocation`). */
export function repairTheRest(): RelocationResult | null {
  const { repairSession: session, gridState: state, commandExecutor: ex } = useEditorStore.getState();
  if (!session || session.phase !== 'hand' || !state || !ex) return null;
  const shifts = new Map(session.report.objects.map((o) => [o.object.id, o.shift]));
  const items = session.left.filter((id) => state.objects.has(id))
    .map((id) => ({ object: state.objects.get(id)!, shift: shifts.get(id) ?? { x: 0, y: 0 } }));
  const result = applyRelocation(ex, state, planRelocation(state, createDefaultRegistry(), items));
  refreshLeft();
  return result;
}

/** Ends a hand repair once nothing stands against the rules (`isLegalMap`): the map reopens under
 *  its ordinary rules with a fresh history, as a map just opened. False while anything is left. */
export function finishRepair(): boolean {
  const { repairSession: session, gridState: state } = useEditorStore.getState();
  if (!session || session.phase !== 'hand' || !state || session.left.length > 0) return false;
  if (!isLegalMap(state, createDefaultRegistry())) { refreshLeft(); return false; }
  delete state.unsettled;
  batchStore(() => {
    installLoadedMap(state, createDefaultRegistry());
    forgetGenerationScope(state);
    endRepair();
  });
  autosave.schedule(state);
  return true;
}

/** Leaves the map that was open as it was: while the choice is asked nothing was opened, and a hand
 *  repair brings back the map that was open before it, with its own history and cameras. */
export function cancelRepair(): void {
  const session = useEditorStore.getState().repairSession;
  if (!session) return;
  if (session.phase === 'choose' || !session.cancelTo) { endRepair(); return; }
  const { cancelTo } = session;
  const state = useEditorStore.getState().gridState;
  if (state) delete state.unsettled;
  batchStore(() => {
    restoreParkedMap(cancelTo);
    endRepair();
  });
  host.camera.queue(persistedCamera(cancelTo.camera2d ?? undefined, cancelTo.camera3d ?? undefined) ?? null);
}

function endRepair(): void {
  batchStore(() => {
    const store = useEditorStore.getState();
    store.setRepairSession(null);
    store.setModal('landmarkRepair', false);
  });
}

/** Re-reads which objects still stand against the rules, the report's first and then any other the
 *  hand repair's moves left refused: only those take presses and are drawn flagged. */
function refreshLeft(): void {
  const { repairSession: session, gridState: state } = useEditorStore.getState();
  if (!session || session.phase !== 'hand' || !state) return;
  const flagged = flaggedObjects(state, handIds(state, session.report));
  const left = flagged.map((o) => o.id);
  state.unsettled = new Set(left);
  if (left.length !== session.left.length || left.some((id, i) => id !== session.left[i])) {
    useEditorStore.getState().setRepairSession({ ...session, left });
  }
  host.flagged.show(flagged.length > 0 ? flagged : null);
}

/** The session's objects left to repair, as `refreshLeft` last read them. */
function drawLeft(state: GridState, left: readonly string[]): void {
  host.flagged.show(left.length > 0 ? left.map((id) => state.objects.get(id)!) : null);
}

/** Keeps the hand repair's count and flags current for as long as the editor lives; returns the stop. */
export function installRepairWatch(): () => void {
  const store = useEditorStore;
  let shown: Extract<RepairSession, { phase: 'hand' }> | null = null;
  const coalesced = coalesceToFrame(refreshLeft);
  const sync = (): void => {
    const session = store.getState().repairSession;
    const hand = session?.phase === 'hand' ? session : null;
    if (hand === shown) return;
    if (!hand) host.flagged.show(null);
    else if (shown === null || hand.left !== shown.left) drawLeft(store.getState().gridState!, hand.left);
    shown = hand;
  };
  const takeDown = (): void => { if (shown) host.flagged.show(null); shown = null; };
  const offStore = store.subscribe(sync);
  const offView = onActiveViewChange(() => { const was = shown; shown = null; if (was) sync(); });
  const offEdits = onMapEdited(store.getState().eventBus, () => { if (store.getState().repairSession?.phase === 'hand') coalesced.run(); });
  sync();
  return () => { offStore(); offView(); offEdits(); coalesced.cancel(); takeDown(); };
}
