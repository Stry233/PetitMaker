/*
 * Where objects a load took off the map (or a hand repair left standing illegally) could stand
 * again, and putting them there. The planner is pure: it judges every spot on a copy of the map
 * through the rule registry it is handed, as a placement would be judged, and returns the plan.
 * `applyRelocation` lands a plan on a map through that map's executor as one undo step.
 */
import type { CommandExecutor } from '../core/commands/command-executor';
import { paintTerrainCommand, placeObjectCommand, removeObjectCommand } from '../core/model/command-build';
import { copyCorners } from '../core/model/corners';
import {
  bumpCellsVersion, bumpObjectsVersion, cloneGridState, clonePlacedObject, CLEARING_ELEVATION, createDefaultTerrainCell,
} from '../core/model/grid-model';
import { structuralTop } from '../core/domain/terrain/terrain-surface';
import { isLaidLandmark } from '../core/model/landmarks';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import { findTrait, isCoating } from '../core/model/traits';
import { holdsTemplateTerrain } from '../core/model/template';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject, type ValidationError } from '../core/model/types';
import { ProvSource, type SourceContext } from '../core/provenance/types';
import { cellKey, rectsOverlap, type Rect } from '../core/grid/rect';
import { GRIDS } from '../core/game/profile';
import { getAllItems, getCatalogItem } from './catalog';
import { createExecutor } from './executor';
import { objectRect, surfaceElevationAt } from './object-geometry';
import { entriesCovering, entriesNear, getObjectIndex } from './object-index';

/** How far from the spot its shift points it to an object may be planned, in cells. */
export const RELOCATION_RADIUS = 16;

/** An object to plan for, and the shift its first tries follow: the move of the landmark it made
 *  room for, in cells, or none when that is unknown. */
export interface RelocationItem { object: PlacedObject; shift: MacroCoord }

/**
 * Where the plan puts one object. `pattern-shift`: the object's whole pattern (`patternsOf`) moves
 * by `shift`, members the load did not take included, so the pattern keeps its shape. `group-shift`:
 * the pattern's taken members move by `shift` together. `single-move`: no shift fitted and it goes
 * alone. `no-place`: no legal spot within `RELOCATION_RADIUS`; landing the plan leaves it off the
 * map. `to` is the object as it would land (its elevation read from the ground there).
 */
export type RelocationProposal =
  | { kind: 'pattern-shift'; shift: MacroCoord; to: PlacedObject }
  | { kind: 'group-shift'; shift: MacroCoord; to: PlacedObject }
  | { kind: 'single-move'; to: PlacedObject }
  | { kind: 'no-place' };

/** One object's plan; `group` indexes the members that land together, in plan order. */
export interface PlannedMove { id: string; group: number; proposal: RelocationProposal }

/** The plan, in the order it lands. It may move objects beside the items: their pattern's members. */
export interface RelocationPlan { moves: PlannedMove[] }

/** What landing a plan did: objects moved to their planned spots, planned objects that were off the
 *  map and stay off it (no place, or a spot taken since the plan was made), and `unplanned`, objects
 *  the closing check took off because they stood against the rules all the same (none for a plan
 *  made on the map it lands on). */
export interface RelocationResult { moved: number; removed: number; unplanned: number }

/** The relocation's authorship: the editor's own repair, so each object keeps the taint it had. */
const REPAIR: SourceContext = { source: ProvSource.AutoRepair };

/** "rule|x,y" for every cell a violation names. */
function violationKeys(violations: readonly ValidationError[]): Set<string> {
  const keys = new Set<string>();
  for (const v of violations) for (const c of v.cells) keys.add(`${v.ruleId}|${cellKey(c.x, c.y)}`);
  return keys;
}

/** `o` moved by (dx, dy), standing on the ground there, sharing nothing mutable with `o`. */
function shifted(state: GridState, o: PlacedObject, dx: number, dy: number): PlacedObject {
  const x = o.position.x + dx, y = o.position.y + dy;
  return {
    ...o, position: { x, y }, elevation: surfaceElevationAt(state, x, y),
    ...(o.corners ? { corners: copyCorners(o.corners) } : {}),
  };
}

