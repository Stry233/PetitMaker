/* A blueprint body: a region of a map, terrain and objects, held apart from any map so it can be
 * laid elsewhere. Heights are rises above the region's lowest ground, so a body lands at any layer. */
import type { Corners, Rotation, TerrainType } from './types';

/** One terrain cell of a body; its heights are rises above the body's lowest ground. Mountain at
 *  rise 0 is never stored: the lowest ground lands as the surface under the placement, so such a
 *  cell is null. Water keeps its entry at rise 0. */
export interface BlueprintCell {
  readonly type: TerrainType;
  readonly rise: number;
  readonly corners?: Corners;
  /** Set only on a cosmetic fillet (`TerrainCell.patchOnly`). */
  readonly patchOnly?: boolean;
  /** The fillet's real support as a rise (`TerrainCell.patchBase`). */
  readonly patchBase?: number;
}

/** One object of a body, anchored at its footprint's top-left relative to the frame's top-left
 *  object cell (a half-step item may sit on half cells). */
export interface BlueprintObject {
  readonly catalogId: string;
  readonly x: number;
  readonly y: number;
  readonly rotation: Rotation;
  readonly rise: number;
  readonly spanLength?: number;
  readonly corners?: Corners;
}

/**
 * A region framed as `w` by `h` object-grid cells. Terrain lies on the terrain grid, offset half a
 * cell from the object grid, so the frame rests on `(w + 1) * (h + 1)` terrain cells, the first half
 * a cell above and left of the frame's top-left: `cells` holds them row by row, and a null cell
 * holds no terrain and leaves its target alone.
 */
export interface BlueprintBody {
  readonly w: number;
  readonly h: number;
  readonly cells: readonly (BlueprintCell | null)[];
  readonly objects: readonly BlueprintObject[];
}
