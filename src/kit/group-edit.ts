/*
 * Everything a group edit needs that `tools/objects/group-actions` may not touch: `showToast` (read
 * straight off the toast bus here, not through `ui/chrome/floating/Toast`'s re-export), the active view's
 * animation hooks, `host`, the store. The operations themselves (`moveGroup`/`rotateGroup`/
 * `deleteGroup`) stay silent about all of it and hand back a result or take a hook instead — this
 * module is what plays that hook and reports what happened.
 */
import type { CommandExecutor } from '../core/commands/command-executor';
import type { EventBus } from '../core/commands/event-bus';
import type { EditorEvents, GridState, PlacedObject, Rotation, Translate } from '../core/model/types';
import { useEditorStore } from '../state/store';
import { layerNumbersShown } from '../state/slices/planet-session';
import { getActiveView } from '../canvas/active-view';
import { paintGroupRotationArc } from '../canvas/interaction/selection-paint';
import {
  deleteGroup, rotateGroup, rotateObject,
  type DeleteGroupResult, type QuarterTurn, type RotateResult,
} from '../tools/objects';
import { showToast } from '../core/runtime/toast-bus';
import { reportRefusal } from '../core/commands/refusal';
import { host } from './host';
import { rotateSessionPlaza, type SessionPlazaResult } from './operations/planet-session';

/**
 * Turn ONE object to `angle`: validate, execute, play the spin on success, emit
 * `validation-failed` on refusal. The single call path behind every single-object rotate, and the
 * singular twin of `rotateGroupAction` below.
 */
export function rotateObjectAction(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  obj: PlacedObject,
  angle: Rotation,
  spin: { from: number; to: number },
): RotateResult {
  const result = rotateObject(executor, state, obj, angle, spin);
  if (result.ok) host.feedback.spin(obj.id, result.spin!.from, result.spin!.to);
  else reportRefusal(eventBus, result.refusal);
  return result;
}

/**
 * Turn the planet session's plaza `quarterTurns` quarters clockwise: the spin `rotateObjectAction`
 * plays on success, `validation-failed` on refusal. The plaza's art rests upright in every footprint,
 * so the spin winds in from the old facing and lands at rest.
 */
export function rotateSessionPlazaAction(eventBus: EventBus<EditorEvents>, quarterTurns: 1 | 2 | 3 = 1): SessionPlazaResult {
  const result = rotateSessionPlaza(quarterTurns);
  if (!result.cmd) return result;
  if (result.success) host.feedback.spin(result.cmd.object.id, -90 * quarterTurns, 0);
  else reportRefusal(eventBus, { cmd: result.cmd, errors: result.errors });
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
export function reportDeleteGroup(
  eventBus: EventBus<EditorEvents>,
  t: Translate,
  result: DeleteGroupResult,
): void {
  if (result.refusal) {
    reportRefusal(eventBus, result.refusal);
  } else if (result.kept > 0) {
    const key = result.kept === 1 ? 'toast.group_delete_kept_one' : 'toast.group_delete_kept';
    showToast(t(key, { n: result.kept }), 'info');
  }
}

/**
 * Delete every member of `ids` that isn't locked: the SINGLE call path behind every "delete this
 * selection" surface. Binds the poof, re-derives the selection from whoever survived, and reports the
 * result through `reportDeleteGroup`.
 */
export function deleteSelection(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  t: Translate,
  ids: readonly string[],
): DeleteGroupResult {
  const result = deleteGroup(executor, state, ids, poofRemoved);
  useEditorStore.getState().setSelection(
    ids.filter((id) => state.objects.has(id)).map((id) => ({ kind: 'object', id }) as const),
  );
  reportDeleteGroup(eventBus, t, result);
  return result;
}

// Set only for the synchronous duration of this module's own `rotateGroup` call (never across the
// arc animation that follows, which is async). `SelectionCard` reads this to tell "the members'
// own geometry moved because they turned" apart from every other reason `objects-changed` fires, so
// its placement can hold still across a turn while still following a genuine group move.
let rotationInFlight = false;

export function isGroupRotationInFlight(): boolean {
  return rotationInFlight;
}

/**
 * Turn the selection's members as one rigid body: runs `rotateGroup`, hands its hook the same
 * per-tick arc paint the button drives (reading state live each tick, not a closed-over snapshot, so
 * a concurrent edit can't paint a stale frame), and emits `validation-failed` on a refusal (a locked
 * member, a non-square span, an illegal destination) so it surfaces identically whether the caller
 * was a click or a keypress. `quarterTurns` lets a caller turn either way; the button only ever spins
 * clockwise (+1).
 */
export function rotateGroupAction(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  ids: readonly string[],
  quarterTurns: QuarterTurn,
): void {
  if (ids.length < 2) return;
  rotationInFlight = true;
  let res;
  try {
    res = rotateGroup(executor, state, ids, quarterTurns, (turn) => {
      const view = getActiveView();
      view?.animateGroupRotation?.(turn, (eased) => {
        const liveGs = useEditorStore.getState().gridState;
        if (view && liveGs) paintGroupRotationArc(view.overlay, liveGs, turn, eased, layerNumbersShown(useEditorStore.getState()));
      });
    });
  } finally {
    rotationInFlight = false;
  }
  reportRefusal(eventBus, res.refusal);
}
