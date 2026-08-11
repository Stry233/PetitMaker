/*
 * Everything a group edit needs that `tools/objects/group-actions` may not touch: `showToast` (read
 * straight off the toast bus here, not through `ui/chrome/floating/Toast`'s re-export), the active view's
 * animation hooks, `host`, the store. The operations themselves (`moveGroup`/`rotateGroup`/
 * `deleteGroup`) stay silent about all of it and hand back a result or take a hook instead — this
 * module is what plays that hook and reports what happened.
 */
import type { CommandExecutor } from '../core/commands/command-executor';
import type { EventBus } from '../core/commands/event-bus';
import type { EditorEvents, GridState, PlacedObject } from '../core/model/types';
import { useEditorStore } from '../state/store';
import { getActiveView } from '../canvas/active-view';
import { paintGroupRotationArc } from '../canvas/interaction/usePointerInteraction';
import { rotateObject, type RotateResult } from '../tools/objects/actions';
import { rotateGroup, deleteGroup, type DeleteGroupResult, type QuarterTurn } from '../tools/objects/group-actions';
import { showToast } from '../core/runtime/toast-bus';
import { host } from './host';

/**
 * Turn ONE object to `angle`: validate, execute, play the spin on success, emit
 * `validation-failed` on refusal. The single call path behind every single-object rotate
 * (ContextMenu, SelectionHandles, the rotate keyboard shortcut) — the plural twin of
 * `rotateGroupAction` below, so no caller repeats the wiring or forgets a piece of it.
 */
export function rotateObjectAction(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  obj: PlacedObject,
  angle: 0 | 90 | 180 | 270,
  spin: { from: number; to: number },
): RotateResult {
  const result = rotateObject(executor, state, obj, angle, spin);
  if (result.ok) {
    host.feedback.spin(obj.id, result.spin!.from, result.spin!.to);
  } else {
    eventBus.emit('validation-failed', { cmd: result.cmd, errors: result.errors });
  }
  return result;
}

/** The removal poof, as `deleteGroup`'s `onWillRemove` hook. Bound once, inside `deleteSelection`
 *  below — nothing outside this module calls `deleteGroup` directly, so nothing outside it can
 *  forget to wire the animation. */
function poofRemoved(obj: PlacedObject): void {
  host.feedback.poof(obj.id);
}

/**
 * Render a `deleteGroup` result: a refusal (nothing removed) goes out as `validation-failed`, the
 * same register a single blocked removal uses; a partial result gets an info toast; a complete one
 * reports nothing. Shared so the keyboard command, the context menu and the delete popover render
 * identical counts identically.
 */
export function reportDeleteGroup(
  eventBus: EventBus<EditorEvents>,
  t: (key: string, params?: Record<string, string | number>) => string,
  result: DeleteGroupResult,
): void {
  if (result.refusal) {
    eventBus.emit('validation-failed', result.refusal);
  } else if (result.kept > 0) {
    const key = result.kept === 1 ? 'toast.group_delete_kept_one' : 'toast.group_delete_kept';
    showToast(t(key, { n: result.kept }), 'info');
  }
}

/**
 * Delete every member of `ids` that isn't locked: the SINGLE call path behind every "delete this
 * selection" surface (the keyboard shortcut, SelectionHandles' group button, ContextMenu,
 * DeletePopover). Binds the poof, re-derives the selection from whoever survived, and reports the
 * result through `reportDeleteGroup` — so a caller cannot forget the animation or copy the
 * survivor filter.
 */
export function deleteSelection(
  executor: CommandExecutor,
  state: GridState,
  eventBus: EventBus<EditorEvents>,
  t: (key: string, params?: Record<string, string | number>) => string,
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
// arc animation that follows, which is async). `SelectionHandles` reads this to tell "the members'
// own geometry moved because they turned" apart from every other reason `objects-changed` fires, so
// its control-row anchor can hold still across a turn while still following a genuine group move.
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
        if (view && liveGs) paintGroupRotationArc(view.overlay, liveGs, turn, eased, useEditorStore.getState().showLayerNumbers);
      });
    });
  } finally {
    rotationInFlight = false;
  }
  if (res.refusal) eventBus.emit('validation-failed', res.refusal);
}
