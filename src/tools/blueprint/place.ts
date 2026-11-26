/*
 * Lay a blueprint body on a map where it fits. Its lowest ground lands on the surface under it, and
 * is filled up to that surface where the body's objects or terrain need it, and its rises stack on
 * that surface. Existing work wins: terrain is only ever raised, never lowered, cut or reshaped, save
 * an uncut top block the body's water turns into water at the same height; each part (a terrain
 * column, a corner cut, an object) lands only where the live rules accept it, and nothing that stood
 * before is removed.
 */
import { ELEVATION_MAX, TERRAIN_GRID } from '../../core/game/profile';
import type { FlipStep, Orientation } from '../../core/base/coords';
import { isBuildableZone } from '../../core/game/zones';
import { NEIGHBORS4 } from '../../core/grid/directions';
import { footprintTerrain, terrainCellsUnder } from '../../core/grid/footprint';
import { cellKey, type Rect } from '../../core/grid/rect';
import { placeObjectCommand, removeObjectCommand } from '../../core/model/command-build';
import type { CommandSink } from '../../core/model/command-sink';
import { isSquareCorners, sameCorners } from '../../core/model/corners';
import { clonePlacedObject, cloneTerrain, getCell, mapVersionKey, scratchGrid } from '../../core/model/grid-model';
import { generateId, generateObjectId } from '../../core/model/object-id';
import { mapGroups, withSkipped, type GroupCell, type GroupSeed, type PlacedGroup } from '../../core/model/placed-group';
import type { RuleDispatcher } from '../../core/model/rule-dispatcher';
import { isCoatingItem, isRamp, rampDropLayers } from '../../core/model/traits';
import {
  TerrainType,
  type CatalogItem,
  type Command,
  type Corners,
  type GridState,
  type MacroCoord,
  type PlacedObject,
  type TerrainCell,
  type ValidationError,
  type ValidationResult,
} from '../../core/model/types';
import type { BlueprintBody, BlueprintCell, BlueprintObject } from '../../core/model/blueprint';
import { structuralTop, surfaceElevation } from '../../core/domain/terrain/terrain-surface';
import { createDefaultRegistry } from '../../rules';
import { objectBlocksTerrainCell } from '../../rules/object-blocks-terrain';
import { paintBleedsOffBuildable } from '../../rules/zone-restriction';
import { getCatalogItem } from '../../state/catalog';
import { createExecutor } from '../../state/executor';
import { getObjectIndex, type ObjectIndex } from '../../state/object-index';
import { laidElevation, objectRect, snapsOwnPlacement } from '../../state/object-geometry';
import { standingViolations } from '../../rules/legality';
import type { PasteDoor } from '../objects/arrangement';
import { buildColumns, carriedCut, carriedMass } from '../generation/terrain-plan';
import { orientBody } from './turn';

/** Where a body lands: its frame's top-left object cell and the orientation it is laid at inside
 *  its frame, mirrored left to right first when `mirror`, then turned `quarters` clockwise. The height
 *  comes from the map under it (`baseOf`). */
export interface BlueprintPlacement extends Orientation { readonly at: MacroCoord }

/** What one placement laid: the objects it placed, the terrain cells it built, and the parts it
 *  skipped; and the group it recorded, when it was given a seed and laid anything. */
export interface BlueprintLaid {
  readonly placed: readonly string[];
  readonly cells: readonly MacroCoord[];
  readonly skips: PlacementSkips;
  readonly group?: PlacedGroup;
}

/** What a placement records its group under: a seed, the id of the group it lays again (a turn, a
 *  flip or a move), which it replaces, a new id without one, and the group's place in Flip's cycle. */
type PlacementSeed = GroupSeed & { readonly id?: string; readonly flip?: FlipStep };

/** Parts a placement left out: terrain cells, objects the rules refused, objects at their item's
 *  limit, and objects naming items the catalog lacks. */
