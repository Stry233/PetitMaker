/*
 * Everything a group edit needs that `tools/objects/group-actions` may not touch: `showToast`, the
 * active view's animation hooks, `host`, the store. The operations themselves (`rotateGroup`,
 * `flipGroup`, `deleteGroup`) stay silent about all of it and hand back a result or take a hook instead; this
 * module plays that hook and reports what happened.
 *
 * Each action acts on the live editor (`currentEditor()`, `editorEventBus()`), as every caller is the
 * one app shell, and does nothing before a map is loaded.
 */
import type { EventBus } from '../../core/commands/event-bus';
import { turnRotation, type PlacedObject, type Rotation } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { narrowToCatalog, selectedObjectIds, singleSelection, type BlockRef } from '../../state/selection';
import { flipPress, type FlipStep } from '../../core/base/coords';
import type { EditorEvents } from '../../state/editing/events';
import type { Translate } from '../../i18n/keys';
import { useEditorStore } from '../../state/store';
import { layerNumbersShown } from '../../state/layer-utils';
import { getActiveView } from '../../view/active-view';
import { paintGroupRotationArc } from '../../view/shared/overlay/selection-paint';
import {
  deleteGroup, flipGroup, peelTerrain, rotateGroup, rotateObject,
  type DeleteGroupResult, type QuarterTurn, type RotateResult,
} from '../../tools/objects';
import { showToast } from '../../platform/channels/toast-bus';
import { groupDeleteNotices } from '../../i18n/terms/copy-notices';
import { reportRefusal } from '../../core/commands/refusal';
import { host } from '../host/host';
import { rotateSessionLandmark, turnsInSession, type SessionLandmarkResult } from '../operations/planet-session';
import { currentEditor, editorEventBus, editorPort } from '../session/context';
import { flipSelectedGroup, takeBackSelectedGroup, turnSelectedGroup } from './blueprint';

/**
 * Turn one object to `angle`: validate, execute, play the spin on success, emit
 * `validation-failed` on refusal. The single call path behind every single-object rotate, and the
 * singular twin of `rotateGroupAction` below. Null before a map is loaded.
 */
function rotateObjectAction(
  obj: PlacedObject,
  turn: { angle: Rotation; spin: { from: number; to: number } },
): RotateResult | null {
  const ed = currentEditor();
  if (!ed) return null;
  const result = rotateObject(ed.executor, ed.state, obj, turn.angle, turn.spin);
  if (result.ok) host.feedback.spin(obj.id, result.spin!.from, result.spin!.to);
  else reportRefusal(editorEventBus(), result.refusal);
  return result;
}

/**
 * Turn the planet session's landmark `id` by `quarterTurns` signed quarters: the spin
 * `rotateObjectAction` plays on success, `validation-failed` on refusal. A landmark's art rests
 * upright in every footprint, so the spin winds in from the old facing and lands at rest.
 */
function rotateSessionLandmarkAction(id: string, quarterTurns: QuarterTurn | 2 = 1): SessionLandmarkResult {
  const result = rotateSessionLandmark(editorPort, quarterTurns, id);
  if (!result.cmd) return result;
  if (result.success) host.feedback.spin(result.cmd.object.id, -90 * quarterTurns, 0);
  else reportRefusal(editorEventBus(), { cmd: result.cmd, errors: result.errors });
  return result;
}

/** The removal poof, as `deleteGroup`'s `onWillRemove` hook. Bound once, inside `deleteSelection`
 *  below. */
function poofRemoved(obj: PlacedObject): void {
  host.feedback.poof(obj.id);
}

/**
 * Render a `deleteGroup` result: a refusal (nothing removed) goes out as `validation-failed`, the
 * same register a single blocked removal uses; a partial result gets an info toast; a complete one
 * reports nothing. Shared so every delete surface reports the same counts the same way.
 */
function reportDeleteGroup(
  eventBus: EventBus<EditorEvents>,
  t: Translate,
  result: DeleteGroupResult,
): void {
  if (result.refusal) reportRefusal(eventBus, result.refusal);
  for (const n of groupDeleteNotices(t, result)) showToast(n.text, n.tone);
}

/**
 * Delete every member of `ids` that isn't locked: the single call path behind every "delete this
 * selection" surface. Binds the poof, re-derives the selection from whoever survived, and reports the
 * result through `reportDeleteGroup`. Null before a map is loaded.
 */
export function deleteSelection(t: Translate, ids: readonly string[]): DeleteGroupResult | null {
  const ed = currentEditor();
  if (!ed) return null;
  // A placed blueprint selected as a group in Blueprint mode is taken back whole, its terrain with its objects.
  if (takeBackSelectedGroup()) return { deleted: ids.length, kept: 0, refusal: null };
  const { state } = ed;
  const result = deleteGroup(ed.executor, state, ids, poofRemoved);
  useEditorStore.getState().setSelection(
    ids.filter((id) => state.objects.has(id)).map((id) => ({ kind: 'object', id }) as const),
    { record: false },
  );
  reportDeleteGroup(editorEventBus(), t, result);
  return result;
}

/** The cause a group rotation's and a flip's map changes carry, so a surface placed around the
 *  selection can hold still while the members turn under it. */
export const GROUP_ROTATION_CAUSE = 'group-rotation';

