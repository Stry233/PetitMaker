/**
 * Where each anchor region's buildings stand on its lot, and which way their doors look. A building
 * faces the way in, the side the road reaches the lot on (`RegionPlan.orientation`, the lot's entry
 * side from `districts.ts`). `DOOR_ROTATION` turns a facing into the rotation that
 * `placement/object.ts:buildingGate` reads the door from, and the gate and approach recorded here
 * come from that function.
 *
 * Two layouts:
 *  - the street row, where every building fits along the entry side, door edge flush with it, so
 *    each door opens onto the frontage pavement;
 *  - the court, where they do not: rows behind each other, all facing the entry side, each row past
 *    the first opening onto its own 2-wide lane, carried back to the frontage by a spine. Lanes are
 *    2 wide because a 1-wide road is no street, and every lane cell keeps two paved
 *    neighbours.
 *
 * Pure data out: `pipeline.ts` commits placements through `tryPlace` and lane cells as road
 * coatings. Deterministic per (seed, plan, catalog).
 */
import type { CatalogItem, MacroCoord, Rotation } from '../../../../core/model/types';
import { inflateRect, rectsOverlap, type Rect, cellKey } from '../../../../core/grid/rect';
import { fnv1a32 } from '../../../../core/base/hash';
import { getRotatedSize } from '../../../../core/grid/footprint';
import { buildingGate } from '../../../placement/object';
import { doorGroundRect, hasGate } from '../../../../state/object-geometry';
import { DOOR } from '../../../../core/game/profile';
import { anchorCatalogItems } from './region-list';
import { DOOR_ROTATION, type DesignInput, type DesignPlan, type Direction, type RegionPlan } from '../types';

/** Cells kept between two buildings standing side by side, widest first. A gate strip reaches one
 *  cell past a 1x1 footprint's edges (`buildingGate`), so 2 keeps a neighbour's doorstep out of the
 *  footprint as well as out of the wall; 1 is the squeeze a tight lot is packed at. */
const GAPS = [2, 1] as const;
/** The court lane's width: the narrowest road that is a street. */
const LANE_W = 2;

interface AnchorPlacement {
  regionId: string;
  catalogId: string;
  /** Macro top-left of the rotated footprint, the coordinate a PlaceObject command carries. */
  position: MacroCoord;
  rotation: Rotation;
  /** Where the door looks: the lot's entry side, which a back row reaches across its own lane. */
  facing: Direction;
  /** The door cell (on the footprint's edge) and the cell it opens onto, read out of
   *  `buildingGate` so the plan and the engine cannot disagree about where a door is. */
  gate: MacroCoord;
  approach: MacroCoord;
}

/** One region's court lane: the 2-wide way in its back buildings face. Absent for a street row. */
export interface AnchorLane {
  regionId: string;
  cells: MacroCoord[];
  /** The lane's mouth: the cells at the lot's entry edge, which is where it meets the frontage. */
  mouth: MacroCoord[];
}

export interface AnchorPlan {
  placements: AnchorPlacement[];
  lanes: AnchorLane[];
  /** Anchors no layout found room for. Empty on every template the layout sizes lots for; a name
   *  here is a hard-rule failure a caller must report rather than absorb. */
  unplaced: { regionId: string; catalogId: string }[];
}

/**
 * Stage 1's placements: every anchor region's buildings, positioned and oriented on its lot.
 *
 * `catalog` is the placeable Buildings and Facilities; it defaults to the live catalog's, and is the
 * set `region-list.ts` distributed among the regions in the first place.
 */
export function planAnchors(
  { seed, plan, catalog = anchorCatalogItems(), flights = [] }:
    Pick<DesignInput, 'seed'> & { plan: DesignPlan; catalog?: readonly CatalogItem[]; flights?: readonly Rect[] },
): AnchorPlan {
  const byId = new Map(catalog.map((item) => [item.id, item] as const));
  const out: AnchorPlan = { placements: [], lanes: [], unplaced: [] };
  for (const region of plan.regions) {
    if (region.kind === 'theme' || region.anchors.length === 0) continue;
    const lot = region.lot[0];
    const items = region.anchors.map((id) => byId.get(id)).filter((i): i is CatalogItem => !!i);
    if (!lot || items.length === 0) {
      for (const id of region.anchors) out.unplaced.push({ regionId: region.id, catalogId: id });
      continue;
    }
    const laid = layoutRegion(region, lot, items, seed, flights);
    out.placements.push(...laid.placements);
    if (laid.lane) out.lanes.push(laid.lane);
    out.unplaced.push(...laid.unplaced);
  }
  return out;
}

