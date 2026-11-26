/**
 * Selection helpers. The selection is an ordered array, in the order the user built it;
 * `[]` means nothing is selected.
 */
import { TerrainType, type GridState, type PlacedObject } from '../core/model/types';
import { liveMembers, type PlacedGroup } from '../core/model/placed-group';
import { catalogLoadValue, getCatalogItem } from './catalog';
import { getPlacedObjectSize, objectElevation, objectRect } from './object-geometry';
import { rectsBounds } from '../core/grid/rect';
import { getCell } from '../core/model/grid-model';
import { surfaceElevation } from '../core/domain/terrain/terrain-surface';
import { getObjectIndex } from './object-index';

/** Equality by value: a `BlockRef` is rebuilt on every hover, so `===` never matches. */
export function sameRef(a: BlockRef, b: BlockRef): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'object' && b.kind === 'object'
    ? a.id === b.id
    : a.kind === 'terrain' && b.kind === 'terrain' && a.x === b.x && a.y === b.y;
}

/** Whether two selections name the same blocks in the same order. */
export function sameSelection(a: readonly BlockRef[], b: readonly BlockRef[]): boolean {
  return a === b || (a.length === b.length && a.every((r, i) => sameRef(r, b[i]!)));
}

/** The refs of `sel` whose object still stands on `state`; terrain refs pass. */
export function standingRefs(state: GridState, sel: readonly BlockRef[]): BlockRef[] {
  return sel.filter((r) => r.kind !== 'object' || state.objects.has(r.id));
}

/** The build floor `ref` stands on: an object's by where it stands, a cell's by its top; null for
 *  an object the map no longer holds. */
function floorOf(state: GridState, ref: BlockRef): number | null {
  if (ref.kind === 'terrain') return surfaceElevation(getCell(state.cells, ref.x, ref.y)?.terrain);
  const obj = state.objects.get(ref.id);
  return obj ? objectElevation(state, obj) : null;
}

/** Whether `ref` stands on a shown floor of the live map (`layerVisibility`): what the pointer,
 *  select-all and every selection write take, since a hidden floor's members are acted on by none. */
export function shownOn(s: { gridState: GridState | null; layerVisibility: Record<number, boolean> }): (ref: BlockRef) => boolean {
  const { gridState: state, layerVisibility: shown } = s;
  if (!state || !Object.values(shown).includes(false)) return () => true;
  return (ref) => { const floor = floorOf(state, ref); return floor === null || shown[floor] !== false; };
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
  const box = rectsBounds(members.map((obj) => objectRect(obj)));
  return box ? { minX: box.x, minY: box.y, maxX: box.x + box.w, maxY: box.y + box.h } : { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
}

/** The selection narrowed to the objects of one catalog item, in order. */
export function narrowToCatalog(sel: readonly BlockRef[], state: GridState, catalogId: string): BlockRef[] {
  return selectedObjectIds(sel).filter((id) => state.objects.get(id)?.catalogId === catalogId).map((id) => ({ kind: 'object', id }));
}

/** What a plural selection holds: its members, its kinds by count (most first) and its load. */
interface GroupSummary {
  count: number;
  kinds: { catalogId: string; n: number }[];
  load: number;
  /** Whether a member's load price is not known. */
  loadUnknown: boolean;
}

/** The terrain cells a placed blueprint laid that still stand as it laid them, by kind. */
export function placedTerrainCounts(state: GridState, group: PlacedGroup): { mountain: number; water: number } {
  let mountain = 0;
  let water = 0;
  for (const c of liveMembers(state, group).cells) {
    if (c.laid.type === TerrainType.Mountain) mountain += 1;
    else if (c.laid.type === TerrainType.Water) water += 1;
  }
  return { mountain, water };
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
interface ObjectSummary {
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
