/**
 * Plants the banks: the alternating runs along the water's edge, read off the finished map's water.
 */
import { flatIndex } from '../../../../core/grid/rect';
import { TerrainType } from '../../../../core/model/types';
import { getCatalogItem } from '../../../../state/catalog';
import type { PlaceCtx } from '../../../placement/object';
import { familyOf, speciesOf } from './palette';
import type { KitCanvas, PlantMark } from './types';

/**
 * How long a bank row runs, and how deep from the water it is drawn.
 *
 * Near-water planting is almost all same-species straight runs, most of them 5 or 6 long. So a bank
 * is planted as rows of one species rather than as whatever the kit's tiling happened to put there,
 * which is the whole difference between water a map is composed around and water a map merely
 * contains.
 */
const BANK_RUN = { min: 5, max: 6 } as const;
const BANK_DEPTH = 2;
/** How much of a run's own planting budget the banks may take. The rows are drawn outside the cover
 *  the budget correction scales, so without a cap a watery place plants its shores and its beds and
 *  the map's decoration density lands over its band. */
const BANK_SHARE = 0.5;
/** How often a bank row alternates two species of its family instead of running one. Banks carry both
 *  grammars, same-species runs and framed troughs alternating every row; a third, so the
 *  single-species run stays the dominant reading. */
const BANK_ALTERNATE = 0.34;

/**
 * The rows a run plants along its water.
 *
 * Which bank is not a matter of taste. A plant validates its own cell plus one column right and one
 * row below, so a cell with water to its east or south can never carry one: a water-adjacent plant
 * always has the water to its north or west, never to its east, south or south-east. So the rows are
 * drawn on the banks the sweep leaves standing, and nowhere else.
 *
 * A row runs along the water it is drawn beside and is one species from end to end. Rows are laid
 * from the water outward to `BANK_DEPTH`: 2 cells rather than 1 holds half of a bank's planting.
 */
export function bankMarks(canvas: KitCanvas, water: Uint8Array, W: number, H: number): PlantMark[] {
  const out: PlantMark[] = [];
  const done = new Set<number>();
  const budget = Math.max(0, Math.round(BANK_SHARE * canvas.cover * canvas.cells.size));
  // A row index is not a bounds check: (x - k) on row y with a negative x reads the end of row y-1,
  // which would answer "water" for a cell on the other side of the map.
  const wet = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < W && y < H && water[flatIndex(x, y, W)] === 1;
  /** The direction the water lies in from a plantable cell, or null where it is not a bank. */
  const bankAt = (x: number, y: number): 'north' | 'west' | null => {
    for (let k = 1; k <= BANK_DEPTH; k++) {
      for (const dx of [-1, 0, 1]) if (wet(x + dx, y - k)) return 'north';
      if (wet(x - k, y) || wet(x - k, y + 1)) return 'west';
    }
    return null;
  };
  // A row is a row of one species, so the species has to be one that may stand beside itself: an
  // item carrying `exclusionRadius` refuses its own neighbour, and a run of it is a run of refusals
  // the composed mirror then reads as holes.
  const rowable = (id: string): boolean =>
    !getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius');
  const pick = (...ids: string[]): string | null => ids.find(rowable) ?? null;
  const species = pick(canvas.palette.species('mass'), canvas.palette.species('edge'));
  const edge = pick(canvas.palette.species('edge'), canvas.palette.species('mass'));
  const grove = pick(canvas.palette.species('grove'), canvas.palette.species('grove-accent'));
  for (const i of [...canvas.cells].sort((a, b) => a - b)) {
    if (out.length >= budget) break;
    if (done.has(i)) continue;
    const x = i % W, y = (i / W) | 0;
    const side = bankAt(x, y);
    if (!side) continue;
    // A row runs along the shore: across a bank whose water is north, down one whose water is west.
    const [dx, dy] = side === 'north' ? [1, 0] : [0, 1];
    const length = BANK_RUN.min + canvas.rng.int(BANK_RUN.max - BANK_RUN.min + 1);
    // A share of the rows is trees at step 2, which is how the target plants its own waterside (101
    // same-species runs at step 1 and 32 at step 2, and the comb's dry ridges each holding one peach).
    // It is also what keeps the bank from planting flowers only: the rows are a large share of a watery
    // map's decoration, and a flower-only bank drags the whole planet's trees-to-flowers ratio off the
    // axis whatever the kits do.
    const treeRow = canvas.rng.float() < canvas.treeShare && grove !== null;
    const id = treeRow ? grove : (canvas.rng.int(3) === 0 ? edge : species) ?? species ?? edge;
    if (!id) continue;
    const step = treeRow ? 2 : 1;
    // And a share of the rows alternates two species of one family. The richest water gardens
    // are beds of two 5-wide single-species blocks side by side, or three rows of a two-species
    // period-2 alternation kept inside one colour family, and the framed troughs below them alternate
    // to the last row. A row of one species and a row of two read as the same grammar at map scale
    // precisely because the two species share a family: what alternates is the plant, never the colour.
    const pair = treeRow ? null : alternation(canvas, id);
    for (let k = 0; k < length; k++) {
      const cx = x + dx * k * step, cy = y + dy * k * step;
      const j = flatIndex(cx, cy, W);
      if (!canvas.cells.has(j) || done.has(j) || !bankAt(cx, cy)) break;
      done.add(j);
      out.push({ x: cx, y: cy, catalogId: pair ? pair[k % 2]! : id });
    }
  }
  return out;
}

/**
 * The two species one row alternates between, or null where this row is a single-species one.
 *
 * The second species is drawn from the same colour family as the first, since the alternation is in the
 * plant and never in the colour, and it must be able to stand beside a neighbour for the same reason a
 * single-species row's species must. A family that offers only one such flora answers null, and the row
 * runs a single species.
 */
function alternation(canvas: KitCanvas, first: string): [string, string] | null {
  if (canvas.rng.float() >= BANK_ALTERNATE) return null;
  const family = familyOf(first);
  const second = speciesOf('groundcover', family)
    .find((id) => id !== first && !getCatalogItem(id)?.traits?.some((t) => t.type === 'exclusionRadius'));
  return second ? [first, second] : null;
}

/** Water on the finished map, as a mask the bank rows are drawn against. */
export function waterMask(state: PlaceCtx['state']): Uint8Array {
  const W = state.template.width, H = state.template.height;
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const t = state.cells[y]![x]!.terrain;
      if (t && t.type === TerrainType.Water) out[flatIndex(x, y, W)] = 1;
    }
  }
  return out;
}