// --- the lot's own frame -------------------------------------------------------------------------

/**
 * Lot coordinates measured from the entry side: `u` runs along that side, `v` runs into the lot.
 * Everything below plans in (u, v) and converts once, so the four orientations are one layout
 * rather than four.
 */
interface Frame {
  /** Extent along the entry side, and depth into the lot. */
  along: number;
  deep: number;
  /** The map rect a (u, v) box of `du` x `dv` covers. */
  rect(u: number, v: number, du: number, dv: number): Rect;
}

function frameOf(lot: Rect, entry: Direction): Frame {
  switch (entry) {
    case 'south': return {
      along: lot.w, deep: lot.h,
      rect: (u, v, du, dv) => ({ x: lot.x + u, y: lot.y + lot.h - v - dv, w: du, h: dv }),
    };
    case 'north': return {
      along: lot.w, deep: lot.h,
      rect: (u, v, du, dv) => ({ x: lot.x + u, y: lot.y + v, w: du, h: dv }),
    };
    case 'west': return {
      along: lot.h, deep: lot.w,
      rect: (u, v, du, dv) => ({ x: lot.x + v, y: lot.y + u, w: dv, h: du }),
    };
    default: return {
      along: lot.h, deep: lot.w,
      rect: (u, v, du, dv) => ({ x: lot.x + lot.w - v - dv, y: lot.y + u, w: dv, h: du }),
    };
  }
}

/** A building's extents: `deep` runs from the door inward (the unrotated height, since the door is
 *  the footprint's bottom edge at rotation 0), `across` runs along the wall the door sits in. */
const spanOf = (item: CatalogItem): { across: number; deep: number } =>
  ({ across: item.width, deep: item.height });

// --- one region ----------------------------------------------------------------------------------

interface RegionLayout {
  placements: AnchorPlacement[];
  lane?: AnchorLane;
  unplaced: { regionId: string; catalogId: string }[];
}

function layoutRegion(
  region: RegionPlan, lot: Rect, items: readonly CatalogItem[], seed: number, flights: readonly Rect[],
): RegionLayout {
  const frame = frameOf(lot, region.entrySide);
  // Widest first: one row against the street, then the court, then the court packed tight. The
  // first arrangement that seats every building of the region wins.
  const spineHigh = (hash(region.id, seed) & 1) === 0;
  for (const gap of GAPS) {
    const single = pack(region, frame, items, { gap, spine: null, flights });
    if (single) return single;
  }
  for (const gap of GAPS) {
    const court = pack(region, frame, items, { gap, spine: spineHigh ? 'high' : 'low', flights });
    if (court) return court;
    const flipped = pack(region, frame, items, { gap, spine: spineHigh ? 'low' : 'high', flights });
    if (flipped) return flipped;
  }
  return loose(region, frame, items, flights);
}

interface PackOpts {
  gap: number;
  /** Which end of the lot's entry side the court's spine runs down, or null for a single row with
   *  no lanes at all. */
  spine: 'low' | 'high' | null;
  /** The street plan's ramp flights: a door facing one has stairs rising in front of it. */
  flights: readonly Rect[];
}

/** Whether a door would face a flight within the rise depth V-PLACE-DOOR reads. */
function doorMeetsFlight(p: AnchorPlacement, item: CatalogItem, flights: readonly Rect[]): boolean {
  if (flights.length === 0 || !hasGate(item)) return false;
  const size = getRotatedSize(item, p.rotation);
  const strip = doorGroundRect({ ...p.position, w: size.w, h: size.h }, p.rotation, DOOR.riseDepth);
  return flights.some((f) => rectsOverlap(inflateRect(strip, 0.5), f));
}

/**
 * Buildings in rows behind the lot's entry side, all facing it.
 *
 * Row 0 stands flush against that side, so its doors open on the frontage. Every later row opens on
 * a 2-wide lane laid in front of it, and the spine down one end of the lot carries those lanes back
 * to the frontage. Null when the arrangement does not fit inside the lot, which is what walks the
 * caller down to a tighter one.
 */