/** `state` as a placement probe reads it with `members` taken off: a view sharing the cells. */
function viewWithout(state: GridState, members: readonly PlacedObject[]): GridState {
  const objects = new Map(state.objects);
  const off = members.filter((o) => objects.delete(o.id));
  const view: GridState = { ...state, objects, objectsDelta: undefined };
  bumpObjectsVersion(view, { removed: off });
  return view;
}

/** Where a landing happens: the map, its executor, its landmarks' footprints and the post-stroke check. */
interface Landing { state: GridState; ex: CommandExecutor; landmarks: readonly Rect[]; holds: () => boolean }

/**
 * Lands `moved` (the members' new copies) on `state` through `ex`, all or none: each copy must pass
 * the pre-command rules on the map without the members, the members standing on the map are lifted,
 * and the map then breaks no post-stroke rule it did not break before (`holds`). Returns the objects
 * as they landed, or null with the map as it was.
 */
function landAll({ state, ex, landmarks, holds }: Landing, moved: readonly PlacedObject[], probe: GridState = state): PlacedObject[] | null {
  const rules = ex.getRegistry();
  const { width, height } = state.template;
  for (const o of moved) {
    const r = objectRect(o);
    if (r.x < 0 || r.y < 0 || r.x + r.w > width || r.y + r.h > height) return null;
    if (landmarks.some((l) => rectsOverlap(l, r))) return null;
  }
  for (const o of moved) {
    if (rules.validatePreCommand(rules.resolve(placeObjectCommand(o), probe), probe).length > 0) return null;
  }
  return ex.transaction({}, (tx) => {
    for (const o of moved) {
      if (state.objects.has(o.id) && !ex.execute(removeObjectCommand(o)).success) { tx.rollback(); return null; }
    }
    for (const o of moved) {
      if (!ex.execute(placeObjectCommand(o)).success) { tx.rollback(); return null; }
    }
    if (!holds()) { tx.rollback(); return null; }
    return moved.map((o) => clonePlacedObject(state.objects.get(o.id)!));
  });
}

/** The map rects of the cells `v` names as evidence, on the grid it names them on. */
export function evidenceBoxes(v: ValidationError): Rect[] {
  const grid: { offset: MacroCoord; size?: number } = GRIDS[v.grid];
  const size = grid.size ?? 1;
  return v.cells.map((c) => ({ x: c.x * size + grid.offset.x, y: c.y * size + grid.offset.y, w: size, h: size }));
}

/** The footprints of the landmarks `state` lays. */
const landmarkRects = (state: GridState): Rect[] => [...state.objects.values()].filter(isLaidLandmark).map((l) => objectRect(l));

/** A check that `state` breaks no post-stroke rule beyond those it breaks now. */
function holdsAgainstNow(state: GridState, rules: RuleDispatcher): () => boolean {
  const baseline = violationKeys(rules.validatePostStroke(state));
  return baseline.size === 0
    ? () => rules.validatePostStroke(state, { firstOnly: true }).length === 0
    : () => [...violationKeys(rules.validatePostStroke(state))].every((k) => baseline.has(k));
}

/**
 * Plans where `items` could stand on `state` without changing it. Each item belongs to one pattern
 * (`patternsOf`); a pattern tries rigid shifts, its own `shift` rounded to whole cells first and then
 * the shifts nearest it within `RELOCATION_RADIUS`, first with every member when it follows a
 * landmark's move, then with its items alone, and takes the first where each moved copy passes the rules. Items no shift fits are planned
 * one at a time, each at the nearest such spot. Each spot is judged with the earlier ones taken, so
 * the plan lands as a whole. Deterministic: one map and one item list give one plan.
 */
