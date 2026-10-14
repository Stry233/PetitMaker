/**
 * The scorecard: one finished map read into three ranked ledgers.
 *
 *  1. Hard rules (pass/fail) — every distinct anchor building/facility placed exactly once; the
 *     road network reachable from the plaza with no dead ends; no 1-wide road network; every street
 *     end arriving at something; every body of water belonging to the map's water system.
 *  2. Methodology scores (0..1) — backing behind the door, near-low-far-high along the map's main
 *     axis, local symmetry, per-region palette unity, road hierarchy, decoration density.
 *  3. Raw metrics — the distributions reference distance is measured with.
 *
 * `evaluateMap` is the whole reading, and it is the only thing here that composes: the readings it
 * gathers are each a sibling module's (`streets.ts`, `districts.ts`, `climb.ts`, `water.ts`), and
 * what this file owns is the four scores nothing else needs — the elevation profile and its
 * correlation, the door's backing, the paved connectivity, the anchor tally — plus the ledger
 * shapes they are reported in.
 *
 * Deterministic and pure: same state in, same numbers out, no commands and no randomness.
 */
import type { GridState, PlacedObject } from '../../../core/model/types';
import { categoryOf, getCatalogItem } from '../../../state/catalog';
import { objectRect } from '../../../state/object-geometry';
import { familyOf } from '../../../tools/generation/designer/dressing/palette';
import type { Direction } from '../../../tools/generation/designer/types';
import { placeArrivals } from './arrivals';
import { climbReading, type ClimbReading } from './climb';
import {
  districtFrontage, districtLegibility, type DistrictFrontage, type DistrictLegibility,
} from './districts';
import { mirrorScore, openingWidths, regionDecor, runWidths, REGION_MIN_DECOR, SYMMETRY_MATCH_MIN, UNITY_SHARE_MIN } from './grid';
import {
  bandScore, DEAD_END_MAX, DECOR_DENSITY_BAND, ONE_WIDE_MAX, PROFILE_RANGE_REF, REACHABLE_MIN,
  WIDTH_BANDS,
} from './reference';
import { LATTICE_SHARE_MAX, networkOneWide, networkShape, type NetworkShape, type OneWideReading } from './junctions';
import { rampDiscipline, streetArrivals, streetStraightness, type RampDiscipline, type StreetArrivals, type StreetStraightness } from './streets';
import {
  fountainPresence, streamShape, waterStoryLedger, type FountainPresence, type StreamShape,
  type WaterStoryLedger,
} from './water';
import { isBridge, isCoatingItem, isSurfacePrint, isRamp } from '../../../core/model/traits';
import { templateAnchor } from '../../../core/model/landmarks';
import { ELEVATION_MAX } from '../../../core/game/profile';
import { DIR_OFFSETS, NEIGHBORS4, ROTATION_FACING } from '../../../core/grid/directions';
import { anchorCatalogItems } from '../../../tools/generation/designer/places/region-list';
import { readMap, segmentRegions, type MapMasks } from '../../../tools/reading';
import { anchorReach } from './reach';
import { labelComponents } from '../../../core/grid/cell-sets';
import { ItemCategory } from '../../../config/catalog/categories';

/** Rows (or columns) per profile band: the map's own extent over fourteen, so a real 140-row map is
 *  banded by ten exactly as the reference's north-south table is, and a small hand-built one still
 *  yields enough bands either side of the plaza to read a gradient from. */
const PROFILE_BAND_DIVISOR = 14;
const PROFILE_BAND_MIN = 4;
/** The reference's backing reading: mean surface elevation of the 7x7 sector 2 to 8 cells behind the
 *  door against the same sector in front, higher by more than 0.25. */
const BACKING_SECTOR = { near: 2, far: 8, half: 3, delta: 0.25 };

// --- ledgers ---------------------------------------------------------------------------------

