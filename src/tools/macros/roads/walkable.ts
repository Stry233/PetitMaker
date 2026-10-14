/**
 * What a road run can walk, and what it reaches.
 *
 * Two facts; everything else is a caller's argument:
 *   - `networkCells` — the cells the network occupies. A road tile, a bridge deck, a ramp deck.
 *   - `floodFrom` — what a 4-connected walk reaches, given whatever the caller counts as passable.
 */
import { NEIGHBORS4 } from '../../../core/grid/directions';
import { objectRect } from '../../../state/object-geometry';
import { getCatalogItem } from '../../../state/catalog';
import { type GridState } from '../../../core/model/types';
import { isCoatingItem, isSurfacePrint, isCrossing } from '../../../core/model/traits';
import { mapGrid } from '../../../core/grid/rect';

interface NetworkCells {
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
 * with a legitimate one-cell gap at each end. A caller asking which cells are paved wants it off; one
 * asking what can be walked wants it on.
 */
export function networkCells(
  state: GridState, W: number, H: number, opts: { aprons?: boolean } = {},
): NetworkCells {
  const { inB } = mapGrid(W, H);
  const cells = new Set<number>();
  const decks = new Set<number>();
  const aprons: number[] = [];
  for (const o of state.objects.values()) {
    const item = getCatalogItem(o.catalogId);
    const deck = isCrossing(item);
    if (isSurfacePrint(item) || (!isCoatingItem(item) && !deck)) continue;
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