export function planRelocation(state: GridState, rules: RuleDispatcher, items: readonly RelocationItem[]): RelocationPlan {
  const scratch = cloneGridState(state);
  // The regional load limit is no legality rule: a full region trips its own notice, never the repair.
  scratch.ignoreChunkLoad = true;
  // An item still standing on the map (one left to place by hand) is planned as if it were off it.
  const lifted = items.flatMap((i) => (scratch.objects.has(i.object.id) ? [scratch.objects.get(i.object.id)!] : []));
  for (const o of lifted) scratch.objects.delete(o.id);
  if (lifted.length > 0) bumpObjectsVersion(scratch, { removed: lifted });
  const ex = createExecutor(scratch, rules);
  const holds = holdsAgainstNow(scratch, rules);
  const landing: Landing = { state: scratch, ex, landmarks: landmarkRects(scratch), holds };
  const shiftOf = new Map(items.map((i) => [i.object.id, i.shift]));
  const moves: PlannedMove[] = [];
  let group = 0;
  const tryShifts = (members: readonly PlacedObject[], candidates: readonly MacroCoord[], kind: 'pattern-shift' | 'group-shift'): boolean => {
    const probe = viewWithout(scratch, members);
    const rects = members.map((o) => objectRect(o));
    const { width, height } = scratch.template;
    // A shift that takes a footprint off the map or onto a landmark is passed over before any copy is made.
    const clear = (dx: number, dy: number): boolean => rects.every((r) => {
      const at = { x: r.x + dx, y: r.y + dy, w: r.w, h: r.h };
      return at.x >= 0 && at.y >= 0 && at.x + at.w <= width && at.y + at.h <= height && !landing.landmarks.some((l) => rectsOverlap(l, at));
    });
    for (const { x, y } of candidates) {
      if (!clear(x, y)) continue;
      const landed = landAll(landing, members.map((o) => shifted(scratch, o, x, y)), probe);
      if (!landed) continue;
      for (const to of landed) moves.push({ id: to.id, group, proposal: { kind, shift: { x, y }, to } });
      group++;
      return true;
    }
    return false;
  };
  ex.transaction({ silent: true, source: REPAIR }, () => {
    for (const { members, taken } of patternsOf(scratch, items.map((i) => i.object))) {
      const shift = shiftOf.get(taken[0]!.id)!;
      const candidates = shiftsNear(shift, RELOCATION_RADIUS);
      // A pattern moves whole only to follow its landmark's move; without one, moving members the
      // load did not take would only nudge the visitor's work.
      const follows = shift.x !== 0 || shift.y !== 0;
      if (follows && members.length > taken.length && tryShifts(members, candidates, 'pattern-shift')) continue;
      if (tryShifts(taken, candidates, 'group-shift')) continue;
      for (const o of taken) {
        let landed: PlacedObject[] | null = null;
        for (const { x, y } of candidates) {
          landed = landAll(landing, [shifted(scratch, o, x, y)]);
          if (landed) break;
        }
        moves.push({ id: o.id, group: group++, proposal: landed ? { kind: 'single-move', to: landed[0]! } : { kind: 'no-place' } });
      }
    }
  });
  return { moves: withdrawUntilLegal(state, scratch, rules, moves) };
}

/** The unlocked objects of `state`, in map order. */
const unlockedIds = (state: GridState): string[] => [...state.objects.values()].filter((o) => !o.locked).map((o) => o.id);

/** How far an object's footprint reaches into another's legality, in cells: the widest spacing an
 *  item keeps from its kind, and a cell for touching. Terrain, which the door and flatness rules
 *  read, no landing changes. */
function legalityReach(): number {
  let widest = 0;
  for (const item of getAllItems()) widest = Math.max(widest, findTrait(item, 'exclusionRadius')?.radius ?? 0);
  return widest + 1;
}

/** The unlocked objects of `state` whose legality an object at `rects` can change, in map order. */
export function idsNear(state: GridState, rects: readonly Rect[]): string[] {
  if (rects.length === 0) return [];
  const reach = legalityReach();
  const index = getObjectIndex(state);
  const ids = new Set<string>();
  for (const r of rects) {
    const around = { x: r.x - reach, y: r.y - reach, w: r.w + 2 * reach, h: r.h + 2 * reach };
    for (const e of entriesNear(index, around)) if (!e.obj.locked && rectsOverlap(e.rect, around)) ids.add(e.obj.id);
  }
  return [...state.objects.keys()].filter((id) => ids.has(id));
}