export interface HardLedger {
  pass: boolean;
  allAnchorsPlaced: { pass: boolean; expected: number; missing: string[]; repeated: { id: string; count: number }[] };
  roadsConnected: { pass: boolean; paved: number; reachableShare: number; deadEnds: number; deadEndShare: number };
  /** No road is one cell wide. Scoped to the network: a 1-wide garden walk hanging off one street
   *  inside a region is the third road grade and is not charged (`networkOneWide`). */
  noOneWideRoads: { pass: boolean; oneWideCells: number; gardenCells: number; oneWideShare: number };
  /** Every street end arrives at something (`streetArrivals`). The tip-cell reading above stays
   *  beside it: the two ask different questions and both must hold. */
  streetsArrive: StreetArrivals;
  /** Every body of water belongs to the map's water system, and no tofu lake stands anywhere. */
  waterStory: WaterStoryLedger;
  /**
   * No street spans the planet (`networkShape.fullSpanShare`): the anti-grid rule.
   *
   * Reported here, gated by the harness at full richness, and it is the only ledger row that works
   * that way. The rule is a fact about the finished map, but how hard it can be held depends on the
   * knob: at the quiet end of the richness axis the planet is a flat garden town whose grid is the
   * only thing partitioning it, and staggering its thinner lines costs blocks their frontage and
   * their branch, which can leave a district short and part of the pavement 2 wide. So `pass` is not folded into the ledger's own result; the harness and the
   * design-quality batch hold it at richness 1, the end of the axis the rule is aimed at.
   */
  noLattice: { pass: boolean; fullSpanShare: number; longestSpan: number };
  /**
   * At least one of the map's set pieces is what a walk finishes at (`placeArrivals`).
   *
   * Reported here, gated by the harness and the design probes at full richness, for the same reason
   * `noLattice` is: what a map can be held to depends on the knob. The quiet end of the richness axis
   * is a flat garden town that carries no composed figure at all below the set-piece floor, so there
   * is nothing for a street to end at and the row would fail a map that is exactly what was asked for.
   */
  arrivesAtPlace: { pass: boolean; places: number; arrivedAt: number };
}

export interface MethodologyScores {
  backingCoverage: number;
  heightMonotonicity: number;
  symmetryShare: number;
  unityShare: number;
  roadHierarchyMix: number;
  decorDensity: number;
}

export interface MapMetrics {
  width: number; height: number; landCells: number;
  elevation: {
    histogram: number[];
    quarterMeans: number[];
    bandMeans: number[];
    profileAxis: 'north-south' | 'east-west';
    centroid: number;
    maxElevation: number;
    mountainShare: number; waterShare: number; flatShare: number;
  };
  roads: {
    paved: number; pavedShare: number;
    widthMix: { w1: number; w2: number; w3plus: number };
    openingOneWideShare: number;
    materials: number; dominantMaterialShare: number;
    components: number; reachableShare: number; deadEnds: number;
  };
  objects: {
    anchors: number; anchorsExpected: number;
    trees: number; flora: number; treeToFlora: number;
    decorDensity: number; objectCover: number;
    bridges: number; ramps: number;
  };
  regions: { count: number; median: number; mean: number; tested: number; symmetric: number; unified: number };
  backing: { buildings: number; backed: number };
}

/** Whether the map reads as laid out: ramp discipline, street straightness, district legibility.
 *  Beside the ledgers rather than inside them — the ramp reading is a hard rule the harness enforces,
 *  the other two are measures a gate can be set on. */
export interface LegibilityReadings {
  ramps: RampDiscipline;
  streets: StreetStraightness;
  /** How the network's streets meet, and how much of it spans the planet. */
  network: NetworkShape;
  districts: DistrictLegibility;
  frontage: DistrictFrontage;
}

export interface MapEvaluation {
  hard: HardLedger;
  scores: MethodologyScores;
  metrics: MapMetrics;
  legibility: LegibilityReadings;
  /** The water readings that are not hard: the courts and the shape of the course. */
  water: { fountains: FountainPresence; stream: StreamShape };
  /** What the walk stands on, and what it can see from there. */
  climb: ClimbReading;
}

