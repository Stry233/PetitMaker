import * as PIXI from 'pixi.js-legacy';
import { requestRender } from '../render-scheduler';

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
export function fitSpriteToTexture(
  sprite: PIXI.Sprite,
  tex: PIXI.Texture,
  computeScale: (texW: number, texH: number) => number,
): void {
  const fit = (rerender: boolean) => {
    if (sprite.destroyed || !sprite.transform) return;
    const tw = tex.width, th = tex.height;
    if (!tw || !th) return;
    sprite.scale.set(computeScale(tw, th));
    sprite.visible = true;
    if (rerender) requestRender();
  };
  sprite.visible = false;
  if (tex.baseTexture.valid) fit(false);
  else tex.baseTexture.once('loaded', () => fit(true));
}
