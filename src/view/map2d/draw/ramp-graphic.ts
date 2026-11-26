import * as PIXI from 'pixi.js-legacy';
import { APP_FONT_FAMILY } from '../../../assets/fonts/family';
import { TILE_SIZE } from '../geometry/world';
import type { PlacedObject } from '../../../core/model/types';
import type { CatalogEntry } from '../../../config/catalog/catalog-entry';
import { getIconTexture } from './icon-texture';
import { poseSprite } from './sprite-fit';
import { objectSpritePose } from './object-sprite';
import { hexStringToNumber, lerpColor } from '../../../core/base/color';
import { rampDropLayers } from '../../../core/model/traits';
import { rampOrientation } from '../../../core/domain/terrain/ramp-span';
import { OBJECT_CHILD } from './object-children';

const RAMP_ARROWS: Record<number, string> = { 0: '↑', 90: '←', 180: '↓', 270: '→' };

/** The footprint gradient's base colour for a ramp whose catalog entry names none. */
const RAMP_DEFAULT_COLOR = 0xb0b0a8;

export function drawRamp(
  wrapper: PIXI.Container, obj: PlacedObject,
  item: CatalogEntry, size: { w: number; h: number },
  opts: {
    showNumbers: boolean;
    /** Opens the render window of the renderer the wrapper lives on. */
    requestRender: () => void;
  },
): void {
  const { showNumbers, requestRender } = opts;
  const layers = rampDropLayers(item);
  const highElev = obj.elevation;
  const lowElev = highElev - layers;
  // The hue comes from the catalog item; the high→low brightness shows the slope direction
  // (darker at the high end, lighter at the low end).
  const base = item.footprintColor ? hexStringToNumber(item.footprintColor) : RAMP_DEFAULT_COLOR;
  const highColor = lerpColor(base, 0x000000, 0.20);
  const lowColor = lerpColor(base, 0xffffff, 0.42);
  const { spanAxis, highAtStart } = rampOrientation(obj.rotation);
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

  // Per-type sprite: a small icon badge carrying the ramp's type and, turned and mirrored as
  // `object-sprite.ts:rampIconTurn` says, the way it climbs. The gradient and the elevation numbers
  // still carry the layers.
  const fw = size.w * TILE_SIZE, fh = size.h * TILE_SIZE;
  const pose = objectSpritePose(obj, item, size);
  if (pose?.art.kind === 'icon') {
    const sprite = new PIXI.Sprite();
    poseSprite(sprite, pose, getIconTexture(pose.art.url), { x: 0, y: 0 }, requestRender);
    wrapper.addChild(sprite);
  }

  // Uphill arrow — a compact, always-on direction cue layered over the sprite.
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
  highNum.name = OBJECT_CHILD.elevation;
  lowNum.name = OBJECT_CHILD.elevation;
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
