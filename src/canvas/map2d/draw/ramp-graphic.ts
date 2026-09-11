import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { TILE_SIZE } from '../../../core/model/constants';
import type { CatalogItem, PlacedObject } from '../../../core/model/types';
export { isRampItem } from '../object-sprite-url';
import { iconUrl } from '../../../assets/icon-urls';
import { requestRender as broadcastRender } from '../render-scheduler';
import { getIconTexture } from './icon-color';
import { fitSpriteToTexture } from './sprite-fit';
import { lerpColor } from '../layers/object-animations';

const RAMP_ARROWS: Record<number, string> = { 0: '↑', 90: '←', 180: '↓', 270: '→' };

/**
 * How to turn the ramp's icon so the art climbs the way the ramp does.
 *
 * Every ramp is drawn the same way: low on the left, high on the right. A ramp that climbs the
 * other way is the same picture MIRRORED — not turned upside down, which is what a half turn would
 * give. The two vertical directions are quarter turns of it. Uphill by rotation is the arrow table
 * above: 0 north, 90 west, 180 south, 270 east.
 */
export function rampIconTurn(rotation: number): { rotation: number; flipX: boolean } {
  switch (((rotation % 360) + 360) % 360) {
    case 90: return { rotation: 0, flipX: true };              // uphill west — mirrored
    case 0: return { rotation: -Math.PI / 2, flipX: false };   // uphill north
    case 180: return { rotation: Math.PI / 2, flipX: false };  // uphill south
    default: return { rotation: 0, flipX: false };             // uphill east — the art as drawn
  }
}

// Per-type base colour for the ramp footprint gradient: the HUE encodes the
// ramp type, while the high→low brightness ramp encodes the slope direction.
// (Layer is read from the high/low elevation numbers.) Falls back to grey.
const RAMP_COLORS: Record<string, number> = {
  'ramp-park-steps': 0xb8aeb0,   // park stone — cool grey
  'ramp-retro-steps': 0xb39a86,  // retro brick — warm taupe
  'ramp-light-stair': 0xddbe8e,  // light wood — pale tan
  'ramp-teak-stair': 0xb68a5c,   // teak — mid brown
  'ramp-moss-ramp': 0xafc57e,    // moss stone — olive green
  'ramp-green-steps': 0x95c58e,  // green steps — fresh green
  'ramp-plank': 0xc79e6e,        // plank — wood brown
};

function getRampLayers(item: CatalogItem): number {
  const t = item.traits.find(t => t.type === 'heightDrop');
  return t?.type === 'heightDrop' ? t.layers : 1;
}