export interface PlacementSkips { readonly ground: number; readonly objects: number; readonly capped: number; readonly unknown: number }

/** What a placement would lay, for its ghost: the terrain cells it builds up and those it must skip
 *  (both on the terrain grid), the terrain each built cell lands as, at its absolute layer within
 *  the map's top layer and with its cuts (parallel to `cells`), the objects expected to land, and the
 *  base elevation the body's lowest ground lands at. */
export interface BlueprintPreview {
  readonly cells: readonly MacroCoord[];
  readonly terrain: readonly TerrainCell[];
  readonly blocked: readonly MacroCoord[];
  readonly objects: readonly PlacedObject[];
  readonly base: number;
}

/** The surface elevation most of the map's terrain cells in `area` stand at, the lower on a tie;
 *  0 when `area` lies off the map. */
function baseOf(state: GridState, area: Rect): number {
  const counts = new Map<number, number>();
  for (let y = area.y; y < area.y + area.h; y++) {
    for (let x = area.x; x < area.x + area.w; x++) {
      const cell = getCell(state.cells, x, y);
      if (!cell) continue;
      const e = surfaceElevation(cell.terrain);
      counts.set(e, (counts.get(e) ?? 0) + 1);
    }
  }
  let base = 0, most = 0;
  for (const [e, n] of counts) if (n > most || (n === most && e < base)) { base = e; most = n; }
  return base;
}

/** Whether the terrain cell at (x, y) may have terrain built on it: it lies in the buildable zone
 *  with no bleed off it, no object, a coating included, rests on it, and neither it nor a neighbour
 *  holds an edge cut. A commit reconciles the cuts around every changed cell
 *  (`edge-cut/cut-reconcile.ts`), so new mass beside a cut could square or drop it; a cell with no
 *  cut around it leaves every existing cut out of that repair's reach. */
function groundTakes(state: GridState, index: ObjectIndex, x: number, y: number): boolean {
  const cell = getCell(state.cells, x, y);
  return !!cell && isBuildableZone(cell.zone)
    && !paintBleedsOffBuildable(state, { x, y }) && !objectBlocksTerrainCell(index, x, y, false)
    && !aroundCell(x, y).some((c) => isCut(getCell(state.cells, c.x, c.y)?.terrain));
}

/** Whether `t` carries an edge cut: a cut corner, a fillet or a ground islet's rounding. */
function isCut(t: { corners?: Corners; patchOnly?: boolean } | null | undefined): boolean {
  return !!t && (!!t.patchOnly || (!!t.corners && !isSquareCorners(t.corners)));
}

/** The four cells beside `c`. */
const beside = (c: MacroCoord): MacroCoord[] => NEIGHBORS4.map(([dx, dy]) => ({ x: c.x + dx, y: c.y + dy }));

/** (x, y) and its eight neighbours. */
function aroundCell(x: number, y: number): MacroCoord[] {
  const out: MacroCoord[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) out.push({ x: x + dx, y: y + dy });
  return out;
}

/** One body cell as it would land: where, the terrain that lands at absolute heights, and what
 *  happens to its target: `lay` builds the column from `from` up, `kept` already holds it, `blocked`
 *  is skipped. `footing` marks ground the body leaves alone but fills up to the base, for an object
 *  standing there or, as `rim`, for the body's terrain beside it; `short` marks a cell that lands
 *  lower than the body asks, or not at all, so that the rest of the body stands (`settle`). */
interface Lay {
  readonly at: MacroCoord; readonly t: TerrainCell; readonly verdict: 'lay' | 'kept' | 'blocked'; readonly from: number; readonly footing: boolean;
  readonly rim?: boolean; readonly short?: boolean;
}

/** Whether the ghost marks `l` and the placement counts it as skipped. */
const skipped = (l: Lay): boolean => l.verdict === 'blocked' || !!l.short;