/** What a caller knows about the map that the map itself cannot say. */
export interface EvalOptions {
  /** The composition axis the map was planned along: the direction its mass was meant to rise
   *  toward. Given, `heightMonotonicity` reads that axis and that side only. Absent, the score
   *  takes the best axis and side it can find, which is the weaker reading of the two. */
  compositionAxis?: Direction;
}

/** Every catalog item the hard rule requires on a finished map: each placeable
 *  Building and Facility, exactly once. `getPlaceableByCategory` drops the rule-TBD items, and the
 *  plaza is off-catalog, so neither can be demanded of a generator. */
export function anchorCatalogIds(): string[] {
  return anchorCatalogItems().map((i) => i.id);
}

function anchorObjects(state: GridState): PlacedObject[] {
  return [...state.objects.values()].filter((o) => {
    if (o.locked) return false;
    const cat = categoryOf(o);
    return cat === ItemCategory.Building || cat === ItemCategory.Facility;
  });
}

/** Pearson correlation weighted by how much land each point was measured over. */
function weightedPearson(xs: number[], ys: number[], ws: number[]): number {
  let sw = 0, sx = 0, sy = 0;
  for (let i = 0; i < xs.length; i++) { sw += ws[i]!; sx += ws[i]! * xs[i]!; sy += ws[i]! * ys[i]!; }
  if (sw <= 0) return 0;
  const mx = sx / sw, my = sy / sw;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - mx, dy = ys[i]! - my;
    sxy += ws[i]! * dx * dy; sxx += ws[i]! * dx * dx; syy += ws[i]! * dy * dy;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

/** One band of the profile: where it sits along the axis, its mean surface elevation, and how much
 *  land it is measured over. */
interface ProfileBand { centre: number; mean: number; cells: number }

/** Mean surface elevation per band of `band` rows (or columns) of land. */
function profile(g: MapMasks, axis: 'north-south' | 'east-west'): ProfileBand[] {
  const along = axis === 'north-south' ? g.H : g.W;
  const across = axis === 'north-south' ? g.W : g.H;
  const band = Math.max(PROFILE_BAND_MIN, Math.round(along / PROFILE_BAND_DIVISOR));
  const out: ProfileBand[] = [];
  for (let b = 0; b * band < along; b++) {
    const lo = b * band, hi = Math.min(along, (b + 1) * band);
    let cells = 0, sum = 0;
    for (let a = lo; a < hi; a++) {
      for (let c = 0; c < across; c++) {
        const i = axis === 'north-south' ? a * g.W + c : c * g.W + a;
        if (!g.land[i]) continue;
        cells++; sum += g.elev[i]!;
      }
    }
    if (cells > 0) out.push({ centre: (lo + hi) / 2, mean: sum / cells, cells });
  }
  return out;
}

/**
 * Near-low-far-high as one number (the game's staggered heights), read from the plaza: on one side,
 * does mean elevation rise with distance? The correlation is signed, so ground piled against the
 * plaza scores 0 rather than like a wall on the horizon.
 *
 * The map picks the axis and side unless the caller names one; a map built to a composition axis is
 * read along it. Bands are weighted by their land, and the magnitude factor is the share of the
 * reference's own gradient the map spends, which keeps a flat map near 0.
 */
function monotonicity(
  g: MapMasks, hubAt: { x: number; y: number }, composition?: Direction,
): { score: number; axis: 'north-south' | 'east-west'; bands: number[] } {
  let best = { score: 0, axis: 'north-south' as 'north-south' | 'east-west', bands: [] as number[] };
  const wanted = composition === 'north' || composition === 'south' ? 'north-south'
    : composition === 'east' || composition === 'west' ? 'east-west' : null;
  // The side the mass is supposed to be on: north and west are the low-coordinate arm, so the arm's
  // bands sit before the hub and the side is -1.
  const wantedSide = composition === 'north' || composition === 'west' ? -1
    : composition === 'south' || composition === 'east' ? 1 : null;
  for (const axis of ['north-south', 'east-west'] as const) {
    if (wanted && axis !== wanted) continue;
    const bands = profile(g, axis);
    const means = bands.map((b) => b.mean);
    const hub = axis === 'north-south' ? hubAt.y : hubAt.x;
    for (const side of [-1, 1] as const) {
      if (wantedSide !== null && side !== wantedSide) continue;
      const arm = bands.filter((b) => (b.centre - hub) * side > 0);
      if (arm.length < 3) continue;
      const corr = weightedPearson(
        arm.map((b) => Math.abs(b.centre - hub)), arm.map((b) => b.mean), arm.map((b) => b.cells),
      );
      const armMeans = arm.map((b) => b.mean);
      const range = Math.max(...armMeans) - Math.min(...armMeans);
      const score = Math.max(0, corr) * Math.min(1, range / PROFILE_RANGE_REF);
      if (score > best.score || best.bands.length === 0) best = { score, axis, bands: means };
    }
  }
  return best;
}

/** Where the map is read from: the centre of the plaza standing on it, or the template's own plaza
 *  where none has been placed. The locked object is preferred because it is the hub the map was
 *  actually built around, and a hand-built state can stand one anywhere. */
function hubCentreOf(state: GridState, g: MapMasks): { x: number; y: number } {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < g.anchor.length; i++) {
    if (!g.anchor[i]) continue;
    n++; sx += i % g.W; sy += (i / g.W) | 0;
  }
  if (n > 0) return { x: sx / n, y: sy / n };
  const p = templateAnchor(state.template) ?? { x: 0, y: 0, width: 0, height: 0 };
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** Share of anchor buildings whose door looks down: higher mean ground behind the door than in
 *  front of it. The door faces `ROTATION_FACING`, the mapping generation places doors by. */
function backing(state: GridState, g: MapMasks): { buildings: number; backed: number } {
  const anchors = anchorObjects(state);
  let backed = 0;
  for (const o of anchors) {
    const r = objectRect(o);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const face = DIR_OFFSETS[ROTATION_FACING[o.rotation]];
    const mean = (dx: number, dy: number): number => {
      let sum = 0, n = 0;
      for (let k = BACKING_SECTOR.near; k <= BACKING_SECTOR.far; k++) {
        for (let t = -BACKING_SECTOR.half; t <= BACKING_SECTOR.half; t++) {
          const x = Math.round(cx + dx * k + (dy !== 0 ? t : 0));
          const y = Math.round(cy + dy * k + (dx !== 0 ? t : 0));
          if (x < 0 || y < 0 || x >= g.W || y >= g.H) continue;
          sum += g.elev[y * g.W + x]!; n++;
        }
      }
      return n ? sum / n : 0;
    };
    const front = mean(face.dx, face.dy);
    const back = mean(-face.dx, -face.dy);
    if (back > front + BACKING_SECTOR.delta) backed++;
  }
  return { buildings: anchors.length, backed };
}

/** Paved connectivity from the plaza. Bridge and ramp footprints conduct (a ramp is how pavement
 *  climbs a terrace) and are dilated by one cell, because a deck meets the street at its ends
 *  without being 4-adjacent to it: on the target, folding the footprints in raw reads 48% of the
 *  pavement as cut off from the plaza and folding them in with their approach reads 95.8%, which is the
 *  figure the reference is known to read. */
function connectivity(g: MapMasks): { reachableShare: number; components: number; deadEnds: number } {
  const { W, H } = g;
  const reach = anchorReach(g.paved, g.anchor, g.crossing, g);
  let paved = 0, reached = 0;
  for (let i = 0; i < W * H; i++) {
    if (!g.paved[i]) continue;
    paved++;
    if (reach[i]) reached++;
  }
  // A dead end is a paved cell with at most one paved neighbour that does not end at a crossing or
  // at the plaza (a spur into a ramp is where a road is supposed to stop).
  let deadEnds = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!g.paved[i]) continue;
    let n = 0, terminates = false;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (g.paved[j]) n++;
      if (g.crossing[j] || g.anchor[j]) terminates = true;
    }
    if (n <= 1 && !terminates) deadEnds++;
  }
  // Paved-only components, for the metrics table.
  const pavedComponents = labelComponents(g.paved, W, H).sizes.length - 1;
  return { reachableShare: paved ? reached / paved : 1, components: pavedComponents, deadEnds };
}

