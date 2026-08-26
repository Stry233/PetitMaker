/**
 * THE GRAIN OF THE PLANTING, read off the finished map.
 *
 * Planting reads as designed when it works at BOTH extremes — the single deliberate specimen and the
 * large uniform block — and reads as noise when everything lands at the same middle size. The
 * reference lays flora as 27 clusters at a median of 18 cells and trees as 179 clusters at a median
 * of 1; 64 to 86 flora clusters at a median of 4 to 7 is one middling grain everywhere, the failure
 * this reading exists to catch.
 */
import { ItemCategory, type GridState, type PlacedObject } from '../../../../core/model/types';
import { categoryOf } from '../../../../state/catalog';
import { NB4, readGrid, type EvalGrid } from './grid';

/**
 * A CLUSTER IS SAME-CATEGORY PLANTING WITH A GAP OF ONE TOLERATED, so a bed laid as blocks with a cell
 * of air between them reads as the one bed a viewer sees. Run over the reference, this definition
 * returns its 27-and-179 cluster counts, which is the check that the two are the same definition.
 */
const GRAIN_GAP = 2;

/** The two grains, in cells: a MASS is a bed of this size or more, a SPECIMEN stands alone or in a
 *  pair. The proxy asks for a quarter of the decoration in masses and a fifth in specimens. */
export const GRAIN_MASS = 40;

export const GRAIN_SPECIMEN = 2;

export interface GrainReading {
  /** Flora clusters and the median cluster's size in cells. */
  floraClusters: number;
  floraMedian: number;
  /** The same for trees, which are the specimen grain on both references. */
  treeClusters: number;
  treeMedian: number;
  /** Share of all planted cells standing in a MASS, and in a SPECIMEN. */
  massShare: number;
  specimenShare: number;
  /** Share in the middle band, which is asked to stay under 45%. */
  middleShare: number;
}

export function decorGrain(state: GridState, g = readGrid(state)): GrainReading {
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
 * WHETHER A WATER BODY IS A COMPOSED GARDEN OR BARE CYAN.
 *
 * A body counts as DRESSED where a same-species straight ROW of `ROW_MIN` or more stands within
 * `BANK_READ` cells of it, which is the target's own bank grammar and not simply the presence of
 * plants: 93% of its near-water planting is same-species straight runs, mostly 5 and 6 long. Counting
 * plants instead does not discriminate — read that way the reference dresses 26 of its 40 bodies and a
 * generated map 11 to 26 of 14 to 28, which says nothing about whether the planting is a row or
 * confetti.
 *
 * The row is read on the BANK the flat sweep leaves standing (N/NW/NE/W/SW), since that is the only
 * side a plant beside water can legally stand on and so the only side the grammar can be built from.
 */
export function bankDressing(state: GridState, g = readGrid(state)): BankDressing {
  const { W, H } = g;
  const bodies = waterRuns(g);
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
      for (let k = 1; k < ROW_MIN * 2; k++) { if (own.has((y + dy * k) * W + x + dx * k)) n++; else break; }
      for (let k = 1; k < ROW_MIN * 2; k++) { if (own.has((y - dy * k) * W + x - dx * k)) n++; else break; }
      if (n >= ROW_MIN) return true;
    }
    return false;
  };
  let dressed = 0;
  for (const body of bodies) {
    let hit = false;
    for (const i of body) {
      const x = i % W, y = (i / W) | 0;
      // The banks the sweep leaves standing: north of the water, west of it, and the two corners
      // between.
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

/** The smallest body the dressing reading asks about, how far from its bank a row may stand, and how
 *  long a row has to be to count. The body floor is the accent class that reads as a thing beside a
 *  path rather than as a feature; the row length is the short end of the target's own histogram. */
const BODY_MIN = 15;
const BANK_READ = 2;
const ROW_MIN = 4;
/** The banks a plant beside water may stand on: north, west, and the corners between (the sweep
 *  reaches east, south and south-east, so nothing can stand there). */
const BANKS = [[0, -1], [-1, 0], [-1, -1], [1, -1], [-1, 1]] as const;

/** 4-connected water bodies of `BODY_MIN` cells or more, as flat-index lists. */
function waterRuns(g: EvalGrid): number[][] {
  const { W, H } = g;
  const seen = new Uint8Array(W * H);
  const out: number[][] = [];
  for (let start = 0; start < W * H; start++) {
    if (!g.water[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      cells.push(p);
      const x = p % W, y = (p / W) | 0;
      for (const [dx, dy] of NB4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (seen[j] || !g.water[j]) continue;
        seen[j] = 1;
        stack.push(j);
      }
    }
    if (cells.length >= BODY_MIN) out.push(cells);
  }
  return out;
}

/** Cluster sizes of one planting category, gap-tolerant, descending. */
function plantClusters(g: EvalGrid, category: ItemCategory): number[] {
  const { W, H } = g;
  const mine = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const id = g.plantAt[i];
    if (id !== undefined && categoryOf({ catalogId: id } as PlacedObject) === category) mine[i] = 1;
  }
  const seen = new Uint8Array(W * H);
  const out: number[] = [];
  for (let start = 0; start < W * H; start++) {
    if (!mine[start] || seen[start]) continue;
    let n = 0;
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const p = stack.pop()!;
      n++;
      const x = p % W, y = (p / W) | 0;
      for (let dy = -GRAIN_GAP; dy <= GRAIN_GAP; dy++) {
        for (let dx = -GRAIN_GAP; dx <= GRAIN_GAP; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (seen[j] || !mine[j]) continue;
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    out.push(n);
  }
  return out.sort((a, b) => b - a);
}

const median = (xs: readonly number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const half = s.length >> 1;
  return s.length % 2 ? s[half]! : (s[half - 1]! + s[half]!) / 2;
};