/** The terrain `t` stands as once laid, within the map's top layer. */
const landing = (t: TerrainCell): TerrainCell => ({ ...t, elevation: Math.min(ELEVATION_MAX, t.elevation) });

function absolute(c: BlueprintCell, base: number): TerrainCell {
  return {
    type: c.type,
    elevation: base + c.rise,
    ...(c.corners ? { corners: c.corners } : null),
    ...(c.patchOnly ? { patchOnly: true } : null),
    ...(c.patchBase !== undefined ? { patchBase: base + c.patchBase } : null),
  };
}

/** The height a body's object stands on across its footprint, as a rise, or null for a bridge,
 *  whose span needs no ground under it: a ramp stands its drop below its high end. */
function footingRise(o: BlueprintObject, item: CatalogItem | undefined): number | null {
  if (!item) return null;
  if (isRamp(item)) return o.rise - rampDropLayers(item);
  return snapsOwnPlacement(item) ? null : o.rise;
}

/** The terrain cells, keyed, that the body leaves as ground but one of its objects stands on there,
 *  so a lower target is filled up to the base. */
function footings(body: BlueprintBody, at: MacroCoord): Set<string> {
  const out = new Set<string>();
  for (const o of body.objects) {
    const item = getCatalogItem(o.catalogId);
    if (footingRise(o, item) !== 0) continue;
    const r = objectRect({ id: '', catalogId: o.catalogId, position: { x: at.x + o.x, y: at.y + o.y }, rotation: o.rotation, elevation: 0 }, item);
    for (const c of terrainCellsUnder(r)) out.add(cellKey(c.x, c.y));
  }
  return out;
}

/** The verdict for laying `t` on the target at (x, y): what already holds it is kept; a column is
 *  built only up from bare ground or an uncut mountain lower than `t`, on a cell `groundTakes`,
 *  water's as mountain's, its top block the water; water turns an uncut mountain whose top is the
 *  water's own height into water, as the game converts a block (`rules/base-support.ts`); anything
 *  else, a higher cell or other water included, is skipped. */
function judge(state: GridState, index: ObjectIndex, x: number, y: number, t: TerrainCell): { verdict: Lay['verdict']; from: number } {
  const now = getCell(state.cells, x, y)?.terrain ?? null;
  if (holds(now, t)) return { verdict: 'kept', from: 0 };
  const top = Math.min(ELEVATION_MAX, carriedMass(t));
  const blocked = { verdict: 'blocked', from: 0 } as const;
  if (t.type === TerrainType.Water && now?.type === TerrainType.Mountain && !isCut(now)) {
    // An existing block at the water's own height converts only whole: no fillet is cut into it.
    const lays = now.elevation < top || (now.elevation === top && !t.patchOnly);
    return lays && groundTakes(state, index, x, y) ? { verdict: 'lay', from: Math.min(top, now.elevation + 1) } : blocked;
  }
  if (t.type !== TerrainType.Mountain || top < 1) {
    return !now && groundTakes(state, index, x, y) ? { verdict: 'lay', from: t.type === TerrainType.Mountain ? 1 : 0 } : blocked;
  }
  if (now && (now.type !== TerrainType.Mountain || isCut(now))) return blocked;
  const from = (now?.elevation ?? 0) + 1;
  return from <= top && groundTakes(state, index, x, y) ? { verdict: 'lay', from } : blocked;
}

/** Each body cell judged on its own against the map (`judge`), before `settle` weighs them together. */
function terrainLays(state: GridState, body: BlueprintBody, at: MacroCoord): { lays: Lay[]; base: number; area: Rect } {
  const area = footprintTerrain({ x: at.x, y: at.y, w: body.w, h: body.h });
  const base = baseOf(state, area);
  const footed = base > 0 ? footings(body, at) : new Set<string>();
  const index = getObjectIndex(state);
  const lays: Lay[] = [];
  body.cells.forEach((c, k) => {
    const x = area.x + (k % area.w), y = area.y + Math.floor(k / area.w);
    const t = c ? absolute(c, base) : footed.has(cellKey(x, y)) ? { type: TerrainType.Mountain, elevation: base } : null;
    if (!t) return;
    const j = judge(state, index, x, y, t);
    // Layers past the map's top layer are left out, so such a column lands short of the body.
    lays.push({ at: { x, y }, t, ...j, footing: !c, ...(j.verdict === 'lay' && t.elevation > ELEVATION_MAX ? { short: true } : null) });
  });
  return { lays, base, area };
}

