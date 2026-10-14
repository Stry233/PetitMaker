/**
 * The street plan's vocabulary: road cells and ranks, street runs, ramp flights, districts and line
 * crossings, plus the tunables more than one street stage reads.
 */
import type { Rect } from '../../../../core/grid/rect';
import type { Rotation } from '../../../../core/model/types';
import type { SeedInfo } from '../types';

// --- the road facts the whole generator reads ------------------------------------------------------

/** One material carries 87 to 95% of the pavement on the built-in planets. */
export const DOMINANT_SHARE = 0.87;

// --- what a street plan is -------------------------------------------------------------------------

/** The two street ranks, plus the apron ring the plaza wears (trunk width, its own rank because it
 *  belongs to the hub rather than to any one street). */
export type RoadRank = 'apron' | 'trunk' | 'branch';

/** One paved macro cell: where it is, which rank claimed it, and what it is paved with. */
export interface RoadCell { x: number; y: number; rank: RoadRank; material: string }

/** One straight street: a line at one coordinate, laid over a contiguous stretch of the planet. */
export interface StreetRun {
  rank: 'trunk' | 'branch';
  /** The axis the street runs along: 'y' is a vertical street (its line is an x coordinate). */
  axis: 'x' | 'y';
  /** The skeleton's fixed coordinate: x for a vertical street, y for a horizontal one. */
  line: number;
  width: number;
  /** Inclusive range along `axis` the skeleton covers. */
  from: number;
  to: number;
  /** A stretch of the movement line: the map's primary walk, laid before anything else and carried
   *  over every tier step it meets. Absent on an ordinary street. */
  primary?: boolean;
  /** Total cells already eroded from each end across all settling passes, low end first. */
  eroded?: [number, number];
  /** Whether each end has consumed its one near-miss join attempt, low end first. */
  joinedEnd?: [boolean, boolean];
}

/** One ramp, positioned and rotated the way the heightDrop trait resolves it, so the footprint here
 *  is the footprint the engine will store. */
export interface RampSpec {
  catalogId: string;
  position: { x: number; y: number };
  rotation: Rotation;
  /** The high end the ramp reaches, which is what a placed ramp stores. */
  elevation: number;
  footprint: Rect;
}

/** A street's crossing of one tier step: one ramp per tier, plus the terrace landings the sculptor
 *  must carve between them (the last flight of steps lands on the low plate's own surface, so it
 *  needs no landing of its own). */
export interface RampFlight {
  /** Index into `StreetPlan.streets`: the street the flight carries, or the one it climbs off. */
  street: number;
  /** An entry flight climbs off a street at right angles onto the terrace beside it, and has
   *  pavement at its foot only; an inline one carries a street over a step, with pavement at both
   *  ends. */
  entry: boolean;
  axis: 'x' | 'y';
  highTier: number;
  lowTier: number;
  /** The whole corridor the flight occupies, pavement cleared. */
  corridor: Rect;
  ramps: RampSpec[];
  landings: { rect: Rect; tier: number }[];
}

/** One block of the partition: open land bounded by streets, plate edges and the coast. */
export interface District {
  id: number;
  cells: number[];
  rect: Rect;
  tier: number;
  /** Does a street or a flight reach this block from the plaza? */
  served: boolean;
}

/**
 * Where the movement line steps over a gap: the stretch of the primary trunk left unpaved so the
 * sculptor can open it and a deck can span it. At elevation 0 the gap is flooded; on a raised stretch
 * it is a gorge cut `GORGE_DROP` tiers into the terrace, the only kind a terraced map can offer.
 *
 * `gap` is the whole reserved stretch and `open` the opened part, one cell shorter: a coating
 * validates one column right and one row below, so the cell just west or north of a hole cannot be
 * paved and the gap must hold it too.
 */
export interface LineCrossing {
  kind: 'water' | 'gorge';
  gap: Rect;
  open: Rect;
  /** The tier the two banks stand at. */
  tier: number;
  /** The axis the street runs along; the gap lies across it. */
  axis: 'x' | 'y';
  /** Macro cells of open gap the deck spans. The catalog's bridges carry 3 to 6. */
  span: number;
}

export interface StreetPlan {
  seedInfo: SeedInfo;
  streets: StreetRun[];
  /** Every paved macro cell, in raster order, with the rank that first claimed it. */
  cells: RoadCell[];
  ramps: RampSpec[];
  flights: RampFlight[];
  districts: District[];
  materials: { dominant: string; accents: string[] };
  /** Ids of districts no street reaches: empty on a healthy plan. */
  unserved: number[];
  /** The gaps the movement line steps over, for the sculptor to open and a deck to span. */
  crossings: LineCrossing[];
}
/** The shortest street piece worth keeping. Below this it is a stub between two obstacles rather
 *  than a street, and it would read as pavement with no purpose. */
export const PIECE_MIN = 6;
/** The smallest block worth an entry flight of its own, in cells. Below a composed place's own area
 *  a block is a verge, and a staircase up onto one reads as furniture nobody asked for. */
export const ENTRY_MIN_CELLS = 120;

/** One candidate line before it is cut into pieces. A primary spec carries the range the movement
 *  line drew; every other spec runs the whole span of its axis. */
export interface LineSpec {
  rank: 'trunk' | 'branch';
  axis: 'x' | 'y';
  line: number;
  width: number;
  primary?: boolean;
  from?: number;
  to?: number;
}

/** Catalog geometry for one offered ramp style. */
export interface RampStyle { id: string; width: number; run: number }

/**
 * A climb a flight could take, in the two shapes a flight comes in.
 *
 * Inline: a street's own pavement stops at a tier step with more of the same street beyond it, and
 * the flight carries the street over. Entry: a street runs along the foot of a terrace nobody can
 * step up onto, and the flight climbs off it at right angles, cutting the street where it crosses
 * it. A terraced planet uses both: its roads run along its terrace feet and its ramps are how a
 * walker leaves them.
 */
export interface FlightCandidate {
  /** The run the flight belongs to: the street it carries (inline) or the one it crosses (entry). */
  street: number;
  /** The axis the flight climbs along: for an entry that is the street's own cross-axis. */
  axis: 'x' | 'y';
  /** The fixed coordinate of the flight's line, in the axis it climbs. */
  line: number;
  entry: boolean;
  /** Low edge of the corridor across the climb. */
  across: number;
  /** The corridor's least extent across: the street's width for an inline flight, the ramp's own for
   *  an entry, which is what keeps an entry from eating a whole crossroads. */
  span: number;
  /** +1 where the ground descends as the along-coordinate grows. */
  down: 1 | -1;
  /** The along-coordinate of the high plate's own edge cell: the cell the first ramp reads its cliff
   *  from, which the flat trait already forbids pavement on. */
  step: number;
  highTier: number;
  lowTier: number;
  /** What the flight is worth: the shorter of the two stretches it joins, or the size of the block
   *  it opens. The build order, so the ramps a map spends are the ones carrying real street. */
  weight: number;
}
