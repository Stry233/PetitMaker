/**
 * The pure half of a layer-visibility toggle (no Pixi, unit-testable): which
 * cells can change appearance when a set of layers flips visible/hidden. A cell
 * renders at the highest visible layer at or below its elevation, so toggling
 * layer L can only re-tier cells whose elevation is at or above L — redrawing
 * exactly those keeps a panel click proportional to the affected cells.
 */
import { TerrainType } from '../../../core/model/types';
import type { Corners, GridState, MacroCoord, TerrainCell } from '../../../core/model/types';
import { getCell } from '../../../core/model/grid-model';
import { cutBackingByCorner, type CutBacking } from '../../../core/edge-cut/cut-backing';
import { patchCornerSplit } from '../../../core/edge-cut/patch-corners';

/** The highest visible layer at or below `elevation` (a cell renders there), or
 *  null when every layer it occupies is hidden. */
export function renderTier(elevation: number, hidden: ReadonlySet<number>): number | null {
  if (hidden.size === 0) return elevation;
  for (let e = elevation; e >= 0; e--) {
    if (!hidden.has(e)) return e;
  }
  return null;
}

/** One draw pass of a cell: the kept shape at `tier` with per-corner backing. */
export interface BlockPass {
  corners: Corners | undefined;
  tier: number;
  backing: readonly (CutBacking | null)[];
}

/** Everything drawCell needs to paint one cell: the base block pass plus, for a
 *  Γ patch, the fillet pass at its cosmetic tier. Null = nothing to draw. */
export interface CellRenderSpec {
  base: BlockPass | null;
  fillet: { corners: Corners; tier: number } | null;
}

const NO_BACKING: readonly (CutBacking | null)[] = [null, null, null, null];

/** A neighbour as the backing derivation should see it under layer visibility: a
 *  truncated stack renders as a full block at its visible tier, and a fully
 *  hidden one isn't there at all — backing must match what the neighbour draws. */
export function clampNeighbor(n: TerrainCell | null | undefined, hidden: ReadonlySet<number>): TerrainCell | null | undefined {
  if (!n || hidden.size === 0) return n;
  const tier = renderTier(n.elevation, hidden);
  if (tier === null) return null;
  if (tier === n.elevation) return n;
  if (n.patchOnly) {
    const base = Math.min(n.patchBase ?? (n.elevation - 1), tier);
    const floor = n.type === TerrainType.Water ? 0 : 1;
    return base >= floor ? { type: n.type, elevation: base } : null;
  }
  return { type: n.type, elevation: tier };
}

/**
 * The pure decision half of TerrainLayer.drawCell: which passes to paint for the
 * cell at (x, y) under the given hidden-layer set.
 *
 * Visibility semantics: hiding a stack's top tiers PEELS them off. The stored
 * corners describe the top silhouette, so a cell rendered below its own
 * elevation is a full square block (no cut, no backing) — a Γ patch whose fillet
 * tier is hidden shows its real base instead (with the base's own outer bevels
 * when the base tier is the render top). Cells at their full elevation keep the
 * normal trim rendering, with backing derived from neighbours as THEY render.
 */
export function cellRenderSpec(state: GridState, x: number, y: number, hidden: ReadonlySet<number>): CellRenderSpec | null {
  const terrain = getCell(state.cells, x, y)?.terrain;
  if (!terrain) return null;
  const corners = terrain.corners;
  if (corners && corners.every((c) => c === 'empty')) return null;
  const tier = renderTier(terrain.elevation, hidden);
  if (tier === null) return null;
  const neighborFn = (dx: number, dy: number): TerrainCell | null | undefined =>
    clampNeighbor(getCell(state.cells, x + dx, y + dy)?.terrain, hidden);

  if (tier < terrain.elevation) {
    if (terrain.patchOnly) {
      const base = terrain.patchBase ?? (terrain.elevation - 1);
      if (base < 1) return null; // cosmetic-only fillet: nothing real remains visible
      if (base <= tier) {
        // The base's own silhouette is the visible top — keep its outer bevels.
        const { baseCorners } = patchCornerSplit(state, x, y, terrain);
        return {
          base: {
            corners: baseCorners,
            tier: base,
            backing: cutBackingByCorner({ ...terrain, corners: baseCorners, elevation: base, patchOnly: false }, base, neighborFn),
          },
          fillet: null,
        };
      }
      return { base: { corners: undefined, tier, backing: NO_BACKING }, fillet: null };
    }
    return { base: { corners: undefined, tier, backing: NO_BACKING }, fillet: null };
  }

  if (terrain.patchOnly && corners) {
    const { baseTier, baseCorners, filletCorners } = patchCornerSplit(state, x, y, terrain);
    return {
      base: baseTier >= 1
        ? {
          corners: baseCorners,
          tier: baseTier,
          backing: cutBackingByCorner({ ...terrain, corners: baseCorners, elevation: baseTier, patchOnly: false }, baseTier, neighborFn),
        }
        : null,
      fillet: filletCorners.some((c) => c !== 'empty') ? { corners: filletCorners, tier: terrain.elevation } : null,
    };
  }

  return {
    base: { corners, tier, backing: cutBackingByCorner(terrain, tier, neighborFn) },
    fillet: null,
  };
}

/** The hidden-layer set a visibility record describes (false = hidden). */
export function hiddenSetFrom(visibility: Record<number, boolean>): Set<number> {
  const hidden = new Set<number>();
  for (const [layer, visible] of Object.entries(visibility)) {
    if (visible === false) hidden.add(Number(layer));
  }
  return hidden;
}

export function cellsAffectedByLayerToggle(state: GridState, changedLayers: number[]): MacroCoord[] {
  if (changedLayers.length === 0) return [];
  const minLayer = Math.min(...changedLayers);
  const { width, height } = state.template;
  const marked = new Uint8Array(width * height);
  const out: MacroCoord[] = [];
  const mark = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const i = y * width + x;
    if (marked[i]) return;
    if (!state.cells[y]?.[x]?.terrain) return;
    marked[i] = 1;
    out.push({ x, y });
  };
  for (let y = 0; y < height; y++) {
    const row = state.cells[y];
    if (!row) continue;
    for (let x = 0; x < width; x++) {
      const t = row[x]?.terrain;
      if (t && t.elevation >= minLayer) {
        mark(x, y);
        // A neighbour's cut backing derives from THIS cell's render tier, so the
        // toggle can re-tint a trimmed neighbour at any elevation.
        mark(x - 1, y); mark(x + 1, y); mark(x, y - 1); mark(x, y + 1);
      }
    }
  }
  return out;
}
