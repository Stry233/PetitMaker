/*
 * Group edits: move, rotate and delete a whole selection.
 *
 * Move and rotate are geometric, so they are all-or-nothing and name the member that refused —
 * a half-applied move leaves an arrangement nobody asked for. Delete removes what it can and
 * reports the rest, so selecting everything and pressing delete clears the map and keeps the landmarks.
 *
 * `groupMembers` re-resolves ids every time: another path may have removed one since the
 * selection was built.
 */
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import { type Command, type GridState, type MacroCoord, type PlacedObject, type Refusal, type ValidationError, turnRotation } from '../../core/model/types';
import type { CommandExecutor, Stroke } from '../../core/commands/command-executor';
import { getFootprint } from '../../core/grid/footprint';
import { movedObject, probeWithout } from '../placement/probe';
import { stripCoatingsFor } from '../placement/coatings';
import { getCatalogItem } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import { groupBounds, groupMembers } from '../../state/selection';
import type { GroupRotation } from './group-rotation';
import { removeObject } from './actions';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { evidenceOn } from '../../core/grid/grids';

interface GroupOpResult {
  /** Members re-placed. Zero on a refusal: a geometric group operation is all-or-nothing. */
  moved: number;
  /** The object that refused the operation, when one can be named. */
  blockedBy: string | null;
  /** The refused command and its errors, for callers that surface `validation-failed`. */
  refusal: Refusal | null;
}

/** Group membership and bounds live with the selection; the group's callers read them here too. */
export { groupBounds, groupMembers };

const NOTHING: GroupOpResult = { moved: 0, blockedBy: null, refusal: null };

function refuse(
  tx: Stroke, blockedBy: string | null, cmd: Command, errors: ValidationError[],
): GroupOpResult {
  tx.rollback();
  return { moved: 0, blockedBy, refusal: { cmd, errors } };
}

/**
 * Visual hook invoked once per member right before its own place command executes — the moment its
 * new geometry is about to appear. By then every member's old wrapper is already gone
 * (`applyGroupTransform` removes the whole group before placing any of it, so there is no
 * "old wrapper still exists" moment to animate a departure from, unlike a single delete's poof).
 * Lets a caller request a landing animation on the view it owns; never invoked for a member the
 * transform never reaches (an earlier refusal rewinds before placing anything).
 */
export type GroupPlaceHook = (member: PlacedObject, next: PlacedObject) => void;

/**
 * Lift every member off the map, then place each where `destination` puts it, as one stroke group
 * and one undo entry. Every removal lands before any placement, or a destination inside the group's
 * own footprint collides. Every removal's result is checked, since V-LOCK-02 refuses a locked
 * removal while nothing gates the placement after it. Any refusal rewinds to the start; move and
 * rotate share this contract, `deleteGroup` applies partially.
 */
function applyGroupTransform(
  executor: CommandExecutor, state: GridState, members: readonly PlacedObject[],
  destination: (obj: PlacedObject) => PlacedObject,
  onWillPlace?: GroupPlaceHook,
): GroupOpResult {
  if (members.length === 0) return NOTHING;
  // Silent: the executor's own toast would name an intermediate command the user never issued.
  // Refusals reach the caller through the result instead.
  return executor.transaction({ silent: true }, (tx): GroupOpResult => {
    for (const obj of members) {
      const cmd = removeObjectCommand(obj);
      const res = executor.execute(cmd);
      if (!res.success) return refuse(tx, obj.id, cmd, res.errors);
    }
    let last: Command = removeObjectCommand(members[0]!);
    for (const obj of members) {
      const next = destination(obj);
      onWillPlace?.(obj, next);
      // Coat over any road the destination covers, as a single placement does. After the removal
      // loop above, so a member's own cells are already free and a road it was sitting on is not
      // mistaken for one to strip.
      stripCoatingsFor(executor, state, next);
      const cmd = placeObjectCommand(next);
      last = cmd;
      const res = executor.execute(cmd);
      if (!res.success) return refuse(tx, obj.id, cmd, res.errors);
    }
    const violations = tx.commit();
    if (violations.length > 0) {
      // A post-stroke violation reverts only as far as a clean state, which would leave the rest of
      // the group as a partial arrangement. No member is named: the violation is about the map.
      return refuse(tx, null, last, violations);
    }
    return { moved: members.length, blockedBy: null, refusal: null };
  });
}

