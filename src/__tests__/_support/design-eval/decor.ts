/**
 * The grain of the planting: designed planting works at both extremes (the lone specimen and the
 * large block), noise lands everywhere at one middle size. The reference lays flora as 27 clusters at
 * a median of 18 cells and trees as 179 clusters at a median of 1; 64 to 86 flora clusters at a
 * median of 4 to 7 is the middling grain this reading catches.
 */
import type { GridState, PlacedObject } from '../../../core/model/types';
import { categoryOf } from '../../../state/catalog';
import { gapClusters } from './grid';
import { readMap, waterBodies, type MapMasks } from '../../../tools/reading';
import { ItemCategory } from '../../../config/catalog/categories';

/** Same-category planting with one empty cell between still forms one cluster, as a viewer sees one
 *  bed; this yields the reference's 27 and 179 cluster counts. */
const GRAIN_GAP = 2;

/** A mass is a planted cluster of this many cells or more. */
export const GRAIN_MASS = 40;

/** A specimen stands alone or in a pair. */
export const GRAIN_SPECIMEN = 2;

export interface GrainReading {
  /** Flora clusters and the median cluster's size in cells. */
  floraClusters: number;
  floraMedian: number;
  /** The same for trees, which are the specimen grain on both references. */
  treeClusters: number;
  treeMedian: number;
  /** Share of all planted cells standing in a mass, and in a specimen. */
  massShare: number;
  specimenShare: number;
  /** Share of planted cells in clusters between the two grains. */
  middleShare: number;
}

export function decorGrain(state: GridState, g = readMap(state)): GrainReading {
  const flora = plantClusters(g, ItemCategory.Flora);
  const trees = plantClusters(g, ItemCategory.Tree);
  const all = [...flora, ...trees];
  const cells = all.reduce((a, n) => a + n, 0);
  const inBand = (lo: number, hi: number): number =>
    all.filter((n) => n >= lo && n <= hi).reduce((a, n) => a + n, 0);
  return {
    floraClusters: flora.length, floraMedian: median(flora),
    treeClusters: trees.length, treeMedian: median(trees),
    massShare: cells ? inBand(GRAIN_MASS, Infinity) / cells : 0,
    specimenShare: cells ? inBand(1, GRAIN_SPECIMEN) / cells : 0,
    middleShare: cells ? inBand(GRAIN_SPECIMEN + 1, GRAIN_MASS - 1) / cells : 0,
  };
}

/**
 * Whether a water body is a composed garden or bare cyan: it counts as dressed where a same-species
 * straight row of `ROW_MIN` or more stands within `BANK_READ` cells, which a plant count cannot tell
 * from confetti. Only the `BANKS` directions are read.
 */
export function bankDressing(state: GridState, g = readMap(state)): BankDressing {
  const { W, H } = g;
  const bodies = waterBodies(g, state).filter((b) => b.cells.length >= BODY_MIN).map((b) => b.cells);
  const species = new Map<string, Set<number>>();
  for (let i = 0; i < W * H; i++) {
    const id = g.plantAt[i];
    if (!id) continue;
    const set = species.get(id) ?? new Set<number>();
    set.add(i);
    species.set(id, set);
  }
  /** Is this cell the start or the middle of a same-species straight row? */
  const inRow = (i: number): boolean => {
    const id = g.plantAt[i];
    if (!id) return false;
    const own = species.get(id)!;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of [[1, 0], [0, 1]] as const) {
      let n = 1;
      for (let k = 1; k < ROW_MIN * 2; k++) { if (x + dx * k < W && own.has((y + dy * k) * W + x + dx * k)) n++; else break; }
      for (let k = 1; k < ROW_MIN * 2; k++) { if (x - dx * k >= 0 && own.has((y - dy * k) * W + x - dx * k)) n++; else break; }
      if (n >= ROW_MIN) return true;
    }
    return false;
  };
  let dressed = 0;
  for (const body of bodies) {
    let hit = false;
    for (const i of body) {
      const x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of BANKS) {
        for (let k = 1; k <= BANK_READ && !hit; k++) {
          const nx = x + dx * k, ny = y + dy * k;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          if (inRow(ny * W + nx)) hit = true;
        }
      }
      if (hit) break;
    }
    if (hit) dressed++;
  }
  return { bodies: bodies.length, dressed, dressedShare: bodies.length ? dressed / bodies.length : 0 };
}

export interface BankDressing {
  /** Water bodies of `BODY_MIN` cells or more: the ones large enough to compose against. */
  bodies: number;
  dressed: number;
  dressedShare: number;
}

/** Smaller bodies are accents beside a path, not features to compose against. */
const BODY_MIN = 15;
/** How far from the water a row may stand, in cells. */
const BANK_READ = 2;
/** The shortest row on the reference's bank-row histogram. */
const ROW_MIN = 4;
/** The sides a plant beside water may stand on (N, W, NW, NE, SW); the flat sweep clears E, S and SE. */
const BANKS = [[0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]] as const;

/** Cluster sizes of one planting category, gap-tolerant, descending. */
function plantClusters(g: MapMasks, category: ItemCategory): number[] {
  const { W, H } = g;
  const mine = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const id = g.plantAt[i];
    if (id !== undefined && categoryOf({ catalogId: id } as PlacedObject) === category) mine[i] = 1;
  }
  return gapClusters(mine, W, H, GRAIN_GAP).map((c) => c.length).sort((a, b) => b - a);
}

const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const half = s.length >> 1;
  return s.length % 2 ? s[half]! : (s[half - 1]! + s[half]!) / 2;
};
