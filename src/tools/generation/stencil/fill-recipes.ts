/**
 * The materials a stencil is built from, as the shelf and Help name them, and the plan fields each
 * one becomes: a letter's fill, and a picture's tile palette, decoration and water role.
 */
import { TerrainType } from '../../../core/model/types';
import type { StencilWaterRole } from '../recipe';
import type { StencilFill } from './stencil-plan';
import type { ObjectPaletteKind } from './stencil-palette';

/** Material families available to text and image stencils. */
export type StencilFillKind = 'mountain' | 'water' | 'object' | 'flora' | 'trees' | 'road' | 'print';

/**
 * `tiles` selects a per-cell catalog palette, `decor` adds sparse anchor objects, and `water` defines water's terrain role.
 * Mixed uses terrain with palette water plus sparse non-tree objects; Water builds the figure itself from water.
 */
export interface PictureRecipe {
  tiles: ObjectPaletteKind | null;
  decor: ObjectPaletteKind | null;
  water: StencilWaterRole;
}

export function pictureRecipe(fill: StencilFillKind): PictureRecipe {
  if (fill === 'road') return { tiles: 'roads', decor: null, water: 'none' };
  if (fill === 'flora' || fill === 'trees') return { tiles: fill, decor: null, water: 'none' };
  if (fill === 'object') return { tiles: null, decor: 'mixed', water: 'palette' };
  return { tiles: null, decor: null, water: fill === 'water' ? 'primary' : 'none' };
}

/** A letter's fill for a material: connected prints, one catalog object, or terrain. */
export function letterRecipe(fill: StencilFillKind, catalogId = ''): StencilFill {
  if (fill === 'print') return { kind: 'stroke' };
  if (fill === 'object') return { kind: 'object', catalogId };
  return { kind: 'terrain', terrain: fill === 'water' ? TerrainType.Water : TerrainType.Mountain };
}
