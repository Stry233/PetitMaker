/**
 * Selection helpers. The selection is an ordered array, in the order the user built it;
 * `[]` means nothing is selected.
 */
import type { GridState, PlacedObject } from '../core/model/types';
import { catalogLoadValue, getCatalogItem } from './catalog';
import { getPlacedObjectSize, objectRect } from './object-geometry';
import { getObjectIndex } from './object-index';

/** Equality by value: a `BlockRef` is rebuilt on every hover, so `===` never matches. */
export function sameRef(a: BlockRef, b: BlockRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'object' && b.kind === 'object'
    ? a.id === b.id
    : a.kind === 'terrain' && b.kind === 'terrain' && a.x === b.x && a.y === b.y;
}

/** The one member, or null. A plural selection returns null, never an arbitrary member. */
export function singleSelection(sel: readonly BlockRef[]): BlockRef | null {
  return sel.length === 1 ? sel[0]! : null;
}

/** Object ids in the selection, in order. */
export function selectedObjectIds(sel: readonly BlockRef[]): string[] {
  return sel.flatMap((r) => (r.kind === 'object' ? [r.id] : []));
}

/**
 * A selected block: an object by id, or a terrain cell by coordinate. The editor's selection is an
 * ordered list of these (`state/store.selection`); `[]` is the one representation of "nothing
 * selected". Compared by value (`state/selection.sameRef`), because a ref is rebuilt on every hover.
 */
export type BlockRef =
  | { kind: 'object'; id: string }
  | { kind: 'terrain'; x: number; y: number };

/** The objects `ids` still resolve to, in the given order. A selection may name an object that
 *  another path (the agent, a post-stroke revert, an undo) has since removed, and nothing validates
 *  membership centrally, so every group operation resolves through here. */
export function groupMembers(state: GridState, ids: readonly string[]): PlacedObject[] {
  return ids.flatMap((id) => {
    const obj = state.objects.get(id);
    return obj ? [obj] : [];
  });
}

/** The macro bounds of a group's footprints, half-open (`maxX`/`maxY` are exclusive edges). The
 *  group's geometric centre (what a rotation turns the body about, and what the chrome anchors its
 *  control row to) is this box's centre, so both read it from here. */
export function groupBounds(members: readonly PlacedObject[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const obj of members) {
    const r = objectRect(obj);
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { minX, minY, maxX, maxY };
}

/** The selection narrowed to the objects of one catalog item, in order. */
export function narrowToCatalog(sel: readonly BlockRef[], state: GridState, catalogId: string): BlockRef[] {
  return selectedObjectIds(sel).filter((id) => state.objects.get(id)?.catalogId === catalogId).map((id) => ({ kind: 'object', id }));
}

/** What a plural selection holds: its members, its kinds by count (most first) and its load. */
export interface GroupSummary {
  count: number;
  kinds: { catalogId: string; n: number }[];
  load: number;
  /** Whether a member's load price is not known. */
  loadUnknown: boolean;
}

export function groupSummary(state: GridState, ids: readonly string[]): GroupSummary {
  const members = groupMembers(state, ids);
  const byKind = new Map<string, number>();
  for (const m of members) byKind.set(m.catalogId, (byKind.get(m.catalogId) ?? 0) + 1);
  return {
    count: members.length,
    kinds: [...byKind].sort((a, b) => b[1] - a[1]).map(([catalogId, n]) => ({ catalogId, n })),
    load: members.reduce((sum, m) => sum + catalogLoadValue(m.catalogId), 0),
    loadUnknown: members.some((m) => getCatalogItem(m.catalogId)?.loadUnknown),
  };
}

/** What one selected object is: its footprint, its load and how many of its item the map holds. */
export interface ObjectSummary {
  size: { w: number; h: number };
  load: number;
  loadUnknown: boolean | undefined;
  placed: number;
  /** The item's cap on one map, if it has one. */
  maxCount: number | undefined;
}

export function objectSummary(state: GridState, obj: PlacedObject): ObjectSummary {
  const item = getCatalogItem(obj.catalogId);
  return {
    size: getPlacedObjectSize(obj),
    load: catalogLoadValue(obj.catalogId),
    loadUnknown: item?.loadUnknown,
    placed: getObjectIndex(state).countByCatalog.get(obj.catalogId) ?? 0,
    maxCount: item?.maxCount,
  };
}
