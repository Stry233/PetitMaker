/*
 * A placed blueprint's group as a whole (`core/model/placed-group.ts`): taken back, turned, flipped
 * and moved by exactly its standing members, so work that is not the group's is never touched.
 */
import { eraseTerrainCommand, paintTerrainCommand, removeObjectCommand } from '../../core/model/command-build';
import { cloneGridState, cloneTerrain, getCell } from '../../core/model/grid-model';
import { groupRecipe, liveMembers, mapGroups, prunedGroup, type GroupMembers, type PlacedGroup } from '../../core/model/placed-group';
import { TerrainType, type Command, type GridState, type MacroCoord } from '../../core/model/types';
import { copyCorners } from '../../core/model/corners';
import { flipPress, type FlipStep, type FlipTurn } from '../../core/base/coords';
import type { Arrangement } from '../../state/clipboard';
import type { PasteDoor } from '../objects/arrangement';
import type { GroupRotation } from '../objects/group-rotation';
import { getCatalogItem } from '../../state/catalog';
import { getPlacedObjectSize } from '../../state/object-geometry';
import { heldBy, placeBlueprint, previewBlueprint, quietSink, type BlueprintLaid, type BlueprintPlacement, type BlueprintPreview } from './place';

/** The command that sets a laid cell back to what it held before the group: bare ground, or the
 *  plain block a placement only ever builds on. */
function restoreCommand(c: GroupMembers['cells'][number]): Command {
  const at = [{ x: c.x, y: c.y }];
  return c.prior && c.prior.type !== TerrainType.None ? paintTerrainCommand(at, c.prior.type, c.prior.elevation) : eraseTerrainCommand(at);
}

/** Runs `cmds` through `run`, each the rules accept, again and again while any lands, since one may
 *  wait on another (a house on a road, a block under a block). */
function runWhileAny(run: (cmd: Command) => boolean, cmds: Command[]): void {
  let left = cmds;
  while (left.length > 0) {
    const next = left.filter((cmd) => !run(cmd));
    if (next.length === left.length) return;
    left = next;
  }
}

/** Takes back the standing members of `group` through `door`, inside the caller's stroke: its
 *  objects first, then each of its cells set back to what it held before, each where the rules allow. */
function takeBack(door: PasteDoor, group: PlacedGroup): void {
  const { objects, cells } = liveMembers(door.state, group);
  const sink = quietSink(door);
  const run = (cmd: Command): boolean => sink.execute(cmd).success;
  runWhileAny(run, objects.map((o) => removeObjectCommand(o)));
  runWhileAny(run, cells.map(restoreCommand));
}

/** `state` as it would stand with `group`'s standing members taken back, on a detached copy. */
export function mapWithout(state: GridState, group: PlacedGroup): GridState {
  const { objects, cells } = liveMembers(state, group);
  const out = cloneGridState(state);
  for (const o of objects) out.objects.delete(o.id);
  for (const c of cells) {
    const cell = getCell(out.cells, c.x, c.y);
    if (cell) cell.terrain = c.prior ? cloneTerrain(c.prior) : null;
  }
  return out;
}

/**
 * Takes `group` back as one undo step: its standing members removed and its cells set back, with
 * what the rules kept in place still its group. False when nothing of it could be taken back.
 */
export function takeBackGroup(door: PasteDoor, group: PlacedGroup): boolean {
  return heldBy(door, () => takeBackNow(door, group));
}

function takeBackNow(door: PasteDoor, group: PlacedGroup): boolean {
  const stroke = door.beginStroke();
  try {
    takeBack(door, group);
  } catch (err) {
    stroke.rollback();
    throw err;
  }
  stroke.commit();
  if (stroke.size === 0) return false;
  const kept = prunedGroup(door.state, group);
  stroke.setGroups(mapGroups(door.state).flatMap((g) => (g.id !== group.id ? [g] : kept ? [kept] : [])));
  return true;
}

/** Where `group` lands turned a quarter about its frame's centre, clockwise for 1; truncated both
 *  ways, so four turns come back to where they began. */
export function turnedPlacement(group: PlacedGroup, turn: 1 | -1): BlueprintPlacement {
  const { x, y, w, h } = group.frame;
  return { at: { x: x + Math.trunc((w - h) / 2), y: y + Math.trunc((h - w) / 2) }, quarters: ((turn % 4) + 4) % 4 };
}

/** Where `group` lands moved whole, its frame's top-left to `at`. */
export function movedPlacement(at: MacroCoord): BlueprintPlacement {
  return { at, quarters: 0 };
}

/** Where `group` lands at the next press of Flip, about its frame's centre, which neither a mirror nor
 *  a half turn moves, what that press does and the place in the cycle it reaches. */
