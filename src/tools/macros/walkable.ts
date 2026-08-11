/**
 * What a road run can walk, and what it reaches.
 *
 * Two facts; everything else is a caller's argument:
 *   - `networkCells` — the cells the network occupies. A road tile, a bridge deck, a ramp deck.
 *   - `floodFrom` — what a 4-connected walk reaches, given whatever the caller counts as passable.
 */
import { NEIGHBORS4 } from '../../core/model/grid-model';
import { objectRect } from '../../state/object-geometry';
import { categoryOf } from '../../state/catalog';
import { ItemCategory, type GridState } from '../../core/model/types';

export interface NetworkCells {
  /** Every cell the network occupies: pavement and decks, plus each deck's apron when asked for. */
  cells: Set<number>;
  /** The deck cells alone. A deck is walkable but is not a surface a tile may be laid on: it is
   *  already the road there, and a tile on one stands at the height of the ground beneath it. */
  decks: Set<number>;
}

/**
 * The network as it stands on `state`.
 *
 * `aprons` widens each deck by its 4-neighbours. A crossing's transition cell often refuses a tile
 * (the `flat` trait sees the change of level), so the pavement either side of a deck is one piece
 * with a legitimate one-cell gap at each end. A caller asking which cells are PAVED wants it off; one
 * asking what can be WALKED wants it on.
 */
export function networkCells(
  state: GridState, W: number, H: number, opts: { aprons?: boolean } = {},
): NetworkCells {
  const inB = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < W && y < H;
  const cells = new Set<number>();
  const decks = new Set<number>();
  const aprons: number[] = [];
  for (const o of state.objects.values()) {
    const cat = categoryOf(o);
    const deck = cat === ItemCategory.Bridge || cat === ItemCategory.Ramp;
    if (cat !== ItemCategory.Road && !deck) continue;
    const r = objectRect(o);
    // Floor the origin: a halfStep deck anchors on the half grid and still occupies whole cells.
    for (let y = Math.floor(r.y); y < r.y + r.h; y++) {
      for (let x = Math.floor(r.x); x < r.x + r.w; x++) {
        if (!inB(x, y)) continue;
        const i = y * W + x;
        cells.add(i);
        if (!deck) continue;
        decks.add(i);
        if (opts.aprons) for (const [dx, dy] of NEIGHBORS4) if (inB(x + dx, y + dy)) aprons.push((y + dy) * W + (x + dx));
      }
    }
  }
  for (const i of aprons) cells.add(i);
  return { cells, decks };
}

/** What a 4-connected walk from `seeds` reaches, over whatever the caller counts as passable. */
export function floodFrom(
  seeds: Iterable<number>, passable: (i: number) => boolean, W: number, H: number,
): Uint8Array {
  const reach = new Uint8Array(W * H);
  const queue: number[] = [];
  for (const i of seeds) if (i >= 0 && i < reach.length && !reach[i]) { reach[i] = 1; queue.push(i); }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]!;
    const x = i % W, y = (i / W) | 0;
    for (const [dx, dy] of NEIGHBORS4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const ni = ny * W + nx;
      if (reach[ni] || !passable(ni)) continue;
      reach[ni] = 1; queue.push(ni);
    }
  }
  return reach;
}

/** The 4-connected piece each cell of `cells` belongs to. */
export function components(cells: ReadonlySet<number>, W: number, H: number): Map<number, number> {
  const comp = new Map<number, number>();
  let next = 0;
  for (const seed of cells) {
    if (comp.has(seed)) continue;
    const id = next++;
    comp.set(seed, id);
    const queue = [seed];
    for (let q = 0; q < queue.length; q++) {
      const i = queue[q]!, x = i % W, y = (i / W) | 0;
      for (const [dx, dy] of NEIGHBORS4) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const ni = ny * W + nx;
        if (cells.has(ni) && !comp.has(ni)) { comp.set(ni, id); queue.push(ni); }
      }
    }
  }
  return comp;
}