/** The elevation half of the metrics table, and the near-low-far-high score read off its profile. */
function terrainMetrics(
  state: GridState, g: MapMasks, options: EvalOptions,
): { elevation: MapMetrics['elevation']; monotonicity: number } {
  const N = g.W * g.H;
  const land = Math.max(1, g.landCells);
  const histogram = new Array<number>(ELEVATION_MAX + 1).fill(0);
  let mountain = 0, water = 0, maxElevation = 0, weight = 0, weighted = 0;
  for (let i = 0; i < N; i++) {
    if (!g.land[i]) continue;
    const e = g.elev[i]!;
    if (e >= 0 && e < histogram.length) histogram[e] = histogram[e]! + 1;
    if (g.mountain[i]) mountain++; else if (g.water[i]) water++;
    maxElevation = Math.max(maxElevation, e);
    weight += e; weighted += e * ((i / g.W) | 0);
  }
  const quarterMeans: number[] = [];
  for (let q = 0; q < 4; q++) {
    const y0 = Math.floor((q * g.H) / 4), y1 = Math.floor(((q + 1) * g.H) / 4);
    let cells = 0, sum = 0;
    for (let y = y0; y < y1; y++) for (let x = 0; x < g.W; x++) {
      const i = y * g.W + x;
      if (!g.land[i]) continue;
      cells++; sum += g.elev[i]!;
    }
    quarterMeans.push(cells ? sum / cells : 0);
  }
  const mono = monotonicity(g, hubCentreOf(state, g), options.compositionAxis);
  return {
    elevation: {
      histogram, quarterMeans, bandMeans: mono.bands, profileAxis: mono.axis,
      centroid: weight ? weighted / weight : 0,
      maxElevation,
      mountainShare: mountain / land, waterShare: water / land,
      flatShare: (land - mountain - water) / land,
    },
    monotonicity: mono.score,
  };
}