/** One post-stroke violation as a comparable value: which rule, over which cells. */
const signature = (v: ValidationError): string => `${v.ruleId}:${v.grid}:${v.cells.map((c) => cellKey(c.x, c.y)).join('|')}`;

/** The post-stroke violations each map already holds under each rule set, by `signature`, while the
 *  map stands at the version (`mapVersionKey`) they were worked out at: a ghost weighs its lay
 *  against them on every pointer move over a map that has not changed. */
const heldViolations = new WeakMap<RuleDispatcher, WeakMap<GridState, { key: string; signatures: ReadonlySet<string> }>>();

function violationsHeld(registry: RuleDispatcher, state: GridState): ReadonlySet<string> {
  let byMap = heldViolations.get(registry);
  if (!byMap) { byMap = new WeakMap(); heldViolations.set(registry, byMap); }
  const key = mapVersionKey(state);
  const hit = byMap.get(state);
  if (hit && hit.key === key) return hit.signatures;
  const signatures = new Set(registry.validatePostStroke(state).map(signature));
  byMap.set(state, { key, signatures });
  return signatures;
}

/** The cells around `e` whose terrain bears on a violation found there: its eight neighbours, and,
 *  where `e` holds water, every cell beside the water standing level with it that `e` reaches, since
 *  the containment rule traces a waterfall's caps along that water. */
function bearingOn(state: GridState, e: MacroCoord): MacroCoord[] {
  const out = aroundCell(e.x, e.y);
  const t = getCell(state.cells, e.x, e.y)?.terrain;
  if (t?.type !== TerrainType.Water) return out;
  const seen = new Set([cellKey(e.x, e.y)]);
  const queue = [e];
  while (queue.length > 0) {
    const c = queue.pop()!;
    for (const n of beside(c)) {
      const k = cellKey(n.x, n.y);
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(n);
      const nt = getCell(state.cells, n.x, n.y)?.terrain;
      if (nt?.type === TerrainType.Water && nt.elevation === t.elevation) queue.push(n);
    }
  }
  return out;
}

/** The water among `lays` when any is, else all of them: water giving way to its block keeps the
 *  column's mass and caps the water beside it, so it is tried before any block is lowered. */
function waterFirst(lays: Lay[]): Lay[] {
  const water = lays.filter((l) => l.t.type === TerrainType.Water);
  return water.length > 0 ? water : lays;
}

/**
 * `planned` weighed together under the post-stroke rules, on a scratch of the map with every column
 * built (`scratchGrid`), against what the map already breaks; the preview and the placement both lay
 * what this returns. The body's lowest ground beside its water, and beside anything that breaks, is
 * filled up to the base where it is lower, as under the body's objects; while anything new still
 * breaks, the laid cells that break or bear on it, water before blocks and those nearest a skipped
 * cell first, give way a step at a time: water to the block at its own height, a block to one layer
 * lower, a fill to nothing. Each step only lowers what would be laid, down to what the map holds,
 * which breaks nothing new, so the weighing ends.
 */
