import * as PIXI from 'pixi.js-legacy';
import type { CatalogItem } from '../../../core/model/types';
import { isBridge } from '../../../core/model/traits';

/**
 * Whether an item's icon turns with the placement's rotation: a rotatable item because the user
 * turned it, and a bridge because it lies along the gap it crosses.
 */
export function spriteTurns(item: CatalogItem | undefined): boolean {
  return !!item && (item.rotatable || isBridge(item));
}

/** Sprite size relative to the object footprint: catalog art carries transparent margin, so a
 *  small overshoot makes the drawn thing read at the size of its cells. */
const SPRITE_FILL = 1.1;

/** The sprite fill `item`'s art takes: contained in its footprint where it keeps its art inside. */
export function itemSpriteFill(item: Pick<CatalogItem, 'artInFootprint'> | undefined): number {
  return item?.artInFootprint ? 1 : SPRITE_FILL;
}

/**
 * The scale that contains an item's icon inside its footprint box, keeping the icon's own aspect.
 *
 * One number for both axes — the placed sprite and the drag/placement ghost both fit through this,
 * so a ghost can never show the item at a shape the placement will not produce.
 */
export function footprintFit(fw: number, fh: number, fill: number = SPRITE_FILL) {
  return (tw: number, th: number): number => Math.min(fw / tw, fh / th) * fill;
}

/**
 * Fits `sprite` to its texture with the scale `computeScale(texW, texH)` gives and reveals it: at
 * once when the texture has decoded, otherwise hidden until it fires 'loaded'. A late fit can land
 * after the sprite was destroyed, so it checks first, and it opens a render window, since nothing
 * else will paint the now-visible sprite.
 */
export function fitSpriteToTexture(
  sprite: PIXI.Sprite,
  tex: PIXI.Texture,
  computeScale: (texW: number, texH: number) => number,
  /** Mirror the art across its own vertical axis. Applied here because the fit re-runs when the
   *  texture finishes decoding, and a flip written by the caller beforehand would be overwritten. */
  flipX = false,
  /** Opens the render window of the renderer the sprite lives on. */
  requestRender: () => void,
): void {
  const fit = (rerender: boolean) => {
    if (sprite.destroyed || !sprite.transform) return;
    const tw = tex.width, th = tex.height;
    if (!tw || !th) return;
    const s = computeScale(tw, th);
    sprite.scale.set(flipX ? -s : s, s);
    sprite.visible = true;
    if (rerender) requestRender();
  };
  sprite.visible = false;
  if (tex.baseTexture.valid) fit(false);
  else tex.baseTexture.once('loaded', () => fit(true));
}