function pack(
  region: RegionPlan, frame: Frame, items: readonly CatalogItem[], opts: PackOpts,
): RegionLayout | null {
  const spineW = opts.spine === null ? 0 : LANE_W;
  const uLo = opts.spine === 'low' ? spineW : 0;
  const usable = frame.along - spineW;
  if (usable <= 0) return null;

  // Rows, filled in the region's own anchor order.
  const rows: { items: CatalogItem[]; width: number; deep: number }[] = [];
  for (const item of items) {
    const s = spanOf(item);
    if (s.across > usable) return null;
    const row = rows[rows.length - 1];
    if (row && row.width + opts.gap + s.across <= usable) {
      row.items.push(item);
      row.width += opts.gap + s.across;
      row.deep = Math.max(row.deep, s.deep);
    } else {
      rows.push({ items: [item], width: s.across, deep: s.deep });
    }
  }
  if (rows.length > 1 && opts.spine === null) return null;

  const placements: AnchorPlacement[] = [];
  const laneCells: MacroCoord[] = [];
  let v = 0;
  for (const [k, row] of rows.entries()) {
    if (k > 0) {
      for (let dv = 0; dv < LANE_W; dv++) {
        for (let u = 0; u < frame.along; u++) {
          const r = frame.rect(u, v + dv, 1, 1);
          laneCells.push({ x: r.x, y: r.y });
        }
      }
      v += LANE_W;
    }
    if (v + row.deep > frame.deep) return null;
    let u = uLo + Math.floor((usable - row.width) / 2);
    for (const item of row.items) {
      const s = spanOf(item);
      const p = placementAt(region.id, item, frame.rect(u, v, s.across, s.deep), region.orientation);
      if (doorMeetsFlight(p, item, opts.flights)) return null;
      placements.push(p);
      u += s.across + opts.gap;
    }
    v += row.deep;
  }

  if (opts.spine === null || rows.length <= 1) return { placements, unplaced: [] };

  // The spine runs from the lot's entry edge to the deepest lane it feeds.
  const spineU = opts.spine === 'low' ? 0 : frame.along - LANE_W;
  const cells: MacroCoord[] = [];
  const mouth: MacroCoord[] = [];
  const seen = new Set<string>();
  const add = (c: MacroCoord): void => {
    const key = cellKey(c.x, c.y);
    if (seen.has(key)) return;
    seen.add(key);
    cells.push(c);
  };
  const spineDepth = v - rows[rows.length - 1]!.deep;
  for (let sv = 0; sv < spineDepth; sv++) {
    for (let du = 0; du < LANE_W; du++) {
      const r = frame.rect(spineU + du, sv, 1, 1);
      add({ x: r.x, y: r.y });
      if (sv === 0) mouth.push({ x: r.x, y: r.y });
    }
  }
  for (const c of laneCells) add(c);
  return { placements, unplaced: [], lane: { regionId: region.id, cells, mouth } };
}

/** The last resort: each building dropped on the first free spot of the lot, facing the entry side.
 *  A door here may open on nothing, which the pipeline reports; a building missing from the map is
 *  a hard-rule failure, and this is what keeps the two apart. */
function loose(region: RegionPlan, frame: Frame, items: readonly CatalogItem[], flights: readonly Rect[]): RegionLayout {
  const taken: Rect[] = [];
  const placements: AnchorPlacement[] = [];
  const unplaced: { regionId: string; catalogId: string }[] = [];
  const clash = (r: Rect): boolean => taken.some((t) => rectsOverlap(r, t));

  for (const item of items) {
    const s = spanOf(item);
    let placed = false;
    for (let v = 0; v + s.deep <= frame.deep && !placed; v++) {
      for (let u = 0; u + s.across <= frame.along && !placed; u++) {
        const rect = frame.rect(u, v, s.across, s.deep);
        const pad = inflateRect(rect, 1);
        if (clash(pad)) continue;
        const p = placementAt(region.id, item, rect, region.orientation);
        if (doorMeetsFlight(p, item, flights)) continue;
        taken.push(rect);
        placements.push(p);
        placed = true;
      }
    }
    if (!placed) unplaced.push({ regionId: region.id, catalogId: item.id });
  }
  return { placements, unplaced };
}

/** One placement, with its door read out of the engine's own gate convention. */
function placementAt(
  regionId: string, item: CatalogItem, rect: Rect, facing: Direction,
): AnchorPlacement {
  const rotation = DOOR_ROTATION[facing];
  const size = getRotatedSize(item, rotation);
  const door = buildingGate({ x: rect.x, y: rect.y, w: size.w, h: size.h }, rotation);
  return {
    regionId, catalogId: item.id,
    position: { x: rect.x, y: rect.y },
    rotation, facing, gate: door.gate, approach: door.approach,
  };
}

/** A stable integer for a region id under one seed: the court's side choice, not a stream draw, so
 *  it cannot depend on how many regions were laid out before it. */
const hash = (id: string, seed: number): number => fnv1a32(id, seed ^ 0x9e3779b9);
