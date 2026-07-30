/*
 * object-actions.ts — the command sequences the three object surfaces
 * (ContextMenu, DeletePopover, SelectionHandles) share verbatim: remove an
 * object, rotate an object (validate → remove+place → collapse into one undo),
 * peel a terrain layer. `removeObjectAction` is also the per-member unit
 * `group-actions.ts:deleteGroup` composes for a plural selection, so a delete
 * of one object or forty goes through the same removal, poof included.
 * Component-specific side effects that stay genuinely per-surface (closing a
 * menu, clearing the selection) stay in the components; the collapse/spin
 * animation is embedded here instead, next to the validation that gates it —
 * exactly like `rotateObjectAction`'s spin below — so no caller can forget it
 * or fire it on a doomed command.
 */
import { CommandType, type MacroCell, type PlacedObject, type GridState, type EditorEvents, type RemoveObjectCommand } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { EventBus } from '../../core/commands/event-bus';
import { peelCommand } from '../../tools/paint/terrain-peel';
import { planObjectRotation } from '../../tools/objects/object-placer';
import { petitWindow } from '../../core/runtime/window-bridge';

const removeCmd = (obj: PlacedObject): RemoveObjectCommand => ({
  type: CommandType.RemoveObject,
  timestamp: Date.now(),
  objectId: obj.id,
  removedObject: obj,
} as RemoveObjectCommand);

/**
 * Remove one placed object as a single undo step, playing the collapse/poof first. Returns whether
 * the removal was accepted.
 *
 * The poof must start BEFORE the command executes: `execute()` emits `objects-changed` synchronously,
 * which destroys the view's wrapper for `obj.id` immediately, so animating afterwards would have
 * nothing left to animate. That means the gate has to run first too — a probe replay of the exact
 * validation `execute()` is about to do, so a refusal (V-LOCK-02 on a locked object) never starts a
 * collapse for an object the map still holds. Shared by every removal, one or forty: a group delete
 * (`deleteGroup`) calls this per member, so each gets its own gated poof with no caller wiring.
 */
export function removeObjectAction(executor: CommandExecutor, state: GridState, obj: PlacedObject): boolean {
  const cmd = removeCmd(obj);
  if (executor.getRegistry().validatePreCommand(cmd, state).length === 0) {
    petitWindow().__petitAnimateRemove?.(obj.id);
  }
  const start = executor.getUndoStackSize();
  const res = executor.execute(cmd);
  if (!res.success) return false;
  executor.commitStroke(start);
  return true;
}

/**
 * Rotate `obj` to `angle`, validating the rotated footprint first — on failure
 * it emits `validation-failed` (so a toast surfaces) and leaves the object
 * untouched, returning false. On success it collapses the remove+place into one
 * undo step and plays the turn animation (`spin.from → spin.to`, kept separate
 * from the logical angle so callers can spin +90° past 360 for a consistent
 * clockwise direction). Returns whether the rotation happened.
 */
export function rotateObjectAction(
  executor: CommandExecutor,
  gridState: GridState,
  eventBus: EventBus<EditorEvents>,
  obj: PlacedObject,
  angle: 0 | 90 | 180 | 270,
  spin: { from: number; to: number },
): boolean {
  const { cmd, errors } = planObjectRotation(executor, gridState, obj, angle);
  if (errors.length > 0) {
    eventBus.emit('validation-failed', { cmd, errors });
    return false;
  }
  const start = executor.getUndoStackSize();
  executor.execute(removeCmd(obj));
  executor.execute(cmd);
  // Collapse the remove+place into one undo step (rotate is one action).
  executor.commitStrokeGroup(start);
  // The object turns (angular ease), not a squash.
  petitWindow().__petitAnimateRotation?.(cmd.object.id, spin.from, spin.to);
  return true;
}

/** Peel one terrain layer at (x,y) as a single undo step. No-op if nothing to peel. */
export function peelTerrainAction(executor: CommandExecutor, x: number, y: number, cell: MacroCell | null): void {
  const cmd = peelCommand(x, y, cell);
  if (!cmd) return;
  const start = executor.getUndoStackSize();
  executor.execute(cmd);
  executor.commitStroke(start);
}
