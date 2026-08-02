/*
 * group-actions.ts — the command choreography the GROUP operations share, the plural sibling of
 * object-actions.ts. Only executor/command sequencing lives here; callers keep their own side
 * effects (repainting the selection, surfacing the refusal, the animation via the optional hook
 * `moveGroup`/`rotateGroup` accept — this module never touches a view or the window bridge itself,
 * it only calls the hook a caller supplied).
 *
 * The two hooks differ in shape because the two operations do: a MOVE lands each member
 * independently, so `GroupPlaceHook` fires per member, while a ROTATION is one rigid body turning
 * about one point, so `GroupRotateHook` fires ONCE with the whole turn.
 */
import { type Command, type EditorEvents, type GridState, type MacroCoord, type PlacedObject, type ValidationError } from '../../core/model/types';
import type { CommandExecutor } from '../../core/commands/command-executor';
import type { EventBus } from '../../core/commands/event-bus';
import { bumpObjectsVersion, getFootprint } from '../../core/model/grid-model';
import { movedObject, objectPlacementCommand, removeObjectCommand, stripCoatingsFor } from '../../tools/objects/object-placer';
import { getCatalogItem } from '../../state/catalog';
import { objectRect } from '../../state/object-geometry';
import type { GroupRotation } from '../../canvas/group-arc';
import { removeObjectAction } from './object-actions';
import { showToast } from './Toast';

export interface GroupOpResult {
  /** Members re-placed. Zero on a refusal: a geometric group operation is all-or-nothing. */
  moved: number;
  /** The object that refused the operation, when one can be named. */
  blockedBy: string | null;
  /** The refused command and its errors, for callers that surface `validation-failed`. */
  refusal: { cmd: Command; errors: ValidationError[] } | null;
}

const NOTHING: GroupOpResult = { moved: 0, blockedBy: null, refusal: null };

/** The objects `ids` still resolve to, in the given order. A selection may name an object that
 *  another path (the agent, a post-stroke revert, an undo) has since removed, and nothing validates
 *  membership centrally, so every group operation resolves through here. */
export function groupMembers(state: GridState, ids: readonly string[]): PlacedObject[] {
  return ids.flatMap((id) => {
    const obj = state.objects.get(id);
    return obj ? [obj] : [];
  });
}

/** Run `fn` with every member deleted from the map, restoring them afterwards, so a member's
 *  destination inside the group's own footprint is not read as a collision (the group-scale form of
 *  the exclusion `planObjectMove` makes). A probe: nothing is executed, no history is written. */
function withGroupLifted<T>(state: GridState, members: readonly PlacedObject[], fn: () => T): T {
  for (const obj of members) state.objects.delete(obj.id);
  bumpObjectsVersion(state, { removed: members });
  try {
    return fn();
  } finally {
    for (const obj of members) state.objects.set(obj.id, obj);
    bumpObjectsVersion(state, { added: members });
  }
}

function refuse(
  executor: CommandExecutor, watermark: number, blockedBy: string | null,
  cmd: Command, errors: ValidationError[],
): GroupOpResult {
  executor.rollbackTo(watermark);
  return { moved: 0, blockedBy, refusal: { cmd, errors } };
}

/**
 * Visual hook invoked once per member right before ITS OWN place command executes — the moment its
 * new geometry is about to appear. By then every member's OLD wrapper is already gone
 * (`applyGroupTransform` removes the whole group before placing any of it, so there is no
 * "old wrapper still exists" moment to animate a departure from, unlike a single delete's poof).
 * Lets a caller request a landing animation on the view it owns; never invoked for a member the
 * transform never reaches (an earlier refusal rewinds before placing anything).
 */
export type GroupPlaceHook = (member: PlacedObject, next: PlacedObject) => void;

/**
 * Lift every member off the map, then place each one where `destination` puts it, as ONE stroke
 * group and one undo entry.
 *
 * EVERY removal must land before ANY placement: a move is RemoveObject then a validated
 * PlaceObject, and a destination inside the group's own footprint collides as long as the group is
 * still standing there, so member-by-member validation cannot slide a tightly packed group one cell.
 *
 * Every removal's RESULT is checked: V-LOCK-02 refuses a locked object's removal while nothing gates
 * the placement that follows, so an unchecked removal silently relocates an object the map still holds.
 *
 * All-or-nothing: any refusal rewinds to the watermark, leaving the map and the undo stack as they
 * were. Move and rotate have that contract; `deleteGroup` applies partially.
 */
