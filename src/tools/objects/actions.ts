/*
 * The command sequences behind removing, rotating and peeling one block: validate, execute, and
 * collapse into a single undo step.
 *
 * A rotation is a remove plus a place of the same id, so it has to collapse or undo would stop
 * between them. The result carries the spin the caller animates: an animation belongs to a view,
 * and this runs below one.
 */
import { type Command, type MacroCell, type PlacedObject, type GridState, type ValidationError } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { peelCommand } from '../paint/terrain-peel';
import { planObjectRotation, removeObjectCommand } from './object-placer';

export interface ActionResult {
  ok: boolean;
  errors: ValidationError[];
}

/** `cmd` is the rotation the caller emits on `validation-failed` so a refusal still toasts;
 *  `spin` is the turn the caller animates when it succeeded. */
export interface RotateResult extends ActionResult {
  cmd: Command;
  spin?: { from: number; to: number };
}

/** Remove one placed object as a single undo step. */
export function removeObject(executor: CommandExecutor, obj: PlacedObject): ActionResult {
  const cmd = removeObjectCommand(obj);
  const start = executor.getUndoStackSize();
  const res = executor.execute(cmd);
  if (!res.success) return { ok: false, errors: res.errors };
  executor.commitStroke(start);
  return { ok: true, errors: [] };
}

/**
 * Rotate `obj` to `angle`, validating the rotated footprint first. On success it collapses the
 * remove+place into one undo step and returns `spin` (kept separate from the logical angle so a
 * caller can spin +90° past 360 for a consistent clockwise direction). On refusal it leaves the
 * object untouched and returns the refused command alongside the errors.
 */
export function rotateObject(
  executor: CommandExecutor,
  state: GridState,
  obj: PlacedObject,
  angle: 0 | 90 | 180 | 270,
  spin: { from: number; to: number },
): RotateResult {
  const { cmd, errors } = planObjectRotation(executor, state, obj, angle);
  if (errors.length > 0) return { ok: false, errors, cmd };
  const start = executor.getUndoStackSize();
  executor.execute(removeObjectCommand(obj));
  executor.execute(cmd);
  // Collapse the remove+place into one undo step (rotate is one action).
  executor.commitStrokeGroup(start);
  return { ok: true, errors: [], cmd, spin };
}

/** Peel one terrain layer at (x,y) as a single undo step. No-op (`ok: false`) if nothing to peel. */
export function peelTerrain(executor: CommandExecutor, x: number, y: number, cell: MacroCell | null): ActionResult {
  const cmd = peelCommand(x, y, cell);
  if (!cmd) return { ok: false, errors: [] };
  const start = executor.getUndoStackSize();
  const res = executor.execute(cmd);
  if (!res.success) return { ok: false, errors: res.errors };
  executor.commitStroke(start);
  return { ok: true, errors: [] };
}
