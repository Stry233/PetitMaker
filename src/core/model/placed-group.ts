/*
 * A placed blueprint kept as a group: what one placement laid, so it can be selected, turned, moved
 * and taken back as a whole long after the step that laid it. A group never claims a member by
 * position: its members are the objects and terrain cells it laid that still hold exactly what it
 * laid (`liveMembers`), and every edit that changes a member drops it from the record in the same
 * step (`groupsAfterEdit`), so a part repainted later as it was laid stays out, anything added later
 * never joins, and undo and redo bring members back with the step.
 */
import type { FlipStep } from '../base/coords';
import { footprintTerrain } from '../grid/footprint';
import { cellKey, type Rect } from '../grid/rect';
import { sameCorners } from './corners';
import { getCell, sameTerrain } from './grid-model';
import type { BlueprintBody, BlueprintCell, BlueprintObject } from './blueprint';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject, type TerrainCell } from './types';

/** One terrain cell a group laid: the terrain it laid there and what the cell held before. */
export interface GroupCell {
  readonly x: number;
  readonly y: number;
  readonly laid: TerrainCell;
  readonly prior: TerrainCell | null;
}

/** What a placement records of where its blueprint came from: the blueprint's id, its name as the
 *  page showed it, and the original author a save over it names as Adapted from (null for none). */
export interface GroupSeed {
  readonly blueprint: string;
  readonly name: string;
  readonly origin: string | null;
}

/** One placed blueprint: its seed, the object-grid frame it was laid in (turned), the ground height
 *  its rises stand on, and every object and terrain cell it laid, each as laid. */
export interface PlacedGroup extends GroupSeed {
  readonly id: string;
  readonly frame: Rect;
  readonly base: number;
  readonly objects: readonly PlacedObject[];
  readonly cells: readonly GroupCell[];
  /** What of the body it was last laid from did not land, in its frame as it stands, heights as
   *  rises above `base`; absent when all of it landed, or for a group a file kept without it. */
  readonly skipped?: BlueprintBody;
  /** Its place in Flip's cycle for the session; absent at the start. What it laid already stands
   *  flipped, so this says only which press comes next, and no save writes it. */
  readonly flip?: FlipStep;
}

/** The members of a group still standing: the objects and cells that hold exactly what it laid. */
export interface GroupMembers {
  readonly objects: readonly PlacedObject[];
  readonly cells: readonly GroupCell[];
}

/** Whether `now` stands exactly as `laid` was laid. */
function sameObject(now: PlacedObject, laid: PlacedObject): boolean {
  return now.id === laid.id && now.catalogId === laid.catalogId && now.position.x === laid.position.x
    && now.position.y === laid.position.y && now.rotation === laid.rotation && now.elevation === laid.elevation
    && now.spanLength === laid.spanLength && !!now.patchOnly === !!laid.patchOnly
    && (now.corners && laid.corners ? sameCorners(now.corners, laid.corners) : now.corners === laid.corners);
}

/** Whether the cell `c` names still holds what the group laid there. */
function cellHolds(state: GridState, c: GroupCell): boolean {
  return sameTerrain(getCell(state.cells, c.x, c.y)?.terrain, c.laid, { patchOnly: 'exact' });
}

/** The members of `group` still standing on `state`. */
export function liveMembers(state: GridState, group: PlacedGroup): GroupMembers {
  return {
    objects: group.objects.filter((o) => { const now = state.objects.get(o.id); return !!now && sameObject(now, o); }),
    cells: group.cells.filter((c) => cellHolds(state, c)),
  };
}

/** Whether anything of `group` still stands on `state`. */
export function groupStands(state: GridState, group: PlacedGroup): boolean {
  return group.objects.some((o) => { const now = state.objects.get(o.id); return !!now && sameObject(now, o); })
    || group.cells.some((c) => cellHolds(state, c));
}

/** The groups of `state`; none on a map that never had one. */
export function mapGroups(state: GridState): readonly PlacedGroup[] {
  return state.groups ?? [];
}

/** The group whose frame holds the object-grid cell `at`, the one placed last where frames overlap,
 *  or null. Every group the map keeps still has something standing. */
export function groupAt(state: GridState, at: MacroCoord): PlacedGroup | null {
  const groups = mapGroups(state);
  for (let i = groups.length - 1; i >= 0; i--) {
    const { frame } = groups[i]!;
    if (at.x >= frame.x && at.y >= frame.y && at.x < frame.x + frame.w && at.y < frame.y + frame.h) return groups[i]!;
  }
  return null;
}

/** The standing group `on` (an object id, or a terrain cell) is a live member of, or null. */
export function groupOf(state: GridState, on: { object: string } | { cell: MacroCoord }): PlacedGroup | null {
  for (const g of mapGroups(state)) {
    if ('object' in on) {
      const laid = g.objects.find((o) => o.id === on.object);
      const now = laid && state.objects.get(laid.id);
      if (laid && now && sameObject(now, laid)) return g;
    } else {
      const c = g.cells.find((m) => m.x === on.cell.x && m.y === on.cell.y);
      if (c && cellHolds(state, c)) return g;
    }
  }
  return null;
}