/**
 * `moves` with the last landed groups withdrawn until every object on `scratch` (the plan landed on
 * `state`'s copy) within reach of a landing (`idsNear`) stands legally: a withdrawn group's items stay
 * off the map and the members it would have moved stay where `state` has them. Each round withdraws
 * one group, so it ends within the plan's group count, and the plan with no landing at all leaves the
 * map as the caller made it.
 */
function withdrawUntilLegal(state: GridState, scratch: GridState, rules: RuleDispatcher, moves: PlannedMove[]): PlannedMove[] {
  let plan = moves;
  const landed = () => plan.flatMap((m) => (m.proposal.kind === 'no-place' ? [] : [objectRect(m.proposal.to)]));
  while (standingViolations(scratch, rules, idsNear(scratch, landed())).size > 0) {
    const last = plan.reduce((g, m) => (m.proposal.kind === 'no-place' ? g : Math.max(g, m.group)), -1);
    if (last < 0) break;
    const group = plan.filter((m) => m.group === last);
    const off = group.flatMap((m) => { const o = scratch.objects.get(m.id); return o ? [o] : []; });
    for (const o of off) scratch.objects.delete(o.id);
    const back = group.flatMap((m) => { const o = state.objects.get(m.id); return o ? [clonePlacedObject(o)] : []; });
    for (const o of back) scratch.objects.set(o.id, o);
    bumpObjectsVersion(scratch, { removed: off, added: back });
    plan = plan.flatMap((m) => (m.group !== last ? [m] : state.objects.has(m.id) ? [] : [{ ...m, proposal: { kind: 'no-place' as const } }]));
  }
  return plan;
}

/**
 * Lands `plan` on `state` through its executor `ex` as one undo step: each planned object goes to
 * its planned spot, lifted first where it stands. The members of one group land together or not at
 * all; a group that no longer fits (a spot taken since the plan) is left as it is, and a planned
 * object off the map that does not land stays off it.
 */
export function applyRelocation(ex: CommandExecutor, state: GridState, plan: RelocationPlan): RelocationResult {
  // The plan was judged without the regional load limit, so it lands without it.
  const enforced = state.ignoreChunkLoad;
  state.ignoreChunkLoad = true;
  try {
    return landPlan(ex, state, plan);
  } finally {
    if (enforced === undefined) delete state.ignoreChunkLoad; else state.ignoreChunkLoad = enforced;
  }
}

function landPlan(ex: CommandExecutor, state: GridState, plan: RelocationPlan): RelocationResult {
  return ex.transaction({ silent: true, source: REPAIR }, (stroke) => {
    const landing: Landing = { state, ex, landmarks: landmarkRects(state), holds: holdsAgainstNow(state, ex.getRegistry()) };
    const groups = new Map<number, PlacedObject[]>();
    let removed = 0;
    for (const m of plan.moves) {
      if (m.proposal.kind === 'no-place') { if (!state.objects.has(m.id)) removed++; continue; }
      const members = groups.get(m.group);
      if (members) members.push(clonePlacedObject(m.proposal.to));
      else groups.set(m.group, [clonePlacedObject(m.proposal.to)]);
    }
    let moved = 0;
    for (const members of groups.values()) {
      const off = members.filter((o) => !state.objects.has(o.id)).length;
      if (landAll(landing, members, viewWithout(state, members))) moved += members.length;
      else removed += off;
    }
    const unplanned = takeIllegal(ex, state, plan.moves.flatMap((m) => {
      const at = state.objects.get(m.id);
      return [...(at ? [objectRect(at)] : []), ...(m.proposal.kind === 'no-place' ? [] : [objectRect(m.proposal.to)])];
    }));
    if (stroke.size > 0) stroke.collapse();
    return { moved, removed, unplanned };
  });
}

/**
 * The closing check of every landing: what still stands against the rules (`standingViolations`)
 * within reach of the plan's spots, where they were and where they land (`idsNear`), comes off the
 * map through `ex`, round after round, each round reading around what the last one took. Each takes
 * at least one object or ends, so it stops within the map's object count. How many it took.
 */
