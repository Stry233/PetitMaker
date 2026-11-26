/*
 * What a load found against the current rules and what it did about it: the objects it took off the
 * map with the plan that sets them back, the terrain it changed and the landmarks it made room for.
 * The load repair (`tools/repair/`) writes the report; the hand repair and its window read it.
 */
import type { LandmarkConfig, MacroCoord, PlacedObject, TerrainCell } from './types';

/**
 * Where the plan puts one object. `pattern-shift`: the object's whole pattern (the touching objects of its item) moves
 * by `shift`, members the load did not take included, so the pattern keeps its shape. `group-shift`:
 * the pattern's taken members move by `shift` together. `single-move`: no shift fitted and it goes
 * alone. `no-place`: no legal spot within the planner's reach; landing the plan leaves it off the
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
 *  did about it. Objects are only taken off; applying `plan` (`tools/repair/relocation-plan.ts:applyRelocation`)
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