/** `group` cut down to its members still standing on `state`, or null when nothing of it stands. */
export function prunedGroup(state: GridState, group: PlacedGroup): PlacedGroup | null {
  const { objects, cells } = liveMembers(state, group);
  if (objects.length === 0 && cells.length === 0) return null;
  return objects.length === group.objects.length && cells.length === group.cells.length ? group : { ...group, objects, cells };
}

/** The body the standing members of `group` make in its frame, heights as rises above its base. A
 *  cell laid as mountain at the base is a footing, which a placement lays again for the objects that
 *  need it, so it holds nothing of its own. */
export function groupBody(state: GridState, group: PlacedGroup): BlueprintBody {
  const { frame, base } = group;
  const { objects, cells } = liveMembers(state, group);
  const area = footprintTerrain(frame);
  const body: (BlueprintCell | null)[] = new Array<BlueprintCell | null>(area.w * area.h).fill(null);
  for (const c of cells) {
    const t = c.laid;
    if (t.type === TerrainType.Mountain && t.elevation <= base) continue;
    body[(c.y - area.y) * area.w + (c.x - area.x)] = {
      type: t.type,
      rise: t.elevation - base,
      ...(t.corners ? { corners: t.corners } : null),
      ...(t.patchOnly ? { patchOnly: true } : null),
      ...(t.patchBase !== undefined ? { patchBase: t.patchBase - base } : null),
    };
  }
  const placed: BlueprintObject[] = objects.map((o) => ({
    catalogId: o.catalogId, x: o.position.x - frame.x, y: o.position.y - frame.y, rotation: o.rotation, rise: o.elevation - base,
    ...(o.spanLength !== undefined ? { spanLength: o.spanLength } : null),
    ...(o.corners ? { corners: o.corners } : null),
  }));
  return { w: frame.w, h: frame.h, cells: body, objects: placed };
}

/** `group`, just laid from `body` (in its frame, at its turn), with what of `body` its members do
 *  not hold kept as `skipped`. An object is held by a member standing where the body puts it. */
export function withSkipped(group: PlacedGroup, body: BlueprintBody): PlacedGroup {
  const { frame, base } = group;
  const area = footprintTerrain(frame);
  const laid = new Set(group.cells.map((c) => cellKey(c.x, c.y)));
  const cells = body.cells.map((c, i) => (c && !laid.has(cellKey(area.x + (i % area.w), area.y + Math.floor(i / area.w))) ? c : null));
  const unmatched = [...group.objects];
  const objects = body.objects.filter((o) => {
    const at = unmatched.findIndex((m) => m.catalogId === o.catalogId && m.position.x === frame.x + o.x && m.position.y === frame.y + o.y
      && m.rotation === o.rotation && m.elevation === base + o.rise);
    if (at < 0) return true;
    unmatched.splice(at, 1);
    return false;
  });
  if (objects.length === 0 && cells.every((c) => c === null)) return group;
  return { ...group, skipped: { w: body.w, h: body.h, cells, objects } };
}

/** What a turn, a move or a copy of `group` lays: its standing members (`groupBody`) and what its
 *  last laying skipped. A member the player changed is in neither, so it never comes back. */
export function groupRecipe(state: GridState, group: PlacedGroup): BlueprintBody {
  const held = groupBody(state, group);
  const { skipped } = group;
  if (!skipped) return held;
  return {
    ...held,
    cells: held.cells.map((c, i) => c ?? skipped.cells[i] ?? null),
    objects: [...held.objects, ...skipped.objects],
  };
}

/** Each group's member ids and cell keys, for an edit to find the groups it touches. */
const indexes = new WeakMap<PlacedGroup, { objects: Set<string>; cells: Set<string> }>();

function indexOf(group: PlacedGroup): { objects: Set<string>; cells: Set<string> } {
  let index = indexes.get(group);
  if (!index) {
    index = { objects: new Set(group.objects.map((o) => o.id)), cells: new Set(group.cells.map((c) => cellKey(c.x, c.y))) };
    indexes.set(group, index);
  }
  return index;
}

/** The map's groups after an edit that touched `objects` (ids) and `cells`: each group cut down to
 *  its members still standing, and a group with none left dropped; null when no group changed. */
export function groupsAfterEdit(state: GridState, objects: readonly string[], cells: readonly MacroCoord[]): readonly PlacedGroup[] | null {
  const groups = state.groups;
  if (!groups || groups.length === 0) return null;
  let changed = false;
  const next = groups.flatMap((g) => {
    const index = indexOf(g);
    if (!objects.some((id) => index.objects.has(id)) && !cells.some((c) => index.cells.has(cellKey(c.x, c.y)))) return [g];
    const kept = prunedGroup(state, g);
    if (kept !== g) changed = true;
    return kept ? [kept] : [];
  });
  return changed ? next : null;
}
