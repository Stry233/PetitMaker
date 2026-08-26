/**
 * THE SCORECARD: one finished map read into the three ledgers the methodology ranks.
 *
 *  1. HARD RULES (pass/fail) — every distinct anchor building/facility placed exactly once; the
 *     road network reachable from the plaza with no dead ends; no 1-wide road network; every street
 *     end arriving at something; every body of water belonging to the map's water system.
 *  2. METHODOLOGY SCORES (0..1) — backing behind the door, near-low-far-high along the map's main
 *     axis, local symmetry, per-region palette unity, road hierarchy, decoration density.
 *  3. RAW METRICS — the distributions reference distance is measured with.
 *
 * `evaluateMap` is the whole reading, and it is the only thing here that composes: the readings it
 * gathers are each a sibling module's (`streets.ts`, `districts.ts`, `climb.ts`, `water.ts`), and
 * what this file owns is the four scores nothing else needs — the elevation profile and its
 * correlation, the door's backing, the paved connectivity, the anchor tally — plus the ledger
 * shapes they are reported in.
 *
 * Deterministic and pure: same state in, same numbers out, no commands and no randomness.
 */
import { ItemCategory, type GridState, type PlacedObject } from '../../../../core/model/types';
import { categoryOf, getCatalogItem, getPlaceableByCategory } from '../../../../state/catalog';
import { objectRect } from '../../../../state/object-geometry';
import { familyOf } from '../dressing/palette';
import type { Direction } from '../types';
import { placeArrivals } from './arrivals';
import { climbReading, type ClimbReading } from './climb';
import {
  districtFrontage, districtLegibility, type DistrictFrontage, type DistrictLegibility,
} from './districts';
import {
  mirrorScore, NB4, openingWidths, readGrid, regionDecor, runWidths, segmentRegions,
  REGION_MIN_DECOR, SYMMETRY_MATCH_MIN, UNITY_SHARE_MIN, type EvalGrid,
} from './grid';
import {
  bandScore, DEAD_END_MAX, DECOR_DENSITY_BAND, ONE_WIDE_MAX, PROFILE_RANGE_REF, REACHABLE_MIN,
  WIDTH_BANDS,
} from './reference';
import { LATTICE_SHARE_MAX, networkOneWide, networkShape, type NetworkShape } from './junctions';
import {
  rampDiscipline, streetArrivals, streetStraightness, type RampDiscipline, type StreetArrivals,
  type StreetStraightness,
} from './streets';
import {
  fountainPresence, streamShape, waterStoryLedger, type FountainPresence, type StreamShape,
  type WaterStoryLedger,
} from './water';

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
  /** No ROAD is one cell wide. Scoped to the NETWORK: a 1-wide garden walk hanging off one street
   *  inside a region is the supplement's third grade and is not charged (`networkOneWide`). */
  noOneWideRoads: { pass: boolean; oneWideCells: number; gardenCells: number; oneWideShare: number };
  /** Every street end arrives at something (`streetArrivals`). The tip-cell reading above stays
   *  beside it: the two ask different questions and both must hold. */
  streetsArrive: StreetArrivals;
  /** Every body of water belongs to the map's water system, and no tofu lake stands anywhere. */
  waterStory: WaterStoryLedger;
  /**
   * No street spans the island (`networkShape.fullSpanShare`): the anti-grid rule.
   *
   * REPORTED HERE, GATED BY THE HARNESS AT FULL RICHNESS, and it is the only ledger row that works
   * that way. The rule is a fact about the finished map, but how hard it can be held depends on the
   * knob: at the quiet end of the richness axis the island is a flat garden town whose grid is the
   * only thing partitioning it, and staggering its thinner lines costs blocks their frontage and
   * their branch — measured, one seed of forty came back a district short with a twentieth of its
   * pavement 2 wide. So `pass` is not folded into the ledger's own result; the harness and the
   * design-quality batch hold it at richness 1, the end of the axis the rule is aimed at.
   */
  noLattice: { pass: boolean; fullSpanShare: number; longestSpan: number };
  /**
   * At least one of the map's set pieces is what a walk FINISHES at (`placeArrivals`).
   *
   * REPORTED HERE, GATED BY THE HARNESS AND THE DESIGN PROBES AT FULL RICHNESS, for the same reason
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
  /** How the network's streets meet, and how much of it spans the island. */
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
  /** The composition axis the map was PLANNED along: the direction its mass was meant to rise
   *  toward. Given, `heightMonotonicity` reads that axis and that side only. Absent, the score
   *  takes the best axis and side it can find, which is the weaker reading of the two. */
  compositionAxis?: Direction;
}