function settle(door: PasteDoor, body: BlueprintBody, area: Rect, base: number, planned: readonly Lay[]): Lay[] {
  const { state, registry } = door;
  const index = getObjectIndex(state);
  const lays = new Map(planned.map((l) => [cellKey(l.at.x, l.at.y), l]));
  const refused = new Set<string>();
  const lowestGround = (x: number, y: number): boolean =>
    x >= area.x && y >= area.y && x < area.x + area.w && y < area.y + area.h && body.cells[(y - area.y) * area.w + (x - area.x)] === null;
  const fill = (cells: readonly MacroCoord[]): boolean => {
    let any = false;
    for (const { x, y } of cells) {
      const k = cellKey(x, y);
      if (base < 1 || lays.has(k) || refused.has(k) || !lowestGround(x, y)) continue;
      const t: TerrainCell = { type: TerrainType.Mountain, elevation: base };
      const j = judge(state, index, x, y, t);
      if (j.verdict !== 'lay') continue;
      lays.set(k, { at: { x, y }, t, ...j, footing: true, rim: true });
      any = true;
    }
    return any;
  };
  fill(planned.filter((l) => l.t.type === TerrainType.Water && l.verdict === 'lay').flatMap((l) => beside(l.at)));

  let already: ReadonlySet<string> | null = null;
  for (;;) {
    const laying = [...lays.values()].filter((l) => l.verdict === 'lay');
    // Laying no terrain leaves the map's cells as they are, so it breaks nothing the map does not.
    if (laying.length === 0) break;
    already ??= violationsHeld(registry, state);
    const scratch = scratchGrid(state, laying.map((l) => l.at));
    for (const l of laying) scratch.cells[l.at.y]![l.at.x]!.terrain = landing(l.t);
    const held = already;
    const evidence = registry.validatePostStroke(scratch).filter((v) => !held.has(signature(v)))
      .flatMap((v) => (v.grid === TERRAIN_GRID ? v.cells : []));
    if (evidence.length === 0) break;
    if (fill(evidence.flatMap((e) => aroundCell(e.x, e.y)))) continue;
    const at = new Set(evidence.map((e) => cellKey(e.x, e.y)));
    let culprits = waterFirst(laying.filter((l) => at.has(cellKey(l.at.x, l.at.y))));
    if (culprits.length === 0) {
      const near = new Set(evidence.flatMap((e) => bearingOn(scratch, e)).map((c) => cellKey(c.x, c.y)));
      culprits = waterFirst(laying.filter((l) => near.has(cellKey(l.at.x, l.at.y))));
    }
    if (culprits.length === 0) culprits = laying;
    if (culprits.length === 0) break;
    const gaps = [...lays.values()].filter(skipped).map((l) => l.at);
    if (gaps.length > 0) {
      const gap = (l: Lay): number => Math.min(...gaps.map((g) => Math.max(Math.abs(g.x - l.at.x), Math.abs(g.y - l.at.y))));
      const nearest = Math.min(...culprits.map(gap));
      culprits = culprits.filter((l) => gap(l) === nearest);
    }
    for (const l of culprits) {
      const k = cellKey(l.at.x, l.at.y);
      if (l.rim) { lays.delete(k); refused.add(k); continue; }
      const top = Math.min(ELEVATION_MAX, carriedMass(l.t));
      if (l.t.type === TerrainType.Water && top >= 1) {
        const t: TerrainCell = { type: TerrainType.Mountain, elevation: top };
        lays.set(k, { ...l, t, ...judge(state, index, l.at.x, l.at.y, t), short: true });
      } else if (top - 1 >= Math.max(1, l.from)) {
        lays.set(k, { ...l, t: { type: TerrainType.Mountain, elevation: top - 1 }, short: true });
      } else {
        lays.set(k, { ...l, verdict: 'blocked', short: true });
      }
    }
  }
  return [...lays.values()];
}

/** What `body` lays at `at`, settled: the preview and the placement both lay exactly this. */
function settledLays(door: PasteDoor, body: BlueprintBody, at: MacroCoord): { lays: Lay[]; base: number } {
  const { lays, base, area } = terrainLays(door.state, body, at);
  return { lays: settle(door, body, area, base, lays), base };
}

/** The body's objects that may be offered, standing where the body puts them, coatings first so a
 *  solid finds the road it stands on; the rest are counted by why they are left out. */