/** The unlocked objects a map carries, by what the readings count them as. */
interface ObjectTally {
  /** Road tiles per material, over cells that read as pavement. */
  materials: Map<string, number>;
  bridges: number; ramps: number; trees: number; flora: number;
}

function objectTally(state: GridState, g: MapMasks): ObjectTally {
  const materials = new Map<string, number>();
  let bridges = 0, ramps = 0, trees = 0, flora = 0;
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const item = getCatalogItem(o.catalogId);
    const cat = item?.category;
    if (isCoatingItem(item) && !isSurfacePrint(item)) {
      const at = o.position.y * g.W + o.position.x;
      if (g.paved[at]) materials.set(o.catalogId, (materials.get(o.catalogId) ?? 0) + 1);
    } else if (isBridge(item)) bridges++;
    else if (isRamp(item)) ramps++;
    else if (cat === ItemCategory.Tree) trees++;
    else if (cat === ItemCategory.Flora) flora++;
  }
  return { materials, bridges, ramps, trees, flora };
}

/** The road half of the metrics table: how much is paved, how wide, in what, and how connected. */
function roadMetrics(
  g: MapMasks, widthsOpen: Uint8Array, objects: ObjectTally,
  conn: ReturnType<typeof connectivity>,
): MapMetrics['roads'] {
  const land = Math.max(1, g.landCells);
  const widthsRun = runWidths(g.paved, g.W, g.H);
  let paved = 0, w1 = 0, w2 = 0, w3 = 0, open1 = 0;
  for (let i = 0; i < g.W * g.H; i++) {
    if (!g.paved[i]) continue;
    paved++;
    const w = widthsRun[i]!;
    if (w <= 1) w1++; else if (w === 2) w2++; else w3++;
    if (widthsOpen[i]! <= 1) open1++;
  }
  const roadObjects = [...objects.materials.values()].reduce((a, b) => a + b, 0);
  const dominantMaterialShare = roadObjects ? Math.max(...objects.materials.values()) / roadObjects : 0;
  const widthMix = { w1: paved ? w1 / paved : 0, w2: paved ? w2 / paved : 0, w3plus: paved ? w3 / paved : 0 };
  return {
    paved, pavedShare: paved / land, widthMix, openingOneWideShare: paved ? open1 / paved : 0,
    materials: objects.materials.size, dominantMaterialShare,
    components: conn.components, reachableShare: conn.reachableShare, deadEnds: conn.deadEnds,
  };
}