/** Every catalog item the methodology's hard rule requires on a finished map: each placeable
 *  Building and Facility, exactly once. `getPlaceableByCategory` drops the rule-TBD items, and the
 *  plaza is off-catalog, so neither can be demanded of a generator. */
export function anchorCatalogIds(): string[] {
  return [
    ...getPlaceableByCategory(ItemCategory.Building),
    ...getPlaceableByCategory(ItemCategory.Facility),
  ].map((i) => i.id);
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
function profile(g: EvalGrid, axis: 'north-south' | 'east-west'): ProfileBand[] {
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
 * NEAR-LOW-FAR-HIGH as one number (the game's own 高度错落: 近处矮、远处高).
 *
 * The rule is written from where the player stands, so the reading is PLAZA-RELATIVE: on one side of
 * the plaza, does the mean elevation RISE with distance from it? The correlation is signed, so
 * ground that piles up against the plaza and leaves the far end flat scores 0 rather than scoring
 * like a wall on the horizon — a gradient's direction is the whole of what this rule is about, and
 * an unsigned correlation cannot tell the two maps apart.
 *
 * The axis and the side are the map's to choose UNLESS the caller names one: a wall on any horizon is
 * far, and the PDF names no compass direction, but a map BUILT to a composition axis is read along
 * that axis, so the score says whether the map delivered the composition it planned rather than
 * whether some horizon happens to be high. Bands are WEIGHTED BY THEIR LAND, so a 400-cell sliver of
 * coast beyond the wall cannot outvote the 1400-cell bands that are the wall. The magnitude factor is
 * the share of the reference's own gradient the map spends, which is what keeps a flat map (which
 * correlates on noise) near 0.
 */
function monotonicity(
  g: EvalGrid, plaza: { x: number; y: number }, composition?: Direction,
): { score: number; axis: 'north-south' | 'east-west'; bands: number[] } {
  let best = { score: 0, axis: 'north-south' as 'north-south' | 'east-west', bands: [] as number[] };
  const wanted = composition === 'north' || composition === 'south' ? 'north-south'
    : composition === 'east' || composition === 'west' ? 'east-west' : null;
  // The side the mass is supposed to be on: north and west are the low-coordinate arm, so the arm's
  // bands sit BEFORE the hub and the side is -1.
  const wantedSide = composition === 'north' || composition === 'west' ? -1
    : composition === 'south' || composition === 'east' ? 1 : null;
  for (const axis of ['north-south', 'east-west'] as const) {
    if (wanted && axis !== wanted) continue;
    const bands = profile(g, axis);
    const means = bands.map((b) => b.mean);
    const hub = axis === 'north-south' ? plaza.y : plaza.x;
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

/** Where the map is read FROM: the centre of the plaza standing on it, or the template's own plaza
 *  where none has been placed. The locked object is preferred because it is the hub the map was
 *  actually built around, and a hand-built state can stand one anywhere. */
function plazaHub(state: GridState, g: EvalGrid): { x: number; y: number } {
  let n = 0, sx = 0, sy = 0;
  for (let i = 0; i < g.plaza.length; i++) {
    if (!g.plaza[i]) continue;
    n++; sx += i % g.W; sy += (i / g.W) | 0;
  }
  if (n > 0) return { x: sx / n, y: sy / n };
  const p = state.template.plaza;
  return { x: p.x + p.width / 2, y: p.y + p.height / 2 };
}

/** Share of anchor buildings whose door looks DOWN: higher mean ground behind the door than in
 *  front of it. Rotation 0 faces +y, 90 faces -x, 180 faces -y, 270 faces +x (the gate mapping
 *  generation places doors by). */
function backing(state: GridState, g: EvalGrid): { buildings: number; backed: number } {
  const anchors = anchorObjects(state);
  let backed = 0;
  for (const o of anchors) {
    const r = objectRect(o);
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const face: [number, number] = o.rotation === 90 ? [-1, 0] : o.rotation === 180 ? [0, -1] : o.rotation === 270 ? [1, 0] : [0, 1];
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
    const front = mean(face[0], face[1]);
    const back = mean(-face[0], -face[1]);
    if (back > front + BACKING_SECTOR.delta) backed++;
  }
  return { buildings: anchors.length, backed };
}

/** Paved connectivity from the plaza. Bridge and ramp footprints conduct (a ramp is how pavement
 *  climbs a terrace) and are DILATED by one cell, because a deck meets the street at its ends
 *  without being 4-adjacent to it: on the target, folding the footprints in raw reads 48% of the
 *  pavement as cut off from the plaza and folding them in with their approach reads 95.8%, which is the
 *  figure the reference is known to read. */
function connectivity(g: EvalGrid): { reachableShare: number; components: number; deadEnds: number } {
  const { W, H } = g;
  const conduct = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (g.paved[i] || g.plaza[i]) conduct[i] = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!g.crossing[y * W + x]) continue;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < W && ny < H) conduct[ny * W + nx] = 1;
    }
  }
  let paved = 0;
  for (let i = 0; i < W * H; i++) if (g.paved[i]) paved++;
  // Components of the conducting mask, counted over paved cells only.
  const comp = new Int32Array(W * H).fill(-1);
  let components = 0;
  const seeds: number[] = [];
  for (let s = 0; s < W * H; s++) {
    if (!conduct[s] || comp[s]! >= 0) continue;
    const id = components++;
    const stack = [s]; comp[s] = id;
    let hasPlaza = false, hasPaved = false;
    while (stack.length) {
      const p = stack.pop()!;
      if (g.plaza[p]) hasPlaza = true;
      if (g.paved[p]) hasPaved = true;
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!conduct[j] || comp[j]! >= 0) continue;
        comp[j] = id; stack.push(j);
      }
    }
    if (hasPlaza && hasPaved) seeds.push(id);
  }
  const reachable = new Set(seeds);
  let reached = 0;
  for (let i = 0; i < W * H; i++) if (g.paved[i] && reachable.has(comp[i]!)) reached++;
  // A dead end is a paved cell with at most one paved neighbour that does not end at a crossing or
  // at the plaza (a spur into a ramp is where a road is supposed to stop).
  let deadEnds = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!g.paved[i]) continue;
    let n = 0, terminates = false;
    for (const [dx, dy] of NB4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (g.paved[j]) n++;
      if (g.crossing[j] || g.plaza[j]) terminates = true;
    }
    if (n <= 1 && !terminates) deadEnds++;
  }
  // Paved-only components, for the metrics table.
  let pavedComponents = 0;
  const seen = new Uint8Array(W * H);
  for (let s = 0; s < W * H; s++) {
    if (!g.paved[s] || seen[s]) continue;
    pavedComponents++;
    const stack = [s]; seen[s] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (!g.paved[j] || seen[j]) continue;
        seen[j] = 1; stack.push(j);
      }
    }
  }
  return { reachableShare: paved ? reached / paved : 1, components: pavedComponents, deadEnds };
}

