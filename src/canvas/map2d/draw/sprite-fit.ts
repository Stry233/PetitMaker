import * as PIXI from 'pixi.js-legacy';
import { requestRender as broadcastRender } from '../render-scheduler';

/**
 * Fit `sprite` to its texture and reveal it: apply the scale from
 * `computeScale(texW, texH)` and set it visible. If the texture has already
 * decoded, fit synchronously; otherwise hide the sprite and fit once the
 * baseTexture fires 'loaded' (avoids reading width=0 before decode).
 *
 * A deferred 'loaded' / context-restore reupload can fire after the sprite was
 * destroyed (layer rebuilt, or WebGL context lost when the 3D preview opened) —
 * touching sprite.scale then throws on a null transform and breaks the
 * render/event loop, so the fit guards `destroyed`/`transform` first. A LATE
 * (deferred) fit also calls `requestRender()` so render-on-demand repaints the
 * now-visible sprite (the synchronous path already runs inside a render pass).
 */
/** Sprite size relative to the object footprint: catalog art carries transparent margin, so a
 *  small overshoot makes the drawn thing read at the size of its cells. */
export const SPRITE_FILL = 1.1;

/**
 * The scale that CONTAINS an item's icon inside its footprint box, keeping the icon's own aspect.
 *
 * ONE number for both axes — the placed sprite and the drag/placement ghost both fit through this,
 * so a ghost can never show the item at a shape the placement will not produce.
 */
export function footprintFit(fw: number, fh: number, fill: number = SPRITE_FILL) {
  return (tw: number, th: number): number => Math.min(fw / tw, fh / th) * fill;
}

export function fitSpriteToTexture(
  sprite: PIXI.Sprite,
  tex: PIXI.Texture,
  computeScale: (texW: number, texH: number) => number,
  /** Mirror the art across its own vertical axis. Applied HERE because the fit re-runs when the
   *  texture finishes decoding, and a flip written by the caller beforehand would be overwritten. */
  flipX = false,
  /** Opens the render window of the renderer the sprite lives on — the caller's own field, or the
   *  module broadcast for one with none. */
  requestRender: () => void = broadcastRender,
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
