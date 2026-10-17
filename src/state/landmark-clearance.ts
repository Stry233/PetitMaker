/*
 * The repair every load path runs on a decoded map before it is installed (`io/import/open-save.ts`):
 * what a landmark now stands over, and whatever else the current rules refuse, comes off the map
 * without being deleted, and the load reports it. `decodeSave` returns the map as saved; this works
 * on that detached `GridState`.
 */
import { holdsTemplateTerrain, templateTerrainAt } from '../core/model/template';
import { isLaidLandmark } from '../core/model/landmarks';
import type { RuleDispatcher } from '../core/model/rule-dispatcher';
import { TerrainType, type GridState, type LandmarkConfig, type MacroCell, type MacroCoord, type PlacedObject, type TerrainCell } from '../core/model/types';
import { bumpCellsVersion, bumpObjectsVersion, clonePlacedObject, createDefaultTerrainCell } from '../core/model/grid-model';
import { cellKey, rectsOverlap } from '../core/grid/rect';
import { GRIDS, TERRAIN_GRID } from '../core/game/profile';
import { footprintTerrain } from '../core/grid/footprint';
import { objectRect } from './object-geometry';
import { entriesCovering, getObjectIndex } from './object-index';
import { backOffAt, type SettleActions } from './settle';
import {
  idsNear, illegalTerrain, planRelocation, standingViolations, UNDER_LANDMARK, type RelocationPlan, type RelocationProposal,
} from './relocation-plan';

/** Where a landmark stood when a map was saved: its laid footprint. */
export type LandmarkFootprint = Pick<LandmarkConfig, 'id' | 'x' | 'y' | 'width' | 'height'>;

/** Why an object came off the map. `covered`: a landmark's footprint overlaps it, or it stands on
 *  the ground the landmark rests on where the placement rules refuse it. `overlapping`: the
 *  repair took it from a cell where it stood on something it may not stand on (V-PLACE-COATED).
 *  `invalid`: the repair took it from a cell another post-stroke rule flagged. */
export type CompatibilityIssue = 'covered' | 'overlapping' | 'invalid';

/** One object a load took off the map, as it was saved; its taint stays for when it is placed back. */
export interface AffectedObject {
  object: PlacedObject;
  issue: CompatibilityIssue;
  /** The landmark covering it, for `covered`. */
  landmark?: string;
  /** The rule that flagged its cell, for `overlapping` and `invalid`. */
  rule?: string;
  /** The move, in cells, of the landmark covering it since the save (none when unknown), which its
   *  plan follows first. */
  shift: MacroCoord;
  /** Where the relocation planner would set it back. */
  proposal: RelocationProposal;
}

/** One terrain cell the load changed: a cell under a landmark given its template's terrain
 *  (`landmark` names it), or a cell the rules refuse or flag given back to its template's terrain,
 *  or cleared where it held that already. */
export interface TerrainChange { x: number; y: number; before: TerrainCell | null; after: TerrainCell | null; landmark?: string }

/** A landmark the load made room for: where the save had it, when that is known and differs, where
 *  it stands now, and how far its centre moved in cells (0 when unknown). */
export interface LandmarkShift { id: string; was?: LandmarkFootprint; now: LandmarkFootprint; distance: number }

/** What a load found against the current rules, under its landmarks and anywhere else, and what it
 *  did about it. Objects are only taken off; applying `plan` (`relocation-plan.ts:applyRelocation`)
 *  sets them back, and the map it leaves breaks no rule. */
export interface CompatibilityReport {
  /** The landmarks whose footprint took objects or terrain, in profile order; empty when only the
   *  rules took something. */
  landmarks: LandmarkShift[];
  objects: AffectedObject[];
  terrain: TerrainChange[];
  /** The planner's proposals for `objects`, in the order they land. */
  plan: RelocationPlan;
}