export function drawRamp(
  wrapper: PIXI.Container, obj: PlacedObject,
  item: CatalogItem, size: { w: number; h: number },
  showNumbers: boolean,
  /** Opens the render window of the renderer the wrapper lives on — the caller's own field, or
   *  the module broadcast for one with none. */
  requestRender: () => void = broadcastRender,
): void {
  const layers = getRampLayers(item);
  const highElev = obj.elevation;
  const lowElev = highElev - layers;
  // Gradient hue comes from the ramp TYPE; the high→low brightness shows the
  // slope direction (darker at the high end, lighter at the low end).
  const base = RAMP_COLORS[obj.catalogId] ?? 0xb0b0a8;
  const highColor = lerpColor(base, 0x000000, 0.20);
  const lowColor = lerpColor(base, 0xffffff, 0.42);
  const spanAxis = (obj.rotation === 0 || obj.rotation === 180) ? 'y' : 'x';
  const highAtStart = (obj.rotation === 0 || obj.rotation === 90);
  const spanCells = spanAxis === 'y' ? size.h : size.w;
  const perpCells = spanAxis === 'y' ? size.w : size.h;

  const g = new PIXI.Graphics();
  const totalHalves = spanCells * 2;
  for (let half = 0; half < totalHalves; half++) {
    const t = totalHalves > 1 ? half / (totalHalves - 1) : 0;
    const color = highAtStart
      ? lerpColor(highColor, lowColor, t)
      : lerpColor(lowColor, highColor, t);
    g.beginFill(color, 0.85);
    const hSize = TILE_SIZE / 2;
    if (spanAxis === 'y') {
      g.drawRect(0, half * hSize, perpCells * TILE_SIZE, hSize);
    } else {
      g.drawRect(half * hSize, 0, hSize, perpCells * TILE_SIZE);
    }
    g.endFill();
  }
  wrapper.addChild(g);

  // Per-type sprite — a small icon badge, never stretched to the footprint. It carries the ramp's
  // TYPE and, turned by `rampIconTurn`, the way it climbs: the art is drawn low-left to high-right,
  // so a ramp running the other way shows the same picture mirrored and a vertical one a quarter
  // turn of it. The gradient and the elevation numbers still carry the layers.
  const fw = size.w * TILE_SIZE, fh = size.h * TILE_SIZE;
  const spriteUrl = item.icon ? iconUrl(item.icon) : undefined;
  if (spriteUrl) {
    const tex = getIconTexture(spriteUrl);
    const sprite = new PIXI.Sprite(tex);
    sprite.anchor.set(0.5);
    sprite.x = fw / 2;
    sprite.y = fh / 2;
    const turn = rampIconTurn(obj.rotation);
    sprite.rotation = turn.rotation;
    const badge = Math.min(fw, fh) * 0.8; // fits the short side, aspect preserved
    fitSpriteToTexture(sprite, tex, (tw, th) => badge / Math.max(tw, th), turn.flipX, requestRender);
    wrapper.addChild(sprite);
  }

  // Uphill arrow — a compact, always-on DIRECTION cue layered over the sprite.
  const arrow = RAMP_ARROWS[obj.rotation] ?? '↑';
  const arrowLabel = new PIXI.Text(arrow, {
    fontSize: Math.min(size.w, size.h) * TILE_SIZE * 0.34,
    fontFamily: APP_FONT_FAMILY,
    fill: 0xffffff,
    stroke: 0x000000,
    strokeThickness: 3,
  });
  arrowLabel.anchor.set(0.5);
  arrowLabel.alpha = 0.9;
  arrowLabel.x = fw / 2;
  arrowLabel.y = fh / 2;
  wrapper.addChild(arrowLabel);

  const numStyle = {
    fontSize: 14, fontWeight: 'bold' as const, fontFamily: APP_FONT_FAMILY,
    fill: 0xffffff, stroke: 0x000000, strokeThickness: 3,
  };
  const highNum = new PIXI.Text(String(highElev), numStyle);
  const lowNum = new PIXI.Text(String(lowElev), numStyle);
  highNum.name = '_elev';
  lowNum.name = '_elev';
  highNum.visible = showNumbers;
  lowNum.visible = showNumbers;

  if (spanAxis === 'y') {
    const hRow = highAtStart ? 0 : size.h - 1;
    const lRow = highAtStart ? size.h - 1 : 0;
    highNum.x = 3; highNum.y = (hRow + 1) * TILE_SIZE - 3; highNum.anchor.set(0, 1);
    lowNum.x = 3; lowNum.y = (lRow + 1) * TILE_SIZE - 3; lowNum.anchor.set(0, 1);
  } else {
    const hCol = highAtStart ? 0 : size.w - 1;
    const lCol = highAtStart ? size.w - 1 : 0;
    highNum.x = hCol * TILE_SIZE + 3; highNum.y = size.h * TILE_SIZE - 3; highNum.anchor.set(0, 1);
    lowNum.x = lCol * TILE_SIZE + 3; lowNum.y = size.h * TILE_SIZE - 3; lowNum.anchor.set(0, 1);
  }
  wrapper.addChild(highNum);
  wrapper.addChild(lowNum);
}