/**
 * Turn the selection's members as one rigid body: runs `rotateGroup`, hands its hook the same
 * per-tick arc paint the button drives (reading state live each tick, not a closed-over snapshot, so
 * a concurrent edit can't paint a stale frame), and emits `validation-failed` on a refusal (a locked
 * member, a non-square span, an illegal destination) so it surfaces identically whether the caller
 * was a click or a keypress. `quarterTurns` lets a caller turn either way; the button only ever spins
 * clockwise (+1).
 */
function rotateGroupAction(ids: readonly string[], quarterTurns: QuarterTurn): void {
  const ed = currentEditor();
  if (!ed || ids.length < 2) return;
  const { executor, state } = ed;
  const res = executor.withCause(GROUP_ROTATION_CAUSE, () => rotateGroup(executor, state, ids, quarterTurns, (turn) => {
    const view = getActiveView();
    view?.animateGroupRotation(turn, (eased) => {
      const liveGs = useEditorStore.getState().gridState;
      if (view && liveGs) paintGroupRotationArc(view.overlay, liveGs, turn, eased, layerNumbersShown(useEditorStore.getState()));
    });
  }));
  reportRefusal(editorEventBus(), res.refusal);
}

/**
 * Turn the selection a quarter either way: a plural selection as one rigid body, the planet
 * session's landmark about its centre, a rotatable object in place. The rotate shortcut and the
 * selection card's button run this one body.
 */
export function rotateSelection(delta: 90 | -90): void {
  const s = useEditorStore.getState();
  const turn: QuarterTurn = delta === 90 ? 1 : -1;
  if (!s.gridState || !s.commandExecutor) return;
  // A placed blueprint selected as a group in Blueprint mode turns whole, its terrain with its objects, about its centre.
  if (turnSelectedGroup(turn)) return;
  if (s.selection.length > 1) {
    rotateGroupAction(selectedObjectIds(s.selection), turn);
    return;
  }
  const sel = singleSelection(s.selection);
  if (sel?.kind !== 'object') return;
  const cur = s.gridState.objects.get(sel.id);
  if (turnsInSession(cur, s.planetSession !== null)) {
    rotateSessionLandmarkAction(cur!.id, turn);
    return;
  }
  if (!cur || !getCatalogItem(cur.catalogId)?.rotatable) return;
  const to = turnRotation(cur.rotation, turn);
  rotateObjectAction(cur, { angle: to, spin: { from: cur.rotation, to: cur.rotation + delta } });
}

/** Each plural selection's place in Flip's cycle, keyed by the selection it was pressed on, so any
 *  new selection starts the cycle again. */
const selectionFlips = new WeakMap<readonly BlockRef[], FlipStep>();

/**
 * Flip the selection to the next place in Flip's cycle: a placed blueprint selected whole about its
 * frame's centre, keeping its place in the cycle on the group, and two or more objects as one rigid
 * body about the centre of their bounding box, refused whole as a turn is; a single object has no
 * flip. The flip shortcut and the selection card's Flip run this one body.
 */
export function flipSelection(): void {
  const s = useEditorStore.getState();
  const ed = currentEditor();
  if (!ed) return;
  if (flipSelectedGroup()) return;
  if (s.selection.length < 2) return;
  const { next, turn } = flipPress(selectionFlips.get(s.selection) ?? 0);
  const res = ed.executor.withCause(GROUP_ROTATION_CAUSE, () => flipGroup(ed.executor, ed.state, selectedObjectIds(s.selection), turn, (motion) => {
    getActiveView()?.animateGroupRotation(motion);
  }));
  if (res.moved > 0) selectionFlips.set(useEditorStore.getState().selection, next);
  reportRefusal(editorEventBus(), res.refusal);
}

/** Turn `obj` to `angle`, the planet session's landmark by the shorter way round. Whether it now
 *  stands at `angle` (true when it already did). */
export function rotateObjectTo(obj: PlacedObject, angle: Rotation): boolean {
  if (obj.rotation === angle) return true;
  if (turnsInSession(obj, useEditorStore.getState().planetSession !== null)) {
    const clockwise = ((((angle - obj.rotation) / 90) % 4) + 4) % 4;
    const turns = clockwise === 3 ? -1 : clockwise as 1 | 2;
    return rotateSessionLandmarkAction(obj.id, turns).success;
  }
  // The rotated footprint is validated before the object is touched: a refused angle reports and
  // leaves the object as it was.
  return rotateObjectAction(obj, { angle, spin: { from: obj.rotation, to: angle } })?.ok === true;
}

/** Narrows the selection to its objects of catalog item `catalogId`, as one selection step; false
 *  where it holds none. */
export function narrowSelectionTo(catalogId: string): boolean {
  const s = useEditorStore.getState();
  const refs = s.gridState ? narrowToCatalog(s.selection, s.gridState, catalogId) : [];
  if (refs.length === 0) return false;
  s.setSelection(refs);
  return true;
}

/** Delete one object a surface confirmed, through `deleteSelection` so a locked object reports the
 *  refusal a group of locked members gets; the selection empties. */
export function deleteObjectConfirmed(t: Translate, id: string): void {
  deleteSelection(t, [id]);
  useEditorStore.getState().clearSelection({ record: false });
}

/** Peel the top terrain layer at (x, y) as one undo step; the selection empties. Nothing on bare
 *  ground. Whether a layer went. */
export function peelTerrainAt(x: number, y: number): boolean {
  const ed = currentEditor();
  const cell = ed ? getCell(ed.state.cells, x, y) : null;
  if (!ed || !cell?.terrain) return false;
  const peeled = peelTerrain(ed.executor, x, y, cell).ok;
  useEditorStore.getState().clearSelection({ record: false });
  return peeled;
}
