/*
 * stencil-palette.ts — WHAT a picture may be built out of.
 *
 * The image mode matches every cell against a palette of things and places the nearest, so the
 * palette IS the material choice: the whole catalogue of one-cell items, the flowers alone, the trees
 * alone, or the road surfaces. The split is not decoration — a picture tiled with trees and flowers
 * at once reads as a mess in game, where a tree stands far taller than a bloom, and a picture tiled
 * with paths is flat ground with a drawing on it.
 *
 * COLOURS COME FROM TWO PLACES, and only one of them needs a browser. A ROAD carries its own colour
 * in its catalog entry (the four plain surfaces by definition, the 25 in-game paths derived from the
 * shipped tile), so a road palette is assembled here, in the engine, from the live catalog. Every
 * other item is known by its SPRITE, and reading a sprite's dominant colour needs a canvas — that
 * palette is sampled on the main thread and handed down with the plan.
 */
import { ItemCategory } from '../../../core/model/types';
import type { CatalogItem } from '../../../core/model/types';
import { hexStringToNumber } from '../../../core/model/colors';
import { getAllItems } from '../../../state/catalog';
import { tilesAShape } from './stencil';

/**
 * The material an image is built from.
 *
 * `mixed` is the one-cell catalogue LESS THE TREES, and it is the decoration half of the mixed
 * picture — terrain for the ground and objects at the anchor points. Trees are left out of it on the
 * same grounds the split exists for: a tree stands far taller than a bloom, so a picture marked with
 * both reads as a mess in game, and a picture that wants trees asks for them with `trees`.
 * `flora` and `trees` are the same read confined to one category; `roads` paves the picture instead
 * of planting it.
 */
export type StencilMaterial = 'mixed' | 'flora' | 'trees' | 'roads';

/** One entry of a colour palette: the item to place, and the colour it reads as. */
export interface ColorEntry { catalogId: string; rgb: number }

/**
 * The items a material offers.
 *
 * ONE CELL EACH. An item with a bigger footprint would overlap the neighbour placed beside it and be
 * refused for it, so a colour mosaic can only be tiled with 1x1 items — which the catalogue has
 * plenty of, being mostly flowers and paths.
 *
 * Roads are read straight from the category rather than through `tilesAShape`: that filter answers a
 * different question (what a LETTER may be tiled with, where a coating is the road tools' business),
 * and a picture paved in paths is exactly what the material is for.
 */
export function paletteItems(material: StencilMaterial): CatalogItem[] {
  const single = (i: CatalogItem): boolean => i.width === 1 && i.height === 1 && i.maxCount === undefined;
  const all = getAllItems();
  if (material === 'roads') return all.filter((i) => i.category === ItemCategory.Road && single(i));
  const usable = all.filter((i) => tilesAShape(i) && single(i));
  if (material === 'flora') return usable.filter((i) => i.category === ItemCategory.Flora);
  if (material === 'trees') return usable.filter((i) => i.category === ItemCategory.Tree);
  return usable.filter((i) => i.category !== ItemCategory.Tree);
}

/**
 * The colour a catalog item reads as, or null where nothing in its entry says.
 *
 * TWO FIELDS, ONE QUESTION. `color` is what an item PAINTS with instead of a sprite (the road
 * surfaces), and `iconColor` is what an item's sprite reads as, derived from the shipped PNG by
 * the project's colour-extraction tooling. Both answer "what colour is this item", and the painted
 * one wins where an item has both, since that is the colour the map actually shows.
 */
function itemColor(item: CatalogItem): number | null {
  const hex = item.color ?? item.iconColor;
  return hex ? hexStringToNumber(hex) : null;
}

/**
 * The palette for a material whose items declare their own colour.
 *
 * WHICH IS EVERY MATERIAL: each item's colour is derived data in the catalog (`iconColor`), so the
 * engine answers the question itself, without a canvas or a page — a candidate worker and the offline
 * benchmark read the same palette the main thread does.
 *
 * An item with no colour of either kind is left out rather than guessed at.
 */
export function declaredColorPalette(material: StencilMaterial): ColorEntry[] {
  const out: ColorEntry[] = [];
  for (const item of paletteItems(material)) {
    const rgb = itemColor(item);
    if (rgb === null) continue;
    out.push({ catalogId: item.id, rgb });
  }
  return out;
}

/** Whether a material's palette can be built without a canvas — true where every item it offers
 *  declares a colour, sprite-derived or painted. */
export function materialDeclaresColors(material: StencilMaterial): boolean {
  const items = paletteItems(material);
  return items.length > 0 && items.every((i) => itemColor(i) !== null);
}