/** What a load took off the map: `objects` taken, `cells` terrain cells changed (on a landmark
 *  other than its template's, or refused or flagged by the rules), `restored` cells given the terrain
 *  their template lays under a landmark, which saves from before that terrain was saved leave
 *  empty. `reset` is set when the rules still failed after the settle, so every cell went back to its
 *  template's terrain and every object was planned afresh. `report` is present when anything changed. */
export interface LandmarkClearance { objects: number; cells: number; restored: number; reset?: true; report?: CompatibilityReport }

/** The issue a rule id names: standing on or over another object, or any other refusal. */
const OVERLAP_RULES: ReadonlySet<string> = new Set(['V-PLACE-OVERLAP', 'V-PLACE-COATED']);
const issueOf = (rule: string): CompatibilityIssue => (OVERLAP_RULES.has(rule) ? 'overlapping' : 'invalid');

/**
 * Takes every unlocked object a placement where it stands refuses (`standingViolations`), with its
 * rule, and the landmark it overlaps when that is why: the whole map first, then round after round
 * the objects within reach of what the last round took (`idsNear`), since one taken can leave another
 * refused (one that stood on it). Each round takes at least one or ends.
 */
function takeRefused(
  state: GridState, rules: RuleDispatcher, laid: readonly PlacedObject[], take: (o: PlacedObject, rule: string, landmark?: string) => void,
): void {
  let ids = [...state.objects.values()].filter((o) => !o.locked).map((o) => o.id);
  for (;;) {
    const refused = standingViolations(state, rules, ids);
    if (refused.size === 0) return;
    const rects = [...refused.keys()].map((id) => objectRect(state.objects.get(id)!));
    for (const [id, rule] of refused) {
      const o = state.objects.get(id)!;
      const under = rule === UNDER_LANDMARK ? laid.find((l) => rectsOverlap(objectRect(l), objectRect(o)))?.id : undefined;
      take(o, rule, under);
    }
    ids = idsNear(state, rects);
  }
}

/** `changes` with one entry per cell, in first-change order: what it held first and holds last. */
function mergedChanges(changes: readonly TerrainChange[]): TerrainChange[] {
  const byCell = new Map<string, TerrainChange>();
  for (const t of changes) {
    const key = cellKey(t.x, t.y);
    const first = byCell.get(key);
    byCell.set(key, first ? { ...first, after: t.after } : t);
  }
  return [...byCell.values()];
}

const footprintOf = (o: PlacedObject): LandmarkFootprint =>
  ({ id: o.id, x: o.position.x, y: o.position.y, width: o.width ?? 0, height: o.height ?? 0 });
const centre = (r: LandmarkFootprint): MacroCoord => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

/**
 * Takes off `state` what its landmarks now stand over and whatever else the current rules refuse,
 * each object keeping its taint, and reports it with the planner's proposals; a map the rules built
 * comes back as it went in. `asSaved` is where the save's landmarks stood (`ParsedSave.landmarksAsSaved`).
 * A landmark's cells get exactly its template's terrain; a cell the rules refuse
 * (`relocation-plan.ts:illegalTerrain`) goes back to its template's; what a post-stroke rule then
 * flags gives way (`state/settle.ts:backOffAt`) a layer at a time, then to its template's terrain and
 * then to none, never into a landmark's ground; every object a placement where it stands refuses comes off. Should the
 * rules still fail, every cell returns to its template's terrain and every object is planned afresh,
 * so the map the plan lands on, and the one it leaves, pass `isLegalMap`.
 */
