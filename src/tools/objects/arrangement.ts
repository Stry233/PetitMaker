/*
 * Copy and paste as map edits: an arrangement taken off the map, planned where it would stand and
 * placed whole, and the nearest open ground it fits on. Validates through the registry and never
 * toasts; `editor/editing/clipboard.ts` reports.
 *
 * A copy keeps its members' heights relative to one another (EDIT-58): each member stands on the
 * ground under it, and the copy fits only where that ground keeps the differences the originals
 * had, so an arrangement from one layer never splits across a cliff.
 */
import type { Stroke } from '../../core/commands/command-executor';
import type { CommandSink } from '../../core/model/command-sink';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { type Command, type GridState, type MacroCoord, type PlacedObject, type Refusal, type ValidationError } from '../../core/model/types';
import { generateObjectId } from '../../core/model/object-id';
import { getFootprint } from '../../core/grid/footprint';
import { cellKey } from '../../core/grid/rect';
import { evidenceOn } from '../../core/grid/grids';
import { PLACEMENT_GRID } from '../../core/game/profile';
import { isCoatingItem } from '../../core/model/traits';
import { getCatalogItem } from '../../state/catalog';
import { getObjectIndex, entriesNear } from '../../state/object-index';
import { isSelfSized, objectElevation, objectRect, snapsOwnPlacement, surfaceElevationAt } from '../../state/object-geometry';
import { groupBounds, groupMembers } from '../../state/selection';
import type { Arrangement, CopiedMember } from '../../state/clipboard';
import { coatingStripFor, strippableRefusal } from '../placement/coatings';
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';

/** How far, in placement cells, a paste that does not fit where it was asked looks for open ground. */
const PASTE_REACH = 10;

/** What a copy took: the arrangement (null when nothing could be copied), where its outline's
 *  top-left stood on the map, and how many selected objects it left out. */
export interface CopyResult {
  arrangement: Arrangement | null;
  origin: MacroCoord;
  leftOut: number;
}

/**
 * The objects `ids` as an arrangement. An object whose shape belongs to its map (a self-sized
 * landmark) or whose item is unknown is left out. Heights are read live (`objectElevation`), so a
 * stale stored elevation never skews the copy.
 */
export function copyArrangement(state: GridState, ids: readonly string[]): CopyResult {
  const all = groupMembers(state, ids);
  const kept = all.filter((obj) => !isSelfSized(obj) && getCatalogItem(obj.catalogId));
  if (kept.length === 0) return { arrangement: null, origin: { x: 0, y: 0 }, leftOut: all.length };
  const { minX, minY, maxX, maxY } = groupBounds(kept);
  const origin = { x: Math.floor(minX), y: Math.floor(minY) };
  const heights = kept.map((obj) => objectElevation(state, obj));
  const floor = Math.min(...heights);
  const members = kept.map((obj, i): CopiedMember => ({
    catalogId: obj.catalogId,
    x: obj.position.x - origin.x,
    y: obj.position.y - origin.y,
    rotation: obj.rotation,
    rise: heights[i]! - floor,
    ...(obj.spanLength ? { spanLength: obj.spanLength } : null),
    ...(obj.corners ? { corners: [...obj.corners] as CopiedMember['corners'] } : null),
  }));
  return {
    arrangement: { members, w: Math.ceil(maxX) - origin.x, h: Math.ceil(maxY) - origin.y, origin },
    origin,
    leftOut: all.length - kept.length,
  };
}

/** `members` moved so their outline starts at the origin, with the whole cells it covers; null
 *  for no members. `origin`, where the members' own origin stood on the map, moves with them. */
export function arrangementOf(members: readonly CopiedMember[], origin?: MacroCoord): Arrangement | null {
  if (members.length === 0) return null;
  const { minX, minY, maxX, maxY } = groupBounds(members.map((m, i) => memberAt(m, { x: 0, y: 0 }, `m${i}`)));
  const ox = Math.floor(minX), oy = Math.floor(minY);
  return {
    members: members.map((m) => ({ ...m, x: m.x - ox, y: m.y - oy })),
    w: Math.ceil(maxX) - ox, h: Math.ceil(maxY) - oy,
    ...(origin ? { origin: { x: origin.x + ox, y: origin.y + oy } } : null),
  };
}

/** A member as an object standing with its anchor at `at` plus its offset; `elevation` is filled by
 *  the plan. */
function memberAt(m: CopiedMember, at: MacroCoord, id: string): PlacedObject {
  return {
    id, catalogId: m.catalogId, position: { x: at.x + m.x, y: at.y + m.y }, rotation: m.rotation, elevation: 0,
    ...(m.spanLength ? { spanLength: m.spanLength } : null),
    ...(m.corners ? { corners: [...m.corners] as PlacedObject['corners'] } : null),
  };
}

