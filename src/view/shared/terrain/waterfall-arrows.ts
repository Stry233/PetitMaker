/**
 * The waterfall flow arrows both views draw, one white triangle per face a cell emits, and the gate
 * that says when an edit can change the faces. Each view scans the map it meshes and draws these
 * triangles in its own units.
 */
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { Direction } from '../../../core/grid/directions';
import { cellKey, parseCellKey } from '../../../core/grid/rect';
import { touchesWaterfallDependency, waterfallFaceMap } from '../../../core/domain/terrain/waterfall-geometry';

/** `cellKey` of a terrain cell → the directions its faces flow. */
export type WaterfallFaces = ReadonlyMap<string, readonly Direction[]>;

/** An arrow's half width and half length, in cells. */
const HALF = 1 / 6;
/** How far each arrow of a cell with more than one face sits from the centre toward its flow, in cells. */
const SPREAD = 0.2;

export const WATERFALL_ARROW_LOOK = { color: 0xffffff, alpha: 0.6 } as const;

/** One arrow: the terrain cell it sits on and its triangle, tip first, as x, y pairs in terrain-grid
 *  cells, where cell (x, y) spans [x, x + 1) by [y, y + 1). */
interface WaterfallArrow {
  readonly cell: MacroCoord;
  readonly points: readonly [number, number, number, number, number, number];
}

const FLOW: Record<Direction, { dx: number; dy: number }> = {
  north: { dx: 0, dy: -1 }, south: { dx: 0, dy: 1 }, west: { dx: -1, dy: 0 }, east: { dx: 1, dy: 0 },
};

/** The arrows of `faces`, leaving out every cell `shown` refuses. */
export function waterfallArrowTriangles(faces: WaterfallFaces, shown: (x: number, y: number) => boolean = () => true): WaterfallArrow[] {
  const arrows: WaterfallArrow[] = [];
  for (const [key, dirs] of faces) {
    const cell = parseCellKey(key);
    if (!shown(cell.x, cell.y)) continue;
    const spread = dirs.length > 1 ? SPREAD : 0;
    for (const dir of dirs) {
      const { dx, dy } = FLOW[dir];
      const cx = cell.x + 0.5 + dx * spread, cy = cell.y + 0.5 + dy * spread;
      // The tip points along the flow; the base runs across it.
      const px = -dy, py = dx;
      arrows.push({
        cell,
        points: [
          cx + dx * HALF, cy + dy * HALF,
          cx - dx * HALF + px * HALF, cy - dy * HALF + py * HALF,
          cx - dx * HALF - px * HALF, cy - dy * HALF - py * HALF,
        ],
      });
    }
  }
  return arrows;
}

/** The faces of the last scan, and whether edited cells can change them. */
export class WaterfallFaceWatch {
  private last: WaterfallFaces = new Map();

  get faces(): WaterfallFaces {
    return this.last;
  }

  /** A full-map scan of `state`. */
  scan(state: GridState): WaterfallFaces {
    this.last = waterfallFaceMap(state);
    return this.last;
  }

  /** Whether `cells`, as `state` now holds them, can change the faces: a cell that carried a face at
   *  the last scan (erasing a whole body leaves no water to depend on), or one beside the water a
   *  face depends on (`touchesWaterfallDependency`). */
  touchedBy(cells: Iterable<MacroCoord>, state: GridState): boolean {
    for (const { x, y } of cells) {
      if (this.last.has(cellKey(x, y))) return true;
      if (touchesWaterfallDependency(state, x, y)) return true;
    }
    return false;
  }
}