export function clearUnderLandmarks(state: GridState, rules: RuleDispatcher, asSaved: readonly LandmarkFootprint[] = []): LandmarkClearance {
  const cleared: LandmarkClearance = { objects: 0, cells: 0, restored: 0 };
  const laid = [...state.objects.values()].filter(isLaidLandmark);
  const rects = laid.map((l) => objectRect(l));
  const affected: Omit<AffectedObject, 'proposal' | 'shift'>[] = [];
  const terrain: TerrainChange[] = [];
  const took = new Set<number>();
  const taken: PlacedObject[] = [];
  const takeOff = (o: PlacedObject): void => {
    bumpObjectsVersion(state, { removed: [o] });
    state.objects.delete(o.id);
    taken.push(o);
  };
  for (const o of [...state.objects.values()]) {
    if (o.locked) continue;
    const at = rects.findIndex((l) => rectsOverlap(l, objectRect(o)));
    if (at < 0) continue;
    takeOff(o);
    took.add(at);
    affected.push({ object: clonePlacedObject(o), issue: 'covered', landmark: laid[at]!.id });
  }
  // Terrain a template lays under a landmark is fixed; the settle below repairs around it, never into it.
  const held = new Set<string>();
  // A cell gives way to its template's terrain, or to none where it holds that already.
  const giveBack = (cell: MacroCell, x: number, y: number) => {
    const after = holdsTemplateTerrain(state.template, x, y, cell) ? null : templateTerrainAt(state.template, x, y, cell.zone);
    terrain.push({ x, y, before: cell.terrain, after });
    cell.terrain = after;
    bumpCellsVersion(state);
    cleared.cells++;
  };
  // What a post-stroke rule flags gives way a layer at a time: a mountain above its template's and
  // above layer 1 drops a layer, anything else gives way whole.
  const giveWay = (cell: MacroCell, x: number, y: number) => {
    const t = cell.terrain;
    const laid = templateTerrainAt(state.template, x, y, cell.zone);
    const floor = Math.max(1, laid?.type === TerrainType.Mountain ? laid.elevation : 0);
    if (!t || t.type !== TerrainType.Mountain || t.patchOnly || t.elevation <= floor) { giveBack(cell, x, y); return; }
    const after = createDefaultTerrainCell(TerrainType.Mountain, t.elevation - 1);
    terrain.push({ x, y, before: t, after });
    cell.terrain = after;
    bumpCellsVersion(state);
    cleared.cells++;
  };
  rects.forEach((l, i) => {
    const before = terrain.length;
    const under = footprintTerrain(l);
    for (let y = Math.max(0, under.y); y < Math.min(state.template.height, under.y + under.h); y++) {
      for (let x = Math.max(0, under.x); x < Math.min(state.template.width, under.x + under.w); x++) {
        const cell = state.cells[y]?.[x];
        if (!cell) continue;
        const laidTerrain = templateTerrainAt(state.template, x, y, cell.zone);
        if (laidTerrain) held.add(cellKey(x, y));
        if (holdsTemplateTerrain(state.template, x, y, cell)) continue;
        if (cell.terrain) { cleared.cells++; }
        else if (!laidTerrain) continue;
        if (laidTerrain) cleared.restored++;
        terrain.push({ x, y, before: cell.terrain, after: laidTerrain ?? null, landmark: laid[i]!.id });
        cell.terrain = laidTerrain ?? null;
      }
    }
    if (terrain.length > before) took.add(i);
  });
  if (terrain.length > 0) bumpCellsVersion(state);
  // An object on the ground a landmark rests on (its footprint's terrain cells, which reach past
  // its edge where the grids are offset) that the rules refuse there is covered by it too.
  const grounds = rects.map((l) => {
    const under = footprintTerrain(l);
    const offset = GRIDS[TERRAIN_GRID].offset;
    return { x: under.x + offset.x, y: under.y + offset.y, w: under.w, h: under.h };
  });
  const onGround = [...state.objects.values()].filter((o) => !o.locked && grounds.some((g) => rectsOverlap(g, objectRect(o))));
  for (const [id, rule] of standingViolations(state, rules, onGround.map((o) => o.id))) {
    const o = state.objects.get(id)!;
    const at = grounds.findIndex((g) => rectsOverlap(g, objectRect(o)));
    takeOff(o);
    took.add(at);
    affected.push({ object: clonePlacedObject(o), issue: 'covered', landmark: laid[at]!.id, rule });
  }
  // A cell the rules refuse as it stands goes back to the ground its template lays there.
  for (const c of illegalTerrain(state, rules)) {
    if (!held.has(cellKey(c.x, c.y))) giveBack(state.cells[c.y]![c.x]!, c.x, c.y);
  }

  let flaggedBy = '';
  const act: SettleActions = {
    eraseTerrain: (c) => { giveWay(state.cells[c.y]![c.x]!, c.x, c.y); return true; },
    removeObject: (o) => {
      takeOff(o);
      affected.push({ object: clonePlacedObject(o), issue: issueOf(flaggedBy), rule: flaggedBy });
      return true;
    },
  };
  // The first unlocked object over the cell in map order. Objects a round takes leave the index only
  // when the round ends, so the index is read through what still stands.
  const standingAt = (c: { x: number; y: number }) => {
    const cellRect = { x: c.x, y: c.y, w: 1, h: 1 };
    return entriesCovering(getObjectIndex(state), cellRect)
      .find((e) => state.objects.has(e.obj.id) && !e.obj.locked && rectsOverlap(e.rect, cellRect))?.obj;
  };
  // Every round takes something or ends the settle, so it stops within the map's cell and object count.
  for (;;) {
    const violations = rules.validatePostStroke(state);
    if (violations.length === 0) break;
    const before = taken.length + cleared.cells;
    const seen = new Set<string>();
    for (const v of violations) {
      flaggedBy = v.ruleId;
      for (const c of v.cells) {
        const key = cellKey(c.x, c.y);
        if (seen.has(key)) continue;
        seen.add(key);
        if (!state.cells[c.y]?.[c.x]) continue;
        backOffAt(state, act, c, { standingAt, held });
      }
    }
    if (taken.length + cleared.cells === before) break;
  }
  takeRefused(state, rules, laid, (o, rule, landmark) => {
    takeOff(o);
    affected.push({ object: clonePlacedObject(o), issue: landmark ? 'covered' : issueOf(rule), ...(landmark ? { landmark } : {}), rule });
  });
  // Every object stands legally now (`takeRefused`); what is left to fail is the terrain.
  if (rules.validatePostStroke(state, { firstOnly: true }).length > 0 || illegalTerrain(state, rules).length > 0) {
    cleared.reset = true;
    state.cells.forEach((row, y) => row.forEach((cell, x) => {
      if (holdsTemplateTerrain(state.template, x, y, cell)) return;
      const laidTerrain = templateTerrainAt(state.template, x, y, cell.zone);
      terrain.push({ x, y, before: cell.terrain, after: laidTerrain });
      cell.terrain = laidTerrain;
      cleared.cells++;
    }));
    bumpCellsVersion(state);
    for (const o of [...state.objects.values()]) {
      if (o.locked) continue;
      takeOff(o);
      affected.push({ object: clonePlacedObject(o), issue: 'invalid' });
    }
  }
  if (taken.length + terrain.length === 0) return cleared;
  cleared.objects = taken.length;

  const shifts = laid.map((l) => {
    const was = asSaved.find((s) => s.id === l.id);
    const now = footprintOf(l);
    const moved = was && (was.x !== now.x || was.y !== now.y || was.width !== now.width || was.height !== now.height);
    const shift = was ? { x: centre(now).x - centre(was).x, y: centre(now).y - centre(was).y } : { x: 0, y: 0 };
    return { shift, landmark: { id: l.id, ...(moved ? { was: { ...was } } : {}), now, distance: Math.round(Math.hypot(shift.x, shift.y)) } };
  });
  const shiftOf = (id: string | undefined): MacroCoord => shifts[laid.findIndex((l) => l.id === id)]?.shift ?? { x: 0, y: 0 };
  const items = affected.map((a) => ({ ...a, shift: shiftOf(a.landmark) }));
  const plan = planRelocation(state, rules, items);
  const proposals = new Map(plan.moves.map((m) => [m.id, m.proposal]));
  cleared.report = {
    landmarks: shifts.filter((_, i) => took.has(i)).map((s) => s.landmark),
    objects: items.map((a) => ({ ...a, proposal: proposals.get(a.object.id) ?? { kind: 'no-place' } })),
    terrain: mergedChanges(terrain),
    plan,
  };
  return cleared;
}