function objectOffers(
  state: GridState, body: BlueprintBody, at: MacroCoord, base: number, ids: () => string,
): { offers: { obj: PlacedObject; item: CatalogItem }[]; capped: number; unknown: number } {
  const counts = getObjectIndex(state).countByCatalog;
  const room = new Map<string, number>();
  const offers: { obj: PlacedObject; item: CatalogItem }[] = [];
  let capped = 0, unknown = 0;
  for (const o of body.objects) {
    const item = getCatalogItem(o.catalogId);
    if (!item) { unknown++; continue; }
    if (item.maxCount !== undefined) {
      const left = room.get(item.id) ?? Math.max(0, item.maxCount - (counts.get(item.id) ?? 0));
      if (left === 0) { capped++; continue; }
      room.set(item.id, left - 1);
    }
    offers.push({ obj: objectAt(o, at, base, ids()), item });
  }
  offers.sort((p, q) => Number(!isCoatingItem(p.item)) - Number(!isCoatingItem(q.item)));
  return { offers, capped, unknown };
}

function objectAt(o: BlueprintObject, at: MacroCoord, base: number, id: string): PlacedObject {
  return {
    id, catalogId: o.catalogId, position: { x: at.x + o.x, y: at.y + o.y }, rotation: o.rotation, elevation: base + o.rise,
    ...(o.spanLength !== undefined ? { spanLength: o.spanLength } : null),
    ...(o.corners ? { corners: o.corners } : null),
  };
}

/** Whether `obj` lands where the body puts it: a bridge or ramp resolves to the same anchor, facing
 *  and span, and everything stands at the body's height for it, so nothing slides onto other ground. */
function landsAsPlanned(registry: RuleDispatcher, state: GridState, obj: PlacedObject, item: CatalogItem): boolean {
  if (!snapsOwnPlacement(item)) return laidElevation(state, obj) === obj.elevation;
  const stands = registry.resolve(placeObjectCommand(obj), state).object;
  return stands.position.x === obj.position.x && stands.position.y === obj.position.y && stands.rotation === obj.rotation
    && (stands.spanLength ?? 0) === (obj.spanLength ?? 0) && stands.elevation === obj.elevation;
}

/** Whether `obj` places as the body puts it (`landsAsPlanned`) and the rules accept it as it
 *  resolves; the preview and the placement both ask this. */
function objectTakes(door: PasteDoor, obj: PlacedObject, item: CatalogItem): boolean {
  const { state, registry } = door;
  return landsAsPlanned(registry, state, obj, item)
    && registry.validatePreCommand(registry.resolve(placeObjectCommand(obj), state), state).length === 0;
}

/** `door` judged before it runs, so a part the rules refuse is passed over without a refusal
 *  reaching the editor's toasts. */
export function quietSink(door: PasteDoor): Pick<CommandSink, 'execute'> {
  return {
    execute(cmd: Command): ValidationResult {
      const errors = door.registry.validatePreCommand(door.registry.resolve(cmd, door.state), door.state);
      return errors.length > 0 ? { success: false, errors } : door.execute(cmd);
    },
  };
}

/** Whether an offered object is expected to land before anything is laid, given the terrain cells
 *  (keyed) the body lays: one resting on any of them is; one resting only on ground the body leaves
 *  alone is judged by the rules now. */
const expectedToLand = (door: PasteDoor, laid: ReadonlySet<string>) => ({ obj, item }: { obj: PlacedObject; item: CatalogItem }): boolean =>
  terrainCellsUnder(objectRect(obj, item)).some((c) => laid.has(cellKey(c.x, c.y))) || objectTakes(door, obj, item);