function takeIllegal(ex: CommandExecutor, state: GridState, spots: readonly Rect[]): number {
  const rules = ex.getRegistry();
  let taken = 0;
  let around = spots;
  for (;;) {
    const bad = [...standingViolations(state, rules, idsNear(state, around)).keys()];
    around = bad.map((id) => objectRect(state.objects.get(id)!));
    const took = bad.filter((id) => ex.execute(removeObjectCommand({ id })).success).length;
    taken += took;
    if (took === 0) return taken;
  }
}

/**
 * The cells whose own terrain the rules refuse where it stands: each is judged as a paint of its
 * column (its structural top, its cuts aside) onto a view of `state` where it already holds that
 * column, with no object on it and no layer locked, so what the terrain is decides and not how it
 * was laid or who may edit it now. A cell that holds its template's terrain is the planet's own and
 * never among them.
 */
export function illegalTerrain(state: GridState, rules: RuleDispatcher): MacroCoord[] {
  const byKind = new Map<string, { type: TerrainType; elevation: number; cells: MacroCoord[] }>();
  const cells = state.cells.map((row, y) => row.map((cell, x) => {
    const t = cell.terrain;
    if (!t || holdsTemplateTerrain(state.template, x, y, cell)) return cell;
    const elevation = structuralTop(t);
    if (t.type === TerrainType.Mountain && elevation <= CLEARING_ELEVATION) return cell;
    const key = `${t.type}|${elevation}`;
    const kind = byKind.get(key) ?? { type: t.type, elevation, cells: [] };
    kind.cells.push({ x, y });
    byKind.set(key, kind);
    return { ...cell, terrain: createDefaultTerrainCell(t.type, elevation) };
  }));
  const view: GridState = { ...state, cells, objects: new Map(), objectsDelta: undefined, lockedLayers: new Set() };
  bumpObjectsVersion(view);
  bumpCellsVersion(view);
  const out = new Map<string, MacroCoord>();
  for (const { type, elevation, cells: at } of byKind.values()) {
    for (const v of rules.validatePreCommand(paintTerrainCommand(at, type, elevation), view)) {
      for (const c of v.cells) out.set(cellKey(c.x, c.y), { x: c.x, y: c.y });
    }
  }
  return [...out.values()];
}

/** Whether `state` stands wholly within the rules: no unlocked object a placement where it stands
 *  refuses, overlapping a landmark or under a post-stroke flag, no terrain the rules refuse
 *  (`illegalTerrain`) and no post-stroke violation. */
export function isLegalMap(state: GridState, rules: RuleDispatcher): boolean {
  return rules.validatePostStroke(state, { firstOnly: true }).length === 0
    && illegalTerrain(state, rules).length === 0
    && standingViolations(state, rules, unlockedIds(state)).size === 0;
}

/**
 * The ids among `ids` that stand on `state` and do not stand there legally: the placement rules
 * refuse the object where it stands with itself taken off the map, it overlaps a landmark, or a
 * post-stroke rule flags a cell under it. An id off the map is not among them.
 */
export function unresolved(state: GridState, rules: RuleDispatcher, ids: Iterable<string>): string[] {
  return [...standingViolations(state, rules, ids).keys()];
}

/** The landmark-footprint check's name beside the rule ids `standingViolations` reports. */
export const UNDER_LANDMARK = 'landmark';

/**
 * `unresolved` with the reason for each: the first rule a placement where the object stands refuses,
 * `UNDER_LANDMARK` when it overlaps a landmark's footprint, else the post-stroke rule that flags a
 * cell under it. The same rules a fresh placement and a finished stroke answer to, nothing else.
 */