export function applyGroupTransform(
  executor: CommandExecutor, state: GridState, members: readonly PlacedObject[],
  destination: (obj: PlacedObject) => PlacedObject,
  onWillPlace?: GroupPlaceHook,
): GroupOpResult {
  if (members.length === 0) return NOTHING;
  const watermark = executor.getUndoStackSize();
  // Silent: the executor's own toast would name an intermediate command the user never issued.
  // Refusals reach the caller through the result instead.
  return executor.runSilently((): GroupOpResult => {
    for (const obj of members) {
      const cmd = removeObjectCommand(obj);
      const res = executor.execute(cmd);
      if (!res.success) return refuse(executor, watermark, obj.id, cmd, res.errors);
    }
    let last: Command = removeObjectCommand(members[0]!);
    for (const obj of members) {
      const next = destination(obj);
      onWillPlace?.(obj, next);
      // Coat over any road the destination covers, as a single placement does. After the removal
      // loop above, so a member's own cells are already free and a road it was sitting on is not
      // mistaken for one to strip.
      stripCoatingsFor(executor, state, next);
      const cmd = objectPlacementCommand(next);
      last = cmd;
      const res = executor.execute(cmd);
      if (!res.success) return refuse(executor, watermark, obj.id, cmd, res.errors);
    }
    const violations = executor.commitStrokeGroup(watermark);
    if (violations.length > 0) {
      // A post-stroke violation reverts only as far as a clean state, which would leave the rest of
      // the group as a partial arrangement. No member is named: the violation is about the map.
      return refuse(executor, watermark, null, last, violations);
    }
    return { moved: members.length, blockedBy: null, refusal: null };
  });
}

/** Move every member of `ids` by (dx, dy). Stale ids are skipped; see `applyGroupTransform` for
 *  the ordering and the all-or-nothing contract. `onWillPlace` fires for every member (a move never
 *  turns anything, so there is no "carried vs spun" distinction here — see `rotateGroup`). */
export function moveGroup(
  executor: CommandExecutor, state: GridState, ids: readonly string[], dx: number, dy: number,
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
 * The pivot of a group rotation, held DOUBLED so the arithmetic stays integral:
 * `s2 = 2(cx + cy)`, `t2 = 2(cy - cx)`, where (cx, cy) is the centre of the selection's macro
 * bounding box.
 *
 * A turn moves the whole FOOTPRINT, not the anchor: the half-open rect [x, x+w) x [y, y+h) turns
 * into a rect whose extents are swapped, so a member's anchor moves by its own height (clockwise)
 * or its own width (counter-clockwise). An anchor-only turn drifts every non-square member outward
 * a little per turn.
 *
 * A member lands on the lattice exactly when s2 and t2 are even, i.e. when the box's width + height
 * is even. When it is odd the true centre sits on a cell-EDGE midpoint, half a cell off the grid in
 * both axes, and the whole rigid arrangement is nudged half a cell to land on it. The nudge keys on
 * the box's aspect, which SWAPS with every turn, so successive nudges cancel in pairs and four turns
 * return every member to its exact starting cell and rotation.
 */
interface RotationPivot { s2: number; t2: number }

/** The macro bounds of a group's footprints, half-open (`maxX`/`maxY` are exclusive edges). The
 *  group's geometric centre — what a rotation turns the body about, and what the chrome anchors its
 *  control row to — is this box's centre, so both read it from here. */
export function groupBounds(members: readonly PlacedObject[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of members) {
    const r = objectRect(obj);
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

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
    cells: getFootprint(x, y, w, h), grid: 'macro', severity: 'error',
  };
}

/**
 * Visual hook for a group rotation, invoked ONCE with the WHOLE turn after every member has landed
 * — not per member like `GroupPlaceHook`. A rigid rotation is one body turning about one point, so
 * it is one tween: one pivot, one sweep, one clock over every member (see `canvas/group-arc.ts`). A
 * per-member hook could not share a clock, and a stagger here would dissolve the one-body reading.
 *
 * Never invoked for a refused rotation: the transform is all-or-nothing, so there is nothing to
 * animate. `rotateGroup` is the only place that knows the pivot (including the half-cell nudge), so
 * it hands the caller the finished spec rather than the pieces to rebuild one from.
 */
export type GroupRotateHook = (turn: GroupRotation) => void;

/**
 * Turn the selection as ONE rigid body: every member's position turns about the centre of the
 * selection's macro bounding box, and a member's own rotation advances by the same 90 degrees when
 * its catalog item is rotatable. Stale ids are skipped; see `applyGroupTransform` for the ordering
 * and the all-or-nothing contract.
 *
 * A NON-ROTATABLE member with a SQUARE footprint is carried: its position turns, its facing stays.
 *
 * A non-rotatable member whose footprint is NON-SQUARE refuses the whole rotation by name. It cannot
 * swap its extent, so the selection's bounding box changes shape from turn to turn and the whole
 * arrangement walks away from where it started. The set is exactly the bridges and ramps.
 *
 * A LOCKED member refuses too: V-LOCK-02 refuses its removal, which refuses the whole rotation with
 * the rule's own error. So does any member landing illegally.
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
  const step = quarterTurns === 1 ? 90 : 270;
  const res = applyGroupTransform(executor, state, members, (obj) => {
    const { x, y } = rotatedAnchor(obj, pivot, quarterTurns);
    const turns = getCatalogItem(obj.catalogId)?.rotatable ?? false;
    return {
      ...movedObject(state, obj, x, y),
      rotation: turns ? ((obj.rotation + step) % 360) as 0 | 90 | 180 | 270 : obj.rotation,
    };
  });
  // The turn as ONE animation spec, handed over once the whole body has landed. `members` still
  // holds the objects as they WERE, so the pre-rotation footprint centres are read from here: the
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
  /** Set only when NOTHING was removed (every member refused), and named by the first member.
   *  `reportDeleteGroup` keys the error-vs-info register off it. */
  refusal: { cmd: Command; errors: ValidationError[] } | null;
}