/** Move every member of `ids` by `delta`. Stale ids are skipped; see `applyGroupTransform` for
 *  the ordering and the all-or-nothing contract. `onWillPlace` fires for every member (a move never
 *  turns anything, so there is no "carried vs spun" distinction here — see `rotateGroup`). */
export function moveGroup(
  executor: CommandExecutor, state: GridState, ids: readonly string[], { dx, dy }: { dx: number; dy: number },
  onWillPlace?: GroupPlaceHook,
): GroupOpResult {
  return applyGroupTransform(
    executor,
    state,
    groupMembers(state, ids),
    (obj) => movedObject(state, obj, obj.position.x + dx, obj.position.y + dy),
    onWillPlace,
  );
}

/** A single 90 degree step: +1 clockwise, -1 counter-clockwise. */
export type QuarterTurn = 1 | -1;

/**
 * The pivot of a group rotation, doubled to stay integral: `s2 = 2(cx + cy)`, `t2 = 2(cy - cx)`
 * about the centre of the selection's macro bounding box. A turn moves the whole footprint, so a
 * member's anchor shifts by its own height (clockwise) or width; turning the anchor alone drifts
 * non-square members outward. When the box's width + height is odd the centre is half a cell off the
 * grid and the arrangement is nudged onto it; the nudge keys on the box's aspect, which swaps every
 * turn, so four turns return every member to its exact start.
 */
interface RotationPivot { s2: number; t2: number }

function rotationPivot(members: readonly PlacedObject[], turn: QuarterTurn): RotationPivot {
  const { minX, minY, maxX, maxY } = groupBounds(members);
  const s2 = minX + maxX + minY + maxY, t2 = minY + maxY - minX - maxX;
  if (s2 % 2 === 0) return { s2, t2 };
  // Odd extents sum: the aspect decides the half-cell nudge, and the box is never square here (a
  // square box sums even). The two directions are inverses, so a turn and its opposite cancel.
  const wide = maxX - minX > maxY - minY ? 1 : -1;
  return { s2: s2 - wide * turn, t2: t2 + wide };
}

function rotatedAnchor(obj: PlacedObject, pivot: RotationPivot, turn: QuarterTurn): MacroCoord {
  const { x, y, w, h } = objectRect(obj);
  const s = pivot.s2 / 2, t = pivot.t2 / 2;
  return turn === 1 ? { x: s - y - h, y: t + x } : { x: y - t, y: s - x - w };
}

/** A synthetic error: `V-ROTATE-SPAN` is not in the registry (nothing gates a rotation as a command,
 *  it is a PlaceObject like any other), but it carries a rule's shape so the toast and the error
 *  flash read it unchanged. */
function spanRefusal(obj: PlacedObject): ValidationError {
  const { x, y, w, h } = objectRect(obj);
  return {
    ruleId: 'V-ROTATE-SPAN', message: 'error.span_no_group_rotate',
    ...evidenceOn(PLACEMENT_GRID, getFootprint(x, y, w, h)),
  };
}

/**
 * Visual hook for a group rotation, invoked once with the whole turn after every member has landed
 * — not per member like `GroupPlaceHook`. A rigid rotation is one body turning about one point, so
 * it is one tween: one pivot, one sweep, one clock over every member (see `view/shared/motion/group-arc.ts`). A
 * per-member hook could not share a clock, and a stagger here would dissolve the one-body reading.
 *
 * Never invoked for a refused rotation: the transform is all-or-nothing, so there is nothing to
 * animate. `rotateGroup` is the only place that knows the pivot (including the half-cell nudge), so
 * it hands the caller the finished spec rather than the pieces to rebuild one from.
 */
type GroupRotateHook = (turn: GroupRotation) => void;

/**
 * Turn the selection as one rigid body about the centre of its macro bounding box; a rotatable
 * member's rotation advances by the same 90 degrees. Stale ids are skipped; ordering and the
 * all-or-nothing contract are `applyGroupTransform`'s.
 *
 * A non-rotatable square member is carried (position turns, facing stays). A non-rotatable
 * non-square member (the bridges, ramps and landmarks, including every halfStep item) refuses the whole
 * rotation by name, since the box would change shape every turn; so `rotationPivot` only ever sees
 * integral doubled coordinates. A locked member refuses through V-LOCK-02, as does any illegal
 * landing.
 */
