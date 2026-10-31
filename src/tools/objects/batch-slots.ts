/*
 * Where a Paint stroke lays its items (EDIT-65, EDIT-66): the spots along a path or over an area, each
 * holding the next picked item in turn, with at least the spacing's empty cells between neighbouring
 * footprints. Geometry only: which spots the rules take is the placement's to answer, so a refused
 * spot is skipped where it stands and never moves the spots after it.
 */
import type { CatalogItem, MacroCoord, Rotation } from '../../core/model/types';
import { getRotatedSize } from '../../core/grid/footprint';
import { cellKey } from '../../core/grid/rect';
import { placementGrab } from '../../state/object-geometry';

/** One spot of a stroke: the item it holds, its top-left anchor and its turn. */
export interface BatchSlot {
  item: CatalogItem;
  anchor: MacroCoord;
  rotation: Rotation;
}

/** How a stroke lays its spots: along a path, each held by its footprint's centre as a placement is,
 *  or over an area, each footprint wholly inside it and growing away from the corner `from`. */
export type BatchLayout =
  | { kind: 'path' }
  | { kind: 'area'; from: MacroCoord };

/**
 * The spots one stroke has laid so far. A freehand stroke adds the cells it sweeps as it goes; a
 * figure adds its whole cell list once. `kinds` cycle in order, one per spot; `spacing` empty cells
 * stand between any two footprints.
 */
export class BatchSlots {
  /** Cells no later footprint may take: every footprint so far grown by the spacing. */
  private readonly reserved = new Set<string>();
  private count = 0;

  constructor(
    private readonly kinds: readonly CatalogItem[],
    private readonly spacing: number,
    private readonly rotation: Rotation,
    private readonly layout: BatchLayout,
  ) {}

  /** The spots `cells` add, in the order the stroke reaches them. An area's cells may come in any
   *  order: they are walked row by row from its starting corner. */
  add(cells: readonly MacroCoord[]): BatchSlot[] {
    if (this.kinds.length === 0 || cells.length === 0) return [];
    const area = this.layout.kind === 'area' ? this.layout.from : null;
    const inside = area ? new Set(cells.map((c) => cellKey(c.x, c.y))) : null;
    const sx = area && cells.some((c) => c.x < area.x) ? -1 : 1;
    const sy = area && cells.some((c) => c.y < area.y) ? -1 : 1;
    const walk = area ? [...cells].sort((a, b) => sy * (a.y - b.y) || sx * (a.x - b.x)) : cells;
    const out: BatchSlot[] = [];
    for (const cell of walk) {
      const item = this.kinds[this.count % this.kinds.length]!;
      const rotation: Rotation = item.rotatable ? this.rotation : 0;
      const { w, h } = getRotatedSize(item, rotation);
      const grab = placementGrab(item, rotation);
      const anchor = area
        ? { x: sx > 0 ? cell.x : cell.x - w + 1, y: sy > 0 ? cell.y : cell.y - h + 1 }
        : { x: cell.x + grab.x, y: cell.y + grab.y };
      if (!this.fits(anchor, w, h, inside)) continue;
      this.reserve(anchor, w, h);
      this.count++;
      out.push({ item, anchor, rotation });
    }
    return out;
  }

  private fits(anchor: MacroCoord, w: number, h: number, inside: ReadonlySet<string> | null): boolean {
    for (let y = anchor.y; y < anchor.y + h; y++) {
      for (let x = anchor.x; x < anchor.x + w; x++) {
        const key = cellKey(x, y);
        if (this.reserved.has(key) || (inside && !inside.has(key))) return false;
      }
    }
    return true;
  }

  private reserve(anchor: MacroCoord, w: number, h: number): void {
    const s = this.spacing;
    for (let y = anchor.y - s; y < anchor.y + h + s; y++) {
      for (let x = anchor.x - s; x < anchor.x + w + s; x++) this.reserved.add(cellKey(x, y));
    }
  }
}