export function flippedPlacement(group: PlacedGroup): { p: BlueprintPlacement; turn: FlipTurn; flip: FlipStep } {
  const { next, turn } = flipPress(group.flip ?? 0);
  return { p: { at: { x: group.frame.x, y: group.frame.y }, ...turn }, turn, flip: next };
}

/** What `group` would lay as `p` asks (`groupRecipe`), judged on `without`, the map as it would stand
 *  without its standing members (`mapWithout`). */
export function previewGroupAt(door: PasteDoor, without: GridState, group: PlacedGroup, p: BlueprintPlacement): BlueprintPreview {
  const on: PasteDoor = {
    state: without, registry: door.registry,
    execute: () => { throw new Error('a preview lays nothing'); }, beginStroke: () => { throw new Error('a preview lays nothing'); },
  };
  return previewBlueprint(on, groupRecipe(door.state, group), p);
}

/** The turn `group`, just laid turned by `turn` (clockwise for 1), plays as the object group's rotation
 *  does: its standing objects arc a quarter about its frame's centre, each from where the rigid turn
 *  back from its landing puts it, since a member laid again is a new object. */
export function groupTurn(state: GridState, group: PlacedGroup, turn: 1 | -1): GroupRotation {
  const pivot = { x: group.frame.x + group.frame.w / 2, y: group.frame.y + group.frame.h / 2 };
  const members = liveMembers(state, group).objects.map((o) => {
    const size = getPlacedObjectSize(o);
    const dx = o.position.x + size.w / 2 - pivot.x, dy = o.position.y + size.h / 2 - pivot.y;
    // The inverse quarter turn of the landing centre about the pivot.
    return { id: o.id, from: { x: pivot.x + turn * dy, y: pivot.y - turn * dx }, spun: getCatalogItem(o.catalogId)?.rotatable ?? false };
  });
  return { pivot, sweepDeg: turn * 90, members };
}

/** The flip `group`, just laid flipped by `turn` about its frame's centre, plays as the object group's
 *  flip does: its standing objects open out from where the flip back from their landing puts them. */
export function groupFlip(state: GridState, group: PlacedGroup, turn: FlipTurn): GroupRotation {
  const pivot = { x: group.frame.x + group.frame.w / 2, y: group.frame.y + group.frame.h / 2 };
  const axes = { x: turn.mirror !== (turn.quarters === 2), y: turn.quarters === 2 };
  const members = liveMembers(state, group).objects.map((o) => {
    const size = getPlacedObjectSize(o);
    const cx = o.position.x + size.w / 2, cy = o.position.y + size.h / 2;
    return { id: o.id, from: { x: axes.x ? 2 * pivot.x - cx : cx, y: axes.y ? 2 * pivot.y - cy : cy }, spun: false };
  });
  return { pivot, sweepDeg: 0, members, flip: axes };
}

/**
 * Takes `group`'s standing members back and lays its recipe (`groupRecipe`) again as `p` asks (turned
 * or mirrored inside its frame, at its top-left), as one undo step that keeps the group under its id
 * with what landed, at `flip` in Flip's cycle (where it stood by default). Null, changing nothing,
 * when nothing of it lands.
 */
export function relayGroup(door: PasteDoor, group: PlacedGroup, p: BlueprintPlacement, flip = group.flip): BlueprintLaid | null {
  return heldBy(door, () => relayNow(door, group, p, flip));
}

function relayNow(door: PasteDoor, group: PlacedGroup, p: BlueprintPlacement, flip: PlacedGroup['flip']): BlueprintLaid | null {
  const body = groupRecipe(door.state, group);
  const stroke = door.beginStroke();
  let laid: BlueprintLaid;
  try {
    takeBack(door, group);
    laid = placeBlueprint(door, body, p, { id: group.id, blueprint: group.blueprint, name: group.name, origin: group.origin, flip });
  } catch (err) {
    stroke.rollback();
    throw err;
  }
  if (!laid.group) { stroke.rollback(); return null; }
  stroke.commit();
  return laid;
}

/** `group` copied whole (BLUE-07): what it would lay now (`groupRecipe`), framed as it stands, with
 *  the seed its copies record, so a paste lays a new group of the same blueprint under the same names. */
export function copyGroup(state: GridState, group: PlacedGroup): Arrangement {
  const body = groupRecipe(state, group);
  return {
    members: body.objects.map((o) => ({ ...o, ...(o.corners ? { corners: copyCorners(o.corners) } : null) })),
    w: body.w, h: body.h, origin: { x: group.frame.x, y: group.frame.y },
    group: { cells: body.cells, base: group.base, seed: { blueprint: group.blueprint, name: group.name, origin: group.origin } },
  };
}