/** A copy planned at one place: the objects it would place, whether the rules take all of them, and
 *  what refused it. */
interface PastePlan {
  /** The outline's top-left on the map. */
  at: MacroCoord;
  /** The members that would be placed, standing where the plan puts them. */
  objects: PlacedObject[];
  valid: boolean;
  /** The first refused command and its errors, for the caller to report. */
  refusal: Refusal | null;
  /** Members left out because the map holds as many of their item as it may (EDIT-59). */
  capped: number;
  /** The layer the copy's lowest member stands on, or null where the ground disagrees. */
  level: number | null;
}

/** A synthetic error for members whose ground breaks the copy's height differences: it carries a
 *  rule's shape so the toast and the error flash read it unchanged. */
function groundRefusal(objects: readonly PlacedObject[]): ValidationError {
  const cells = objects.flatMap((obj) => {
    const r = objectRect(obj);
    return getFootprint(r.x, r.y, r.w, r.h);
  });
  return { ruleId: 'V-PASTE-GROUND', message: 'error.paste_ground', ...evidenceOn(PLACEMENT_GRID, cells) };
}

/** Whether any object covers part of `obj`'s footprint. */
function coversObject(state: GridState, obj: PlacedObject): boolean {
  const r = objectRect(obj);
  return entriesNear(getObjectIndex(state), r).some(({ rect: o }) =>
    o.x < r.x + r.w && r.x < o.x + o.w && o.y < r.y + r.h && r.y < o.y + o.h);
}

/** `ids` names the objects a commit lays; a preview passes none and gets throwaway ids. */
interface PlanOptions {
  ids?: () => string;
  /** Refuse a place where any member covers an object, a road included: the open ground a paste
   *  that did not fit looks for (EDIT-57). */
  openGround?: boolean;
}

/**
 * Plan `a` with its outline's top-left at `at`, validating without executing. Members past their
 * item's limit are left out first; every other member must be accepted by the rules where it
 * stands (a coating it would strip, as a placement does, counts as accepted), a bridge or ramp
 * must resolve to exactly the span it was copied with, and every member's ground must sit at the
 * copy's height differences.
 */
export function planPaste(
  rules: RuleDispatcher, state: GridState, a: Arrangement, at: MacroCoord, opts: PlanOptions = {},
): PastePlan {
  const room = new Map<string, number>();
  const counts = getObjectIndex(state).countByCatalog;
  let capped = 0;
  let n = 0;
  const nextId = opts.ids ?? (() => `paste-ghost-${n++}`);
  const placing: { member: CopiedMember; obj: PlacedObject }[] = [];
  for (const member of a.members) {
    const item = getCatalogItem(member.catalogId);
    if (!item) continue;
    if (item.maxCount !== undefined) {
      const left = room.get(item.id) ?? Math.max(0, item.maxCount - (counts.get(item.id) ?? 0));
      if (left === 0) { capped++; continue; }
      room.set(item.id, left - 1);
    }
    const obj = memberAt(member, at, nextId());
    placing.push({ member, obj: { ...obj, elevation: surfaceElevationAt(state, obj.position.x, obj.position.y) } });
  }
  const plan = (objects: PlacedObject[], refusal: Refusal | null, level: number | null): PastePlan =>
    ({ at, objects, valid: objects.length > 0 && refusal === null, refusal, capped, level });
  if (placing.length === 0) return plan([], null, null);

  let refusal: Refusal | null = null;
  const objects = placing.map(({ member, obj }) => {
    const item = getCatalogItem(obj.catalogId)!;
    const requested = placeObjectCommand(obj);
    const landed = snapsOwnPlacement(item) ? rules.resolve(requested, state) : requested;
    const stands = landed.object;
    if (refusal) return stands;
    if (opts.openGround && coversObject(state, stands)) {
      refusal = { cmd: landed, errors: [groundRefusal([stands])] };
      return stands;
    }
    const errors = rules.validatePreCommand(landed, state);
    if (errors.length > 0 && !(isCoatingItem(item) && strippableRefusal(state, stands, errors))) {
      refusal = { cmd: landed, errors };
    } else if (stands.position.x !== obj.position.x || stands.position.y !== obj.position.y
      || stands.rotation !== member.rotation || (stands.spanLength ?? 0) !== (member.spanLength ?? 0)) {
      refusal = { cmd: landed, errors: [groundRefusal([obj])] };
    }
    return stands;
  });
  if (refusal) return plan(objects, refusal, null);

  // Every member must agree on the layer the copy's lowest member stands on.
  const levels = objects.map((obj, i) => obj.elevation - placing[i]!.member.rise);
  const level = levels[0]!;
  const off = objects.filter((_, i) => levels[i] !== level);
  if (off.length > 0) {
    const cmd: Command = placeObjectCommand(off[0]!);
    return plan(objects, { cmd, errors: [groundRefusal(off)] }, null);
  }
  return plan(objects, null, level);
}

