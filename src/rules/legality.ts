/*
 * Whether a map stands within the rules as it is, read through the rule registry it is handed: the
 * objects a placement where they stand refuses, the terrain the rules refuse where it stands, and
 * the post-stroke violations. The load repair and the hand repair end where these find nothing.
 */
import { paintTerrainCommand, placeObjectCommand } from '../core/model/command-build';
import { bumpCellsVersion, bumpObjectsVersion, CLEARING_ELEVATION, createDefaultTerrainCell } from '../core/model/grid-model';
import { structuralTop } from '../core/domain/terrain/terrain-surface';
import { isLaidLandmark } from '../core/model/landmarks';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import { isCoating } from '../core/model/traits';
import { holdsTemplateTerrain } from '../core/model/template';
import { TerrainType, type GridState, type MacroCoord, type PlacedObject, type ValidationError } from '../core/model/types';
import { cellKey, rectsOverlap, type Rect } from '../core/grid/rect';
import { GRIDS } from '../core/game/profile';
import { getCatalogItem } from '../state/catalog';
import { objectRect } from '../state/object-geometry';
import { entriesCovering, getObjectIndex } from '../state/object-index';

/** `state` as a placement probe reads it with `members` taken off: a view sharing the cells. */
export function viewWithout(state: GridState, members: readonly PlacedObject[]): GridState {
  const objects = new Map(state.objects);
  const off = members.filter((o) => objects.delete(o.id));
  const view: GridState = { ...state, objects, objectsDelta: undefined };
  bumpObjectsVersion(view, { removed: off });
  return view;
}

/** The map rects of the cells `v` names as evidence, on the grid it names them on. */
export function evidenceBoxes(v: ValidationError): Rect[] {
  const grid: { offset: MacroCoord; size?: number } = GRIDS[v.grid];
  const size = grid.size ?? 1;
  return v.cells.map((c) => ({ x: c.x * size + grid.offset.x, y: c.y * size + grid.offset.y, w: size, h: size }));
}

/** The footprints of the landmarks `state` lays. */
export const landmarkRects = (state: GridState): Rect[] => [...state.objects.values()].filter(isLaidLandmark).map((l) => objectRect(l));

/** The unlocked objects of `state`, in map order. */
const unlockedIds = (state: GridState): string[] => [...state.objects.values()].filter((o) => !o.locked).map((o) => o.id);

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