/** The ghost of `body` laid as `p` asks, read off the map as it stands; it lays nothing. */
export function previewBlueprint(door: PasteDoor, body: BlueprintBody, p: BlueprintPlacement): BlueprintPreview {
  const { state } = door;
  const turned = orientBody(body, p);
  const { lays, base } = settledLays(door, turned, p.at);
  const laying = lays.filter((l) => l.verdict === 'lay');
  const laid = new Set(laying.map((l) => cellKey(l.at.x, l.at.y)));
  let n = 0;
  const { offers } = objectOffers(state, turned, p.at, base, () => `blueprint-ghost-${n++}`);
  const objects = offers.filter(expectedToLand(door, laid)).map(({ obj }) => obj);
  return { cells: laying.map((l) => l.at), terrain: laying.map((l) => landing(l.t)), blocked: lays.filter(skipped).map((l) => l.at), objects, base };
}

/**
 * The base `body` laid as `p` asks lands on when all of it lands on open ground, judged as its ghost
 * is: every terrain cell it holds is built from what the target holds, none already standing there
 * and none skipped, every object it offers is expected to land, and it lays something; null
 * otherwise. A paste looking for room asks this of each place it tries.
 */
export function openLanding(door: PasteDoor, body: BlueprintBody, p: BlueprintPlacement): number | null {
  const { state } = door;
  const turned = orientBody(body, p);
  const judged = terrainLays(state, turned, p.at);
  const { base } = judged;
  if (judged.lays.some((l) => l.verdict === 'blocked' || (l.verdict === 'kept' && !l.footing))) return null;
  const lays = settle(door, turned, judged.area, base, judged.lays);
  if (lays.some(skipped)) return null;
  const laid = new Set(lays.filter((l) => l.verdict === 'lay').map((l) => cellKey(l.at.x, l.at.y)));
  let n = 0;
  const { offers } = objectOffers(state, turned, p.at, base, () => `blueprint-ghost-${n++}`);
  if (laid.size === 0 && offers.length === 0) return null;
  return offers.every(expectedToLand(door, laid)) ? base : null;
}

/** Whether `now` holds what `t` lays: the same terrain to the same structural top, and its cuts. */
function holds(now: TerrainCell | null | undefined, t: TerrainCell): boolean {
  if (!now || now.type !== t.type || !!now.patchOnly !== !!t.patchOnly) return false;
  if (t.type !== TerrainType.None && structuralTop(now) !== structuralTop(t)) return false;
  return !t.corners || (!!now.corners && sameCorners(now.corners, t.corners));
}

/** `fn` run through `door`'s hold where it has one (`PasteDoor.hold`), so a lay of hundreds of
 *  commands reaches the map's listeners as one change of objects; run as it stands otherwise. */
export function heldBy<T>(door: PasteDoor, fn: () => T): T {
  return door.hold ? door.hold(fn) : fn();
}

/**
 * Lay `body` as `p` asks, as one undo step. Terrain first: each column `settle` keeps is built up from
 * the target's own top, layer by layer to the body's height on the base or the map's top layer, every
 * layer one batch split on refusal; then its corner cuts; then the objects, coatings first, each
 * left out at its item's limit, when its item is unknown, when it would not land where the body
 * puts it, or when the rules refuse it. An added object a standing check still flags is taken back
 * in the same stroke, and the stroke commits keeping what the post-stroke rules accept. With `seed`,
 * what landed is recorded in the same step as a group of the map (`core/model/placed-group.ts`).
 */
export function placeBlueprint(door: PasteDoor, body: BlueprintBody, p: BlueprintPlacement, seed?: PlacementSeed): BlueprintLaid {
  return heldBy(door, () => layNow(door, body, p, seed));
}

