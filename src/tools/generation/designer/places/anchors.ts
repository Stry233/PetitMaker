/**
 * Stage 1's other half (朝向, the methodology's orientation step): WHERE each anchor region's buildings
 * stand on its lot, and which way their doors look.
 *
 * The methodology's orientation rule is the whole of it: a building faces the way in, and the way
 * in is the side the road reaches the lot on (`RegionPlan.orientation`, which `layout.ts` derives
 * as the plaza-ward side). So a placement is a rotation before it is a position — `DOOR_ROTATION`
 * turns a facing into the rotation `placement/object.ts:buildingGate` reads the same door out of,
 * and the gate/approach recorded here come from THAT function rather than from a second reading of
 * the same convention.
 *
 * TWO LAYOUTS, because a lot's front is only so long:
 *  - THE STREET ROW, where every building of the region fits along the lot's entry side: each one
 *    stands with its door edge flush against that side, so the cell its door opens onto is the
 *    frontage pavement `roads.ts` laid along the lot (`entryLine`). Nothing else is needed.
 *  - THE COURT, where they do not: the buildings stand in rows one behind the other, all still
 *    facing the entry side, and each row past the first opens onto a 2-wide lane of its own. A
 *    SPINE down one side of the lot carries those lanes back to the frontage, so every door still
 *    faces the way in — the same rule, applied to the street the region carries inside itself.
 *    The lanes are 2 wide because a 1-wide one would be a 1-wide road, which the hard ledger
 *    refuses; at 2 every cell keeps two paved neighbours, so a lane is no dead end either.
 *
 * Pure data out: `pipeline.ts` commits every placement through `tryPlace` and every lane cell as a
 * road coating, so what the rules make of it is decided there, not here. Deterministic per
 * (seed, plan, catalog).
 */
import type { CatalogItem, MacroCoord, Rect } from '../../../../core/model/types';
import { getRotatedSize } from '../../../../state/object-geometry';
import { buildingGate } from '../../../placement/object';
import { anchorCatalogItems } from './region-list';
import { DOOR_ROTATION, type DesignPlan, type Direction, type RegionPlan } from '../types';

/** Cells kept between two buildings standing side by side, widest first. A gate strip reaches one
 *  cell past a 1x1 footprint's edges (`buildingGate`), so 2 keeps a neighbour's doorstep out of the
 *  footprint as well as out of the wall; 1 is the squeeze a tight lot is packed at. */
const GAPS = [2, 1] as const;
/** The court lane's width: the narrowest road the hard ledger allows. */
const LANE_W = 2;

export interface AnchorPlacement {
  regionId: string;
  catalogId: string;
  /** Macro top-left of the ROTATED footprint, the coordinate a PlaceObject command carries. */
  position: MacroCoord;
  rotation: 0 | 90 | 180 | 270;
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
 * @param catalog the placeable Buildings and Facilities; defaults to the live catalog's, and is the
 *        set `region-list.ts` distributed among the regions in the first place.
 */
export function planAnchors(
  seed: number, plan: DesignPlan, catalog: readonly CatalogItem[] = anchorCatalogItems(),
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
    const laid = layoutRegion(region, lot, items, seed);
    out.placements.push(...laid.placements);
    if (laid.lane) out.lanes.push(laid.lane);
    out.unplaced.push(...laid.unplaced);
  }
  return out;
}

// --- the lot's own frame -------------------------------------------------------------------------

/**
 * Lot coordinates measured from the ENTRY side: `u` runs along that side, `v` runs into the lot.
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
  region: RegionPlan, lot: Rect, items: readonly CatalogItem[], seed: number,
): RegionLayout {
  const frame = frameOf(lot, region.entrySide);
  // Widest first: one row against the street, then the court, then the court packed tight. The
  // first arrangement that seats every building of the region wins.
  const spineHigh = (hash(region.id, seed) & 1) === 0;
  for (const gap of GAPS) {
    const single = pack(region, frame, items, { gap, spine: null });
    if (single) return single;
  }
  for (const gap of GAPS) {
    const court = pack(region, frame, items, { gap, spine: spineHigh ? 'high' : 'low' });
    if (court) return court;
    const flipped = pack(region, frame, items, { gap, spine: spineHigh ? 'low' : 'high' });
    if (flipped) return flipped;
  }
  return loose(region, frame, items);
}

interface PackOpts {
  gap: number;
  /** Which end of the lot's entry side the court's spine runs down, or null for a single row with
   *  no lanes at all. */
  spine: 'low' | 'high' | null;
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
      placements.push(placementAt(region.id, item, frame.rect(u, v, s.across, s.deep), region.orientation));
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
    const key = `${c.x},${c.y}`;
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
function loose(region: RegionPlan, frame: Frame, items: readonly CatalogItem[]): RegionLayout {
  const taken: Rect[] = [];
  const placements: AnchorPlacement[] = [];
  const unplaced: { regionId: string; catalogId: string }[] = [];
  const clash = (r: Rect): boolean => taken.some((t) =>
    r.x < t.x + t.w && t.x < r.x + r.w && r.y < t.y + t.h && t.y < r.y + r.h);

  for (const item of items) {
    const s = spanOf(item);
    let placed = false;
    for (let v = 0; v + s.deep <= frame.deep && !placed; v++) {
      for (let u = 0; u + s.across <= frame.along && !placed; u++) {
        const rect = frame.rect(u, v, s.across, s.deep);
        const pad = { x: rect.x - 1, y: rect.y - 1, w: rect.w + 2, h: rect.h + 2 };
        if (clash(pad)) continue;
        taken.push(rect);
        placements.push(placementAt(region.id, item, rect, region.orientation));
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
function hash(id: string, seed: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}