export function standingViolations(state: GridState, rules: RuleDispatcher, ids: Iterable<string>): Map<string, string> {
  const landmarks = landmarkRects(state);
  const flagged = rules.validatePostStroke(state).flatMap((v) => evidenceBoxes(v).map((box) => ({ box, rule: v.ruleId })));
  const index = getObjectIndex(state);
  const out = new Map<string, string>();
  for (const id of ids) {
    const o = state.objects.get(id);
    if (!o) continue;
    const r = objectRect(o);
    // A solid over a coating is the post-stroke rule's to judge (V-PLACE-COATED): a placement lets a
    // solid land over coatings and refuses a coating under a solid, so the pair's order is not a
    // reading of the map. A coating is judged with the solids over it taken off.
    const item = getCatalogItem(o.catalogId);
    const over = item && isCoating(item)
      ? entriesCovering(index, r).filter((e) => !e.coating && e.obj.id !== id && rectsOverlap(e.rect, r)).map((e) => e.obj)
      : [];
    const probe = over.length > 0 ? viewWithout(state, over) : state;
    // Judged where it stands as the rules judge an object re-described in place: lifted by its own
    // stroke, so it is no overlap with itself and its load is credited as a move's.
    const refused = rules.validatePreCommand(rules.resolve(placeObjectCommand(o), probe), probe, { lifted: new Map([[id, o]]) })[0]?.ruleId;
    const reason = refused ?? (landmarks.some((l) => rectsOverlap(l, r)) ? UNDER_LANDMARK : flagged.find((f) => rectsOverlap(f.box, r))?.rule);
    if (reason) out.set(id, reason);
  }
  return out;
}

/** The whole-cell shifts within `radius` of `shift`, nearest it first; a tie goes to the shorter
 *  move, then to reading order, so every run tries them in the same order. */
function shiftsNear(shift: MacroCoord, radius: number): MacroCoord[] {
  const out: { x: number; y: number; off: number; len: number }[] = [];
  for (let y = Math.floor(shift.y - radius); y <= Math.ceil(shift.y + radius); y++) {
    for (let x = Math.floor(shift.x - radius); x <= Math.ceil(shift.x + radius); x++) {
      const off = Math.hypot(x - shift.x, y - shift.y);
      if (off <= radius) out.push({ x, y, off, len: Math.hypot(x, y) });
    }
  }
  out.sort((a, b) => a.off - b.off || a.len - b.len || a.y - b.y || a.x - b.x);
  return out.map(({ x, y }) => ({ x, y }));
}

/** Whether two footprints touch, edge or corner, or overlap: the 8-neighbour contact of patterns. */
function touching(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

/** A pattern: the objects that move as one, with the taken ones among them. */
interface Pattern { members: PlacedObject[]; taken: PlacedObject[] }

/**
 * `taken`'s patterns on `state` (which does not hold them): for each item a taken object is, the
 * objects of that item, taken or standing unlocked on the map, joined by touching footprints; a
 * component holding a taken object is a pattern, so a frame of one paving moves as one while
 * neighbours of other items stay. Patterns come in the order of their first taken object, and each
 * lists its solids before its coatings, so a coating lands after whatever stands on it.
 */
export function patternsOf(state: GridState, taken: readonly PlacedObject[]): Pattern[] {
  const isTaken = new Set(taken.map((o) => o.id));
  const index = getObjectIndex(state);
  const seen = new Set<string>();
  const patterns: { first: number; members: PlacedObject[] }[] = [];
  taken.forEach((start, first) => {
    if (seen.has(start.id)) return;
    const members: PlacedObject[] = [];
    const queue = [start];
    seen.add(start.id);
    while (queue.length > 0) {
      const o = queue.pop()!;
      members.push(o);
      const r = objectRect(o);
      const near = [
        ...taken.filter((t) => t.catalogId === start.catalogId),
        ...entriesNear(index, { x: r.x - 1, y: r.y - 1, w: r.w + 2, h: r.h + 2 })
          .map((e) => e.obj).filter((n) => n.catalogId === start.catalogId && !n.locked),
      ];
      for (const n of near) {
        if (seen.has(n.id) || !touching(r, objectRect(n))) continue;
        seen.add(n.id);
        queue.push(n);
      }
    }
    patterns.push({ first, members });
  });
  const coating = (o: PlacedObject): boolean => {
    const item = getCatalogItem(o.catalogId);
    return !!item && isCoating(item);
  };
  const order = (list: PlacedObject[]) => [...list.filter((o) => !coating(o)), ...list.filter(coating)];
  return patterns.sort((a, b) => a.first - b.first).map(({ members }) => {
    const ordered = order(members);
    return { members: ordered, taken: ordered.filter((o) => isTaken.has(o.id)) };
  });
}