/** The whole reading of one finished map. Deterministic: same state in, same numbers out. */
export function evaluateMap(state: GridState, options: EvalOptions = {}): MapEvaluation {
  const g = readGrid(state);
  const N = g.W * g.H;
  const land = Math.max(1, g.landCells);

  // Terrain
  const histogram = new Array<number>(9).fill(0);
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
  const mono = monotonicity(g, plazaHub(state, g), options.compositionAxis);

  // Roads
  const widthsRun = runWidths(g.paved, g.W, g.H);
  const widthsOpen = openingWidths(g.paved, g.W, g.H);
  let paved = 0, w1 = 0, w2 = 0, w3 = 0, open1 = 0;
  for (let i = 0; i < N; i++) {
    if (!g.paved[i]) continue;
    paved++;
    const w = widthsRun[i]!;
    if (w <= 1) w1++; else if (w === 2) w2++; else w3++;
    if (widthsOpen[i]! <= 1) open1++;
  }
  const materialCount = new Map<string, number>();
  let bridges = 0, ramps = 0, trees = 0, flora = 0;
  for (const o of state.objects.values()) {
    if (o.locked) continue;
    const cat = categoryOf(o);
    if (cat === ItemCategory.Road) materialCount.set(o.catalogId, (materialCount.get(o.catalogId) ?? 0) + 1);
    else if (cat === ItemCategory.Bridge) bridges++;
    else if (cat === ItemCategory.Ramp) ramps++;
    else if (cat === ItemCategory.Tree) trees++;
    else if (cat === ItemCategory.Flora) flora++;
  }
  const roadObjects = [...materialCount.values()].reduce((a, b) => a + b, 0);
  const dominantMaterialShare = roadObjects ? Math.max(...materialCount.values()) / roadObjects : 0;
  const conn = connectivity(g);

  // Regions, symmetry, unity
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

  // Anchors
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

  let covered = 0;
  for (let i = 0; i < N; i++) if (g.land[i] && g.covered[i]) covered++;
  const decorDensity = (trees + flora) / land;

  const thin = networkOneWide(g.paved, g.plaza, g.crossing, g.W, g.H);
  const network = networkShape(g.paved, g.land, g.W, g.H);
  const deadEndShare = paved ? conn.deadEnds / paved : 0;
  const widthMix = { w1: paved ? w1 / paved : 0, w2: paved ? w2 / paved : 0, w3plus: paved ? w3 / paved : 0 };

  const arrivals = streetArrivals(state);
  const atPlace = placeArrivals(state, g);
  const hard: HardLedger = {
    pass: false,
    allAnchorsPlaced: { pass: missing.length === 0 && repeated.length === 0, expected: expected.length, missing, repeated },
    roadsConnected: {
      pass: paved > 0 && conn.reachableShare >= REACHABLE_MIN && deadEndShare <= DEAD_END_MAX,
      paved, reachableShare: conn.reachableShare, deadEnds: conn.deadEnds, deadEndShare,
    },
    noOneWideRoads: {
      pass: paved > 0 && thin.oneWideShare <= ONE_WIDE_MAX,
      oneWideCells: thin.oneWideCells, gardenCells: thin.gardenCells, oneWideShare: thin.oneWideShare,
    },
    streetsArrive: arrivals,
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

  const scores: MethodologyScores = {
    backingCoverage: 0,
    heightMonotonicity: mono.score,
    symmetryShare: tested ? symmetric / tested : 0,
    unityShare: tested ? unified / tested : 0,
    roadHierarchyMix: (
      bandScore(widthMix.w1, 0, ONE_WIDE_MAX, ONE_WIDE_MAX) +
      bandScore(widthMix.w2, WIDTH_BANDS.w2[0], WIDTH_BANDS.w2[1], 0.15) +
      bandScore(widthMix.w3plus, WIDTH_BANDS.w3[0], WIDTH_BANDS.w3[1], 0.15)
    ) / 3,
    decorDensity: bandScore(decorDensity, DECOR_DENSITY_BAND[0], DECOR_DENSITY_BAND[1], 0.03),
  };
  const back = backing(state, g);
  scores.backingCoverage = back.buildings ? back.backed / back.buildings : 0;

  const metrics: MapMetrics = {
    width: g.W, height: g.H, landCells: g.landCells,
    elevation: {
      histogram, quarterMeans, bandMeans: mono.bands, profileAxis: mono.axis,
      centroid: weight ? weighted / weight : 0,
      maxElevation,
      mountainShare: mountain / land, waterShare: water / land,
      flatShare: (land - mountain - water) / land,
    },
    roads: {
      paved, pavedShare: paved / land, widthMix, openingOneWideShare: paved ? open1 / paved : 0,
      materials: materialCount.size, dominantMaterialShare,
      components: conn.components, reachableShare: conn.reachableShare, deadEnds: conn.deadEnds,
    },
    objects: {
      anchors: placedCount.size, anchorsExpected: expected.length,
      trees, flora, treeToFlora: trees ? flora / trees : 0,
      decorDensity, objectCover: covered / land, bridges, ramps,
    },
    regions: {
      count: regions.length,
      median: sizes.length ? sizes[Math.floor(sizes.length / 2)]! : 0,
      mean: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0,
      tested, symmetric, unified,
    },
    backing: back,
  };

  const legibility: LegibilityReadings = {
    ramps: rampDiscipline(state),
    streets: streetStraightness(state),
    network,
    districts: districtLegibility(state),
    frontage: districtFrontage(state),
  };

  return {
    hard, scores, metrics, legibility,
    water: { fountains: fountainPresence(state, g), stream: streamShape(state, g) },
    climb: climbReading(state, g),
  };
}