function layNow(door: PasteDoor, body: BlueprintBody, p: BlueprintPlacement, seed?: PlacementSeed): BlueprintLaid {
  const { state, registry } = door;
  const turned = orientBody(body, p);
  const { lays, base } = settledLays(door, turned, p.at);
  const priors = new Map(lays.filter((l) => l.verdict === 'lay').map((l) => {
    const t = getCell(state.cells, l.at.x, l.at.y)?.terrain;
    return [cellKey(l.at.x, l.at.y), t ? cloneTerrain(t) : null] as const;
  }));
  const sink = quietSink(door);
  let added: string[] = [];
  let capped = 0, unknown = 0;

  const stroke = door.beginStroke();
  try {
    const open = lays.filter((l) => l.verdict === 'lay');
    for (const type of [TerrainType.Mountain, TerrainType.Water]) {
      const columns = open.filter((l) => l.t.type === type).map((l) => ({ at: l.at, from: l.from, top: Math.min(ELEVATION_MAX, carriedMass(l.t)) }));
      buildColumns(columns, type, (cmd) => sink.execute(cmd));
    }
    for (const l of open) {
      const cut = carriedCut(l.t, getCell(state.cells, l.at.x, l.at.y)?.terrain ?? null, () => true, l.at);
      if (cut) sink.execute(cut);
    }

    const offered = objectOffers(state, turned, p.at, base, generateObjectId);
    unknown = offered.unknown;
    capped = offered.capped;
    for (const { obj, item } of offered.offers) {
      if (objectTakes(door, obj, item) && door.execute(placeObjectCommand(obj)).success) added.push(obj.id);
    }
    // Only what this stroke added is taken back, until what it added stands.
    for (;;) {
      const bad = new Set(standingViolations(state, registry, added).keys());
      if (bad.size === 0) break;
      for (const id of bad) sink.execute(removeObjectCommand({ id }));
      added = added.filter((id) => !bad.has(id));
    }
  } catch (err) {
    stroke.rollback();
    throw err;
  }
  stroke.commit();

  const placed = added.filter((id) => state.objects.has(id));
  const cells = lays.filter((l) => l.verdict === 'lay' && holds(getCell(state.cells, l.at.x, l.at.y)?.terrain, l.t)).map((l) => l.at);
  const group = seed && (placed.length > 0 || cells.length > 0) ? withSkipped({
    id: seed.id ?? generateId('g'), blueprint: seed.blueprint, name: seed.name, origin: seed.origin,
    ...(seed.flip ? { flip: seed.flip } : null),
    frame: { x: p.at.x, y: p.at.y, w: turned.w, h: turned.h }, base,
    objects: placed.map((id) => clonePlacedObject(state.objects.get(id)!)),
    cells: cells.map((c): GroupCell => ({
      x: c.x, y: c.y, laid: cloneTerrain(getCell(state.cells, c.x, c.y)!.terrain!), prior: priors.get(cellKey(c.x, c.y)) ?? null,
    })),
  } satisfies PlacedGroup, turned) : undefined;
  if (group) stroke.setGroups([...mapGroups(state).filter((g) => g.id !== group.id), group]);
  return {
    placed,
    cells,
    ...(group ? { group } : null),
    skips: {
      ground: lays.filter((l) => skipped(l) || (l.verdict === 'lay' && !holds(getCell(state.cells, l.at.x, l.at.y)?.terrain, l.t))).length,
      objects: turned.objects.length - unknown - capped - placed.length,
      capped,
      unknown,
    },
  };
}

/** Lay `body` through `executor` on `state`, the map it edits, as a stroke group of its own inside whatever group the caller holds open. */
export function layBlueprintWith(
  executor: ReturnType<typeof createExecutor>, state: GridState, body: BlueprintBody, p: BlueprintPlacement,
): BlueprintLaid {
  const door = { state, registry: executor.getRegistry(), execute: (cmd: Command) => executor.execute(cmd), beginStroke: () => executor.beginStroke() };
  return placeBlueprint(door, body, p);
}

/** Lay `body` on `state`, a map the caller owns and no editor holds, mutating it in place under the default rules. */
export function layBlueprintDetached(state: GridState, body: BlueprintBody, p: BlueprintPlacement): void {
  layBlueprintWith(createExecutor(state, createDefaultRegistry()), state, body, p);
}