/**
 * Delete every member of `ids` that isn't locked, as one stroke group and one undo entry. Stale ids
 * are skipped. PARTIAL, unlike `applyGroupTransform`'s all-or-nothing contract: a deleted subset
 * leaves the survivors exactly where they were, so no arrangement is deformed by a partial result.
 *
 * Runs `removeObjectAction` per member, silenced so a skipped lock doesn't fire a
 * `validation-failed` toast per member, then collapses the per-member undo entries into one. The
 * caller reports `kept` (and which ids survive, by re-checking `state.objects`).
 */
export function deleteGroup(
  executor: CommandExecutor, state: GridState, ids: readonly string[],
): DeleteGroupResult {
  const members = groupMembers(state, ids);
  if (members.length === 0) return { deleted: 0, kept: 0, refusal: null };
  const watermark = executor.getUndoStackSize();
  const deleted = executor.runSilently(
    () => members.reduce((n, obj) => n + (removeObjectAction(executor, state, obj) ? 1 : 0), 0),
  );
  if (deleted > 0) {
    executor.collapseHistory(watermark);
    return { deleted, kept: members.length - deleted, refusal: null };
  }
  // Nothing removed. State is unchanged, so replaying the first member's own validation here
  // reproduces the error that refused it.
  const cmd = removeObjectCommand(members[0]!);
  const errors = executor.getRegistry().validatePreCommand(cmd, state);
  return { deleted: 0, kept: members.length, refusal: { cmd, errors } };
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

/** Whether `moveGroup` would be accepted — what the drag ghost tints itself by. Validates every
 *  member's destination with the whole group lifted, and refuses a locked member because its
 *  removal would refuse. Non-mutating. */
export function previewGroupMove(
  executor: CommandExecutor, state: GridState, ids: readonly string[], dx: number, dy: number,
): boolean {
  const members = groupMembers(state, ids);
  if (members.length === 0 || members.some((obj) => obj.locked)) return false;
  return withGroupLifted(state, members, () => members.every((obj) => {
    const cmd = objectPlacementCommand(movedObject(state, obj, obj.position.x + dx, obj.position.y + dy));
    return executor.getRegistry().validatePreCommand(cmd, state).length === 0;
  }));
}