/** The open-ground regions, and how many of the decorated ones read as symmetric and unified. */
function regionReadings(g: MapMasks): MapMetrics['regions'] {
  const regions = segmentRegions(g);
  const sizes = regions.map((r) => r.cells.length).sort((a, b) => a - b);
  let tested = 0, symmetric = 0, unified = 0;
  for (const region of regions) {
    const decor = regionDecor(g, region);
    if (decor.length < REGION_MIN_DECOR) continue;
    tested++;
    const families = new Map<string, number>();
    for (const d of decor) {
      const f = familyOf(d.id);
      families.set(f, (families.get(f) ?? 0) + 1);
    }
    if (Math.max(...families.values()) / decor.length >= UNITY_SHARE_MIN) unified++;
    const m = mirrorScore(decor);
    if (Math.max(m.v, m.h) >= SYMMETRY_MATCH_MIN) symmetric++;
  }
  return {
    count: regions.length,
    median: sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0,
    mean: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
    tested, symmetric, unified,
  };
}

/** Which required anchors stand on the map, which are missing, and which stand more than once (or
 *  are catalog anchors the rule does not ask for). */
function anchorTally(state: GridState): { ledger: HardLedger['allAnchorsPlaced']; placed: number } {
  const expected = anchorCatalogIds();
  const placedCount = new Map<string, number>();
  for (const o of anchorObjects(state)) placedCount.set(o.catalogId, (placedCount.get(o.catalogId) ?? 0) + 1);
  const missing = expected.filter((id) => !placedCount.has(id));
  const repeated = [...placedCount.entries()]
    .filter(([, c]) => c > 1)
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
  const extra = [...placedCount.keys()].filter((id) => !expected.includes(id) && getCatalogItem(id));
  for (const id of extra) if (!repeated.some((r) => r.id === id)) repeated.push({ id, count: placedCount.get(id)! });
  return {
    ledger: { pass: missing.length === 0 && repeated.length === 0, expected: expected.length, missing, repeated },
    placed: placedCount.size,
  };
}