export function rotateGroup(
  executor: CommandExecutor, state: GridState, ids: readonly string[], quarterTurns: QuarterTurn,
  onRotate?: GroupRotateHook,
): GroupOpResult {
  const members = groupMembers(state, ids);
  if (members.length === 0) return NOTHING;
  const span = members.find((obj) => {
    const rect = objectRect(obj);
    return !getCatalogItem(obj.catalogId)?.rotatable && rect.w !== rect.h;
  });
  if (span) {
    return { moved: 0, blockedBy: span.id, refusal: { cmd: removeObjectCommand(span), errors: [spanRefusal(span)] } };
  }
  const pivot = rotationPivot(members, quarterTurns);
  const res = applyGroupTransform(executor, state, members, (obj) => {
    const { x, y } = rotatedAnchor(obj, pivot, quarterTurns);
    const turns = getCatalogItem(obj.catalogId)?.rotatable ?? false;
    return {
      ...movedObject(state, obj, x, y),
      rotation: turns ? turnRotation(obj.rotation, quarterTurns) : obj.rotation,
    };
  });
  // The turn as one animation spec, handed over once the whole body has landed. `members` still
  // holds the objects as they were, so the pre-rotation footprint centres are read from here: the
  // commands have already applied, and a view's own geometry stands at the destination, so where
  // each member came from is the one thing it cannot look up for itself.
  if (res.moved > 0 && onRotate) {
    onRotate({
      pivot: { x: (pivot.s2 - pivot.t2) / 4, y: (pivot.s2 + pivot.t2) / 4 },
      sweepDeg: quarterTurns * 90,
      members: members.map((obj) => {
        const rect = objectRect(obj);
        return {
          id: obj.id,
          from: { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 },
          spun: getCatalogItem(obj.catalogId)?.rotatable ?? false,
        };
      }),
    });
  }
  return res;
}

export interface DeleteGroupResult {
  /** Members removed. */
  deleted: number;
  /** Members left in place because their removal was refused (locked). */
  kept: number;
  /** Set only when nothing was removed (every member refused), and named by the first member.
   *  `reportDeleteGroup` keys the error-vs-info register off it. */
  refusal: Refusal | null;
}

/**
 * Delete every unlocked member of `ids` as one stroke group and one undo entry, skipping stale ids.
 * Partial, unlike `applyGroupTransform`: survivors stay where they were. `onWillRemove` fires right
 * before a member's remove executes (the caller supplies the poof), gated on `removeObject`'s own
 * probe. One silent transaction, so skipped locks raise no toast each and a throw restores every
 * member; the caller reports `kept`.
 */
export function deleteGroup(
  executor: CommandExecutor, state: GridState, ids: readonly string[],
  onWillRemove?: (obj: PlacedObject) => void,
): DeleteGroupResult {
  const members = groupMembers(state, ids);
  if (members.length === 0) return { deleted: 0, kept: 0, refusal: null };
  // A throw part-way takes the removals already applied back with it.
  const deleted = executor.transaction({ silent: true }, (tx) => {
    const n = members.reduce((count, obj) => {
      // Probed before the command, or the hook has nothing left to animate once execute() emits
      // objects-changed and the view destroys the wrapper for this id.
      if (executor.getRegistry().validatePreCommand(removeObjectCommand(obj), state).length === 0) {
        onWillRemove?.(obj);
      }
      return count + (removeObject(executor, obj).ok ? 1 : 0);
    }, 0);
    if (n > 0) tx.collapse();
    return n;
  });
  if (deleted > 0) return { deleted, kept: members.length - deleted, refusal: null };
  // Nothing removed. State is unchanged, so replaying the first member's own validation here
  // reproduces the error that refused it.
  const cmd = removeObjectCommand(members[0]!);
  const errors = executor.getRegistry().validatePreCommand(cmd, state);
  return { deleted: 0, kept: members.length, refusal: { cmd, errors } };
}

/** Whether `moveGroup` would be accepted — what the drag ghost tints itself by. Validates every
 *  member's destination with the whole group lifted, and refuses a locked member because its
 *  removal would refuse. Non-mutating. */
export function previewGroupMove(
  executor: CommandExecutor, state: GridState, ids: readonly string[], dx: number, dy: number,
): boolean {
  const members = groupMembers(state, ids);
  if (members.length === 0 || members.some((obj) => obj.locked)) return false;
  const probe = probeWithout(state, members);
  return members.every((obj) => {
    const cmd = placeObjectCommand(movedObject(state, obj, obj.position.x + dx, obj.position.y + dy));
    return executor.getRegistry().validatePreCommand(cmd, probe.view, probe.scope).length === 0;
  });
}