/** Cell offsets within `reach` of the origin, nearest first, the origin itself excluded; ties go
 *  in reading order so a search always lands the same way. */
function offsetsNearestFirst(reach: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let dy = -reach; dy <= reach; dy++) {
    for (let dx = -reach; dx <= reach; dx++) {
      if ((dx !== 0 || dy !== 0) && dx * dx + dy * dy <= reach * reach) out.push({ x: dx, y: dy });
    }
  }
  return out.sort((p, q) => (p.x * p.x + p.y * p.y) - (q.x * q.x + q.y * q.y) || p.y - q.y || p.x - q.x);
}

/** The offsets of each reach searched so far, keyed by the reach. */
const offsetsByReach = new Map<number, MacroCoord[]>();
function offsetsWithin(reach: number): MacroCoord[] {
  let out = offsetsByReach.get(reach);
  if (!out) { out = offsetsNearestFirst(reach); offsetsByReach.set(reach, out); }
  return out;
}

/** The reach that covers the whole of `state`'s map from any cell on it. */
function wholeMapReach(state: GridState): number {
  const { width, height } = state.template;
  return Math.ceil(Math.hypot(width, height));
}

/**
 * The nearest place within `reach` (`PASTE_REACH` unless given) of `at` where `a` fits on ground no
 * object covers (EDIT-57): a place whose copy stands on `level` (the asked cell's height) first, any
 * layer only when no such place is in reach. A place whose outline leaves the map is never tried.
 * Null when nothing fits.
 */
function findOpenPaste(
  rules: RuleDispatcher, state: GridState, a: Arrangement, at: MacroCoord,
  { level, reach = PASTE_REACH }: { level: number; reach?: number },
): PastePlan | null {
  const { width, height } = state.template;
  let other: PastePlan | null = null;
  for (const d of offsetsWithin(reach)) {
    const x = at.x + d.x, y = at.y + d.y;
    if (x < 0 || y < 0 || x + a.w > width || y + a.h > height) continue;
    const plan = planPaste(rules, state, a, { x, y }, { openGround: true });
    if (!plan.valid) continue;
    if (plan.level === level) return plan;
    other ??= plan;
  }
  return other;
}

/** Called once per member right before its placement runs, so a view can play the landing. */
type PasteHook = (obj: PlacedObject) => void;

/** What a placed paste came to: the ids it placed, or the refusal that left the map unchanged. */
export interface PasteResult {
  placed: string[];
  refusal: Refusal | null;
}

/** The doors a paste lands through: a tool's context, or the editor's executor wrapped as one. */
export interface PasteDoor extends CommandSink {
  readonly registry: RuleDispatcher;
  beginStroke(): Stroke;
}

/**
 * Place `a` with its outline at `at` whole, as one undo step, when the plan there is valid: road and
 * other surface members first, so a plant copied standing on a road it may stand on finds the road
 * there, each member stripping the coatings it replaces as a placement does. A refusal or a
 * post-stroke violation takes everything back.
 */
export function pasteArrangement(door: PasteDoor, a: Arrangement, at: MacroCoord, onWillPlace?: PasteHook): PasteResult {
  const { state } = door;
  const plan = planPaste(door.registry, state, a, at, { ids: generateObjectId });
  if (!plan.valid) return { placed: [], refusal: plan.refusal };
  const order = [...plan.objects].sort((p, q) =>
    Number(!isCoatingItem(getCatalogItem(p.catalogId))) - Number(!isCoatingItem(getCatalogItem(q.catalogId))));
  const stroke = door.beginStroke();
  try {
    for (const obj of order) {
      for (const coating of coatingStripFor(state, obj)) door.execute(removeObjectCommand(coating));
      onWillPlace?.(obj);
      const cmd = placeObjectCommand(obj);
      const res = door.execute(cmd);
      if (!res.success) { stroke.rollback(); return { placed: [], refusal: { cmd, errors: res.errors } }; }
    }
  } catch (err) {
    stroke.rollback();
    throw err;
  }
  const violations = stroke.commit({ atomic: true });
  if (violations.length > 0) return { placed: [], refusal: { cmd: placeObjectCommand(order[order.length - 1]!), errors: violations } };
  return { placed: order.map((obj) => obj.id), refusal: null };
}

/** What placing a copy came to, for the caller to report. */
export interface PasteOutcome extends PasteResult {
  /** The copy did not fit where it was aimed and was placed on open ground nearby. */
  nearby: boolean;
  /** Nothing fit where it was aimed or within reach. */
  noRoom: boolean;
  /** Members left out at their item's limit. */
  capped: number;
}