/** The hard rules, each read beside the numbers it was judged on. */
function hardLedger(
  state: GridState, g: MapMasks, anchors: HardLedger['allAnchorsPlaced'], roads: MapMetrics['roads'],
  shape: { thin: OneWideReading; network: NetworkShape },
): HardLedger {
  const { thin, network } = shape;
  const { paved } = roads;
  const deadEndShare = paved ? roads.deadEnds / paved : 0;
  const atPlace = placeArrivals(state, g);
  const hard: HardLedger = {
    pass: false,
    allAnchorsPlaced: anchors,
    roadsConnected: {
      pass: paved > 0 && roads.reachableShare >= REACHABLE_MIN && deadEndShare <= DEAD_END_MAX,
      paved, reachableShare: roads.reachableShare, deadEnds: roads.deadEnds, deadEndShare,
    },
    noOneWideRoads: {
      pass: paved > 0 && thin.oneWideShare <= ONE_WIDE_MAX,
      oneWideCells: thin.oneWideCells, gardenCells: thin.gardenCells, oneWideShare: thin.oneWideShare,
    },
    streetsArrive: streetArrivals(state, g),
    waterStory: waterStoryLedger(state, g),
    noLattice: {
      pass: network.fullSpanShare <= LATTICE_SHARE_MAX,
      fullSpanShare: network.fullSpanShare, longestSpan: network.longestSpan,
    },
    arrivesAtPlace: {
      pass: atPlace.arrivedAt >= 1, places: atPlace.places, arrivedAt: atPlace.arrivedAt,
    },
  };
  hard.pass = hard.allAnchorsPlaced.pass && hard.roadsConnected.pass && hard.noOneWideRoads.pass
    && hard.streetsArrive.pass && hard.waterStory.pass;
  return hard;
}

/** The whole reading of one finished map. Deterministic: same state in, same numbers out. */
export function evaluateMap(state: GridState, options: EvalOptions = {}): MapEvaluation {
  const g = readMap(state);
  const land = Math.max(1, g.landCells);
  const terrain = terrainMetrics(state, g, options);
  const widthsOpen = openingWidths(g.paved, g.W, g.H);
  const objects = objectTally(state, g);
  const roads = roadMetrics(g, widthsOpen, objects, connectivity(g));
  const regions = regionReadings(g);
  const anchors = anchorTally(state);

  let covered = 0;
  for (let i = 0; i < g.W * g.H; i++) if (g.land[i] && g.covered[i]) covered++;
  const { trees, flora } = objects;
  const decorDensity = (trees + flora) / land;

  const thin = networkOneWide(g, widthsOpen);
  const network = networkShape(g.paved, g.land, g.W, g.H, widthsOpen);
  const hard = hardLedger(state, g, anchors.ledger, roads, { thin, network });

  const back = backing(state, g);
  const scores: MethodologyScores = {
    backingCoverage: back.buildings ? back.backed / back.buildings : 0,
    heightMonotonicity: terrain.monotonicity,
    symmetryShare: regions.tested ? regions.symmetric / regions.tested : 0,
    unityShare: regions.tested ? regions.unified / regions.tested : 0,
    roadHierarchyMix: (
      bandScore(roads.widthMix.w1, 0, ONE_WIDE_MAX, ONE_WIDE_MAX) +
      bandScore(roads.widthMix.w2, WIDTH_BANDS.w2[0], WIDTH_BANDS.w2[1], 0.15) +
      bandScore(roads.widthMix.w3plus, WIDTH_BANDS.w3[0], WIDTH_BANDS.w3[1], 0.15)
    ) / 3,
    decorDensity: bandScore(decorDensity, DECOR_DENSITY_BAND[0], DECOR_DENSITY_BAND[1], 0.03),
  };

  const metrics: MapMetrics = {
    width: g.W, height: g.H, landCells: g.landCells,
    elevation: terrain.elevation,
    roads,
    objects: {
      anchors: anchors.placed, anchorsExpected: anchors.ledger.expected,
      trees, flora, treeToFlora: trees ? flora / trees : 0,
      decorDensity, objectCover: covered / land, bridges: objects.bridges, ramps: objects.ramps,
    },
    regions,
    backing: back,
  };

  const legibility: LegibilityReadings = {
    ramps: rampDiscipline(state, g),
    streets: streetStraightness(state, g),
    network,
    districts: districtLegibility(state, g),
    frontage: districtFrontage(state, g),
  };

  return {
    hard, scores, metrics, legibility,
    water: { fountains: fountainPresence(state, g), stream: streamShape(state, g) },
    climb: climbReading(state, g),
  };
}
