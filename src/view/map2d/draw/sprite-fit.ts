import * as PIXI from 'pixi.js-legacy';
import type { SpritePose } from './object-sprite';

/**
 * Poses `sprite` on `tex` as `pose` says, over a footprint whose corner stands at `origin` (px in
 * the sprite's parent), and reveals it: at once when the texture has decoded, otherwise hidden
 * until it fires 'loaded'. A late fit can land after the sprite was destroyed, so it checks first,
 * and it opens a render window, since nothing else will paint the now-visible sprite.
 */
export function poseSprite(
  sprite: PIXI.Sprite, pose: SpritePose, tex: PIXI.Texture, origin: { x: number; y: number },
  /** Opens the render window of the renderer the sprite lives on. */
  requestRender: () => void,
): void {
  sprite.texture = tex;
  sprite.anchor.set(0.5);
  sprite.position.set(origin.x + pose.x, origin.y + pose.y);
  sprite.rotation = pose.rotation;
  // The mirror is part of the scale, which re-runs when the texture finishes decoding.
  const fit = (rerender: boolean) => {
    if (sprite.destroyed || !sprite.transform) return;
    const tw = tex.width, th = tex.height;
    if (!tw || !th) return;
    const s = pose.scale(tw, th);
    sprite.scale.set(pose.flipX ? -s.x : s.x, s.y);
    sprite.visible = true;
    if (rerender) requestRender();
  };
  sprite.visible = false;
  if (tex.baseTexture.valid) fit(false);
  else tex.baseTexture.once('loaded', () => fit(true));
}
