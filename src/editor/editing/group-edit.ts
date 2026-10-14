/*
 * Everything a group edit needs that `tools/objects/group-actions` may not touch: `showToast`, the
 * active view's animation hooks, `host`, the store. The operations themselves (`rotateGroup`,
 * `deleteGroup`) stay silent about all of it and hand back a result or take a hook instead; this
 * module plays that hook and reports what happened.
 *
 * Each action acts on the live editor (`currentEditor()`, `editorEventBus()`), as every caller is the
 * one app shell, and does nothing before a map is loaded.
 */
import type { EventBus } from '../../core/commands/event-bus';
import { turnRotation, type GridState, type PlacedObject, type Rotation } from '../../core/model/types';
import { getCell } from '../../core/model/grid-model';
import { getCatalogItem } from '../../state/catalog';
import { selectedObjectIds, singleSelection, type BlockRef } from '../../state/selection';
import type { EditorEvents } from '../../state/editing/events';
import type { Translate } from '../../i18n/keys';
import { useEditorStore } from '../../state/store';
import { layerNumbersShown } from '../../state/layer-utils';
import { getActiveView } from '../../view/active-view';
import { paintGroupRotationArc } from '../../view/shared/overlay/selection-paint';
import {
  deleteGroup, peelTerrain, rotateGroup, rotateObject,
  type DeleteGroupResult, type QuarterTurn, type RotateResult,
} from '../../tools/objects';
import { showToast } from '../../platform/channels/toast-bus';
import { reportRefusal } from '../../core/commands/refusal';
import { host } from '../host/host';
import { rotateSessionLandmark, turnsInSession, type SessionLandmarkResult } from '../operations/planet-session';
import { pickedMaterial } from './pick-selection';
import { currentEditor, editorEventBus, editorPort } from '../session/context';

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
  if (result.refusal) {
    reportRefusal(eventBus, result.refusal);
  } else if (result.kept > 0) {
    showToast(t('toast.group_delete_kept', { n: result.kept }), 'info');
  }
}

/**
 * Delete every member of `ids` that isn't locked: the single call path behind every "delete this
 * selection" surface. Binds the poof, re-derives the selection from whoever survived, and reports the
 * result through `reportDeleteGroup`. Null before a map is loaded.
 */
export function deleteSelection(t: Translate, ids: readonly string[]): DeleteGroupResult | null {
  const ed = currentEditor();
  if (!ed) return null;
  const { state } = ed;
  const result = deleteGroup(ed.executor, state, ids, poofRemoved);
  useEditorStore.getState().setSelection(
    ids.filter((id) => state.objects.has(id)).map((id) => ({ kind: 'object', id }) as const),
  );
  reportDeleteGroup(editorEventBus(), t, result);
  return result;
}

/** The cause a group rotation's map changes carry, so a surface placed around the selection can
 *  hold still while the members turn under it. */
export const GROUP_ROTATION_CAUSE = 'group-rotation';

/**
 * Turn the selection's members as one rigid body: runs `rotateGroup`, hands its hook the same
 * per-tick arc paint the button drives (reading state live each tick, not a closed-over snapshot, so
 * a concurrent edit can't paint a stale frame), and emits `validation-failed` on a refusal (a locked
 * member, a non-square span, an illegal destination) so it surfaces identically whether the caller
 * was a click or a keypress. `quarterTurns` lets a caller turn either way; the button only ever spins
 * clockwise (+1).
 */
export function rotateGroupAction(ids: readonly string[], quarterTurns: QuarterTurn): void {
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

/** What a selection can do; locked objects (the plaza) and bare ground take no action. */
export interface SelectionTarget {
  key: string;
  plural: boolean;
  block: BlockRef | null;
  object: PlacedObject | null;
  rotatable: boolean;
  deletable: boolean;
  pickable: boolean;
  /** The planet session's plaza: it turns about its centre with its footprint swapped, so it has no facing. */
  sessionLandmark: boolean;
}

/** The selection's abilities on `gs`, or null for a selection that can take none. */
export function selectionTarget(selection: readonly BlockRef[], gs: GridState | null, inSession: boolean): SelectionTarget | null {
  const plural = selection.length > 1;
  if (plural) {
    return {
      key: `g:${selectedObjectIds(selection).join(',')}`, plural, block: null, object: null, rotatable: true, deletable: true, pickable: false,
      sessionLandmark: false,
    };
  }
  const block = singleSelection(selection);
  if (!block || !gs) return null;
  const object = block.kind === 'object' ? gs.objects.get(block.id) ?? null : null;
  const item = object ? getCatalogItem(object.catalogId) : null;
  const terrain = block.kind === 'terrain' ? getCell(gs.cells, block.x, block.y)?.terrain ?? null : null;
  const sessionLandmark = turnsInSession(object, inSession);
  const rotatable = (!!item?.rotatable && !object?.locked) || sessionLandmark;
  const deletable = (!!object && !object.locked) || !!terrain;
  const pickable = pickedMaterial(gs, selection) !== null;
  if (!deletable && !pickable) return null;
  return { key: block.kind === 'object' ? block.id : `t:${block.x},${block.y}`, plural, block, object, rotatable, deletable, pickable, sessionLandmark };
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

/** Turn the one selected object to face `angle`; nothing when it already does. */
export function faceSelected(angle: Rotation): void {
  const s = useEditorStore.getState();
  const sel = singleSelection(s.selection);
  const cur = sel?.kind === 'object' ? s.gridState?.objects.get(sel.id) : undefined;
  if (!cur || !s.commandExecutor || !s.gridState || cur.rotation === angle) return;
  rotateObjectAction(cur, { angle, spin: { from: cur.rotation, to: angle } });
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

/** Delete one object a surface confirmed, through `deleteSelection` so a locked object reports the
 *  refusal a group of locked members gets; the selection empties. */
export function deleteObjectConfirmed(t: Translate, id: string): void {
  deleteSelection(t, [id]);
  useEditorStore.getState().clearSelection();
}

/** Peel the top terrain layer at (x, y) as one undo step; the selection empties. Nothing on bare ground. */
export function peelTerrainAt(x: number, y: number): void {
  const ed = currentEditor();
  const cell = ed ? getCell(ed.state.cells, x, y) : null;
  if (!ed || !cell?.terrain) return;
  peelTerrain(ed.executor, x, y, cell);
  useEditorStore.getState().clearSelection();
}
