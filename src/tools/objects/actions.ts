/*
 * The command sequences behind removing, moving, rotating and peeling one block: validate, execute, and
 * collapse into a single undo step.
 *
 * A rotation is a remove plus a place of the same id, so it has to collapse or undo would stop
 * between them. The result carries the spin the caller animates: an animation belongs to a view,
 * and this runs below one.
 */
import { removeObjectCommand } from '../../core/model/command-build';
import { type MacroCell, type PlacedObject, type GridState, type Refusal, type Rotation } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import { peelCommand } from '../placement/terrain-peel';
import { planObjectMove, planObjectRotation } from '../placement/probe';
import { stripCoatingsFor } from '../placement/coatings';

interface ActionResult {
  ok: boolean;
  /** The refused command, for the caller to report. Null on success and on a no-op. */
  refusal: Refusal | null;
}

/** `spin` is the turn the caller animates when it succeeded. */
export interface RotateResult extends ActionResult {
  spin?: { from: number; to: number };
}

/** Remove one placed object as a single undo step. */
export function removeObject(executor: CommandExecutor, obj: PlacedObject): ActionResult {
  const cmd = removeObjectCommand(obj);
  return executor.transaction({}, (tx): ActionResult => {
    const res = executor.execute(cmd);
    if (!res.success) return { ok: false, refusal: { cmd, errors: res.errors } };
    tx.commit();
    return { ok: true, refusal: null };
  });
}

/**
 * Rotate `obj` to `angle`, validating the rotated footprint first. On success it collapses the
 * remove+place into one undo step and returns `spin` (kept separate from the logical angle so a
 * caller can spin +90° past 360 for a consistent clockwise direction). On refusal it leaves the
 * object untouched and returns the refusal.
 */
export function rotateObject(
  executor: CommandExecutor,
  state: GridState,
  obj: PlacedObject,
  angle: Rotation,
  spin: { from: number; to: number },
): RotateResult {
  const { cmd, errors } = planObjectRotation(executor, state, obj, angle);
  if (errors.length > 0) return { ok: false, refusal: { cmd, errors } };
  return executor.transaction({}, (tx): RotateResult => {
    executor.execute(removeObjectCommand(obj));
    executor.execute(cmd);
    // Collapse the remove+place into one undo step (rotate is one action).
    tx.commit();
    return { ok: true, refusal: null, spin };
  });
}

/**
 * Move `obj` so its anchor lands on (x, y), as a single undo step: lift it, coat over any road the
 * destination covers as placing the item fresh would, and place it, so undo puts the road back with
 * the object. Judged on the snapped destination: a drop whose snapped pose is the current one is a
 * no-op (`ok: false`, no refusal), and a refused one leaves the object where it stood.
 */
export function moveObject(
  executor: CommandExecutor, state: GridState, obj: PlacedObject, x: number, y: number,
): ActionResult {
  const { cmd, errors, preview } = planObjectMove(executor, state, obj, x, y);
  if (preview.position.x === obj.position.x && preview.position.y === obj.position.y
      && preview.rotation === obj.rotation) return { ok: false, refusal: null };
  if (errors.length > 0) return { ok: false, refusal: { cmd, errors } };
  return executor.transaction({}, (tx): ActionResult => {
    executor.execute(removeObjectCommand(obj));
    stripCoatingsFor(executor, state, cmd.object);
    executor.execute(cmd);
    tx.commit();
    return { ok: true, refusal: null };
  });
}

/** Peel one terrain layer at (x,y) as a single undo step. No-op (`ok: false`) if nothing to peel. */
export function peelTerrain(executor: CommandExecutor, x: number, y: number, cell: MacroCell | null): ActionResult {
  const cmd = peelCommand(x, y, cell);
  if (!cmd) return { ok: false, refusal: null };
  return executor.transaction({}, (tx): ActionResult => {
    const res = executor.execute(cmd);
    if (!res.success) return { ok: false, refusal: { cmd, errors: res.errors } };
    tx.commit();
    return { ok: true, refusal: null };
  });
}