/**
 * Where a paste is aimed (EDIT-54, EDIT-56): a cell the copy's outline takes as its top-left, the
 * painted region the copy keeps inside, or the top-left the copy looks for the nearest open ground
 * from anywhere on the map (`near`, the copy's own origin).
 */
export type PasteAim =
  | { kind: 'cell'; cell: MacroCoord }
  | { kind: 'region'; cells: readonly MacroCoord[] }
  | { kind: 'near'; origin: MacroCoord };

const clampTo = (v: number, hi: number): number => Math.min(Math.max(v, 0), Math.max(hi, 0));

/**
 * Where the paste key aims (EDIT-54), never at the pointer: the picked block as the copy's top-left
 * when one is picked, else inside the painted region when one is painted, else the open ground
 * nearest the copy's own origin, held on the map `template` frames, so a copy from another map lands
 * where it stood there; a copy with no origin starts from the map's middle.
 */
export function pasteKeyAim(
  a: Arrangement,
  { pickedCell, region, template }: { pickedCell: MacroCoord | null; region: readonly MacroCoord[]; template: { width: number; height: number } },
): PasteAim {
  if (pickedCell) return { kind: 'cell', cell: pickedCell };
  if (region.length > 0) return { kind: 'region', cells: region };
  const from = a.origin ?? { x: Math.floor((template.width - a.w) / 2), y: Math.floor((template.height - a.h) / 2) };
  return { kind: 'near', origin: { x: clampTo(from.x, template.width - a.w), y: clampTo(from.y, template.height - a.h) } };
}

/** Whether every member of `a` with its outline at `at` covers only cells of `inside`, keyed by
 *  `cellKey` on the placement grid, as a planting keeps to a painted region. */
function fitsInside(a: Arrangement, at: MacroCoord, inside: ReadonlySet<string>): boolean {
  return a.members.every((m, i) => {
    const r = objectRect(memberAt(m, at, `m${i}`));
    return getFootprint(r.x, r.y, r.w, r.h).every((c) => inside.has(cellKey(c.x, c.y)));
  });
}

/** The plan `aim` asks for before any search, and the top-left a search starts from: the cell
 *  itself; the region's first top-left in reading order whose copy fits inside it; or open ground
 *  at the origin itself. */
function aimedPlan(rules: RuleDispatcher, state: GridState, a: Arrangement, aim: PasteAim): { plan: PastePlan; from: MacroCoord } {
  if (aim.kind === 'cell') return { plan: planPaste(rules, state, a, aim.cell), from: aim.cell };
  if (aim.kind === 'near') return { plan: planPaste(rules, state, a, aim.origin, { openGround: true }), from: aim.origin };
  const inside = new Set(aim.cells.map((c) => cellKey(c.x, c.y)));
  const order = [...aim.cells].sort((p, q) => p.y - q.y || p.x - q.x);
  const from = order[0]!;
  for (const at of order) {
    if (!fitsInside(a, at, inside)) continue;
    const plan = planPaste(rules, state, a, at);
    if (plan.valid) return { plan, from };
  }
  const first = planPaste(rules, state, a, from);
  return { plan: first.valid ? { ...first, valid: false } : first, from };
}

/**
 * Place one copy of `a` where `aim` asks (`aimedPlan`), else on the nearest open ground at the
 * height under the aim's top-left first (`findOpenPaste`), within a few cells of a cell or region
 * and anywhere on the map for `near`, else nowhere. `onWillPlace` plays each member's landing. A
 * `near` copy, which asks for the nearest open ground, is never said to be nearby.
 */
export function pasteAt(door: PasteDoor, a: Arrangement, aim: PasteAim, onWillPlace?: PasteHook): PasteOutcome {
  const { state, registry } = door;
  if (aim.kind === 'region' && aim.cells.length === 0) return { placed: [], refusal: null, nearby: false, noRoom: true, capped: 0 };
  const { plan: here, from } = aimedPlan(registry, state, a, aim);
  if (here.objects.length === 0) return { placed: [], refusal: null, nearby: false, noRoom: false, capped: here.capped };
  const reach = aim.kind === 'near' ? wholeMapReach(state) : PASTE_REACH;
  const plan = here.valid ? here : findOpenPaste(registry, state, a, from, { level: surfaceElevationAt(state, from.x, from.y), reach });
  if (!plan) return { placed: [], refusal: here.refusal, nearby: false, noRoom: true, capped: here.capped };
  const result = pasteArrangement(door, a, plan.at, onWillPlace);
  return { ...result, nearby: plan !== here && aim.kind !== 'near', noRoom: false, capped: plan.capped };
}
