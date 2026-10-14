/** What a picture kind's plan is built from on a map: the box it fills, the cells it may write, and
 *  the material and knobs its plan reads. */
import { isBuildableZone } from '../../../core/game/zones';
import type { GridState, MacroCoord } from '../../../core/model/types';
import type { StencilKind } from '../kinds';
import { letterRecipe, pictureRecipe, type StencilFillKind } from './fill-recipes';
import type { PlanInputs } from './stencil-plan';
import { islandBox, regionBox, type StencilBox } from './stencil-raster';

/** The region's bounding box, or the buildable map's: a stencil has exactly as many cells as the
 *  area it fills. */
export function stencilBoxFor(grid: GridState | null, region: readonly MacroCoord[]): StencilBox | null {
  return regionBox(region) ?? (grid ? islandBox(grid, isBuildableZone) : null);
}

/** The region itself as flat indices, so everything outside the painted cells stays untouched;
 *  undefined for the whole map. */
export function regionAllow(grid: GridState | null, region: readonly MacroCoord[]): ReadonlySet<number> | undefined {
  if (!grid || region.length === 0) return undefined;
  const w = grid.template.width;
  return new Set(region.map((c) => c.y * w + c.x));
}

export interface PlanKnobs {
  fill: StencilFillKind;
  /** The catalog item an object letter tiles with; empty for none. */
  item: string;
  /** The picture's contrast as the engine's factor, 1 leaving the image alone. */
  contrast: number;
  allow?: ReadonlySet<number> | undefined;
}

/** A stencil kind's plan inputs: a letter's fill, and for a picture its tile palette, decoration and
 *  water role. */
export function planInputsFor(input: StencilKind, box: StencilBox, { fill, item, contrast, allow }: PlanKnobs): PlanInputs {
  const picture = input === 'image' ? pictureRecipe(fill) : null;
  return {
    box, fill: letterRecipe(fill, item), contrast,
    objects: picture?.tiles != null, water: picture?.water ?? 'none',
    ...(picture?.tiles ? { material: picture.tiles } : {}),
    ...(picture?.decor ? { decor: { species: picture.decor } } : {}),
    ...(allow ? { allow } : {}),
  };
}
