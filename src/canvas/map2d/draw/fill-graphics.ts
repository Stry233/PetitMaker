/*
 * fill-graphics.ts — a Graphics that replays its own fills on the Canvas2D fallback.
 *
 * The Canvas2D renderer retains no geometry: every rendered frame walks a Graphics' `graphicsData`
 * and re-issues each fill. Pixi's CanvasGraphicsRenderer converts the fill colour through
 * @pixi/color and writes `context.fillStyle` — a CSS colour parse — once PER ITEM, whatever the
 * item before it held. The dense planet's terrain is ~42k items a frame carrying FIVE distinct
 * colours and 959 colour changes, and that conversion plus the style writes measured ~22% of a pan.
 *
 * This class issues the same canvas calls with the same arguments in the same order, computing the
 * '#rrggbb' string once per (colour, tint) pair and writing context state only when it changes:
 * assigning a value the context already holds is a no-op, so the pixels are identical by
 * construction. Anything it does not recognise — a line style, a textured fill, a hole, a per-shape
 * matrix, a circle or ellipse — goes straight back to pixi's own renderer, unchanged.
 *
 * WebGL never reaches this file. The GL path renders through `_render`, which is not overridden.
 */
import * as PIXI from 'pixi.js-legacy';

/** '#rrggbb' per (fill colour, graphics tint), by pixi's own conversion. Five entries on a map. */
const styleCache = new Map<number, string>();

function fillStyle(color: number, tint: number, tintRgba: number[]): string {
  const key = color * 0x1000000 + tint;
  const hit = styleCache.get(key);
  if (hit !== undefined) return hit;
  const value = PIXI.Color.shared.setValue(color).multiply(tintRgba).toNumber();
  const css = `#${`00000${(value | 0).toString(16)}`.slice(-6)}`;
  styleCache.set(key, css);
  return css;
}

/** Every item a plain visible fill of a rectangle or a simple polygon — the shape this replays. */
function isFillOnly(data: readonly PIXI.GraphicsData[]): boolean {
  for (let i = 0; i < data.length; i++) {
    const d = data[i]!;
    if (d.matrix || d.holes.length > 0) return false;
    if (!d.fillStyle.visible || d.lineStyle.visible) return false;
    const texture = d.fillStyle.texture;
    if (texture && texture.baseTexture !== PIXI.Texture.WHITE.baseTexture) return false;
    if (d.type !== PIXI.SHAPES.RECT && d.type !== PIXI.SHAPES.POLY) return false;
  }
  return true;
}

export class FillGraphics extends PIXI.Graphics {
  /** The Canvas2D draw path (`_renderCanvas` is what @pixi/canvas-graphics puts on Graphics). */
  _renderCanvas(renderer: PIXI.CanvasRenderer): void {
    if (this.isMask === true) return;
    this.finishPoly();
    const data = this.geometry.graphicsData;
    if (!isFillOnly(data)) {
      renderer.plugins.graphics.render(this);
      return;
    }

    const context = renderer.canvasContext.activeContext;
    renderer.canvasContext.setContextTransform(this.transform.worldTransform);
    renderer.canvasContext.setBlendMode(this.blendMode);

    const tintColor = PIXI.Color.shared.setValue(this.tint);
    const tintRgba = tintColor.toArray();
    const tint = tintColor.toNumber();
    const worldAlpha = this.worldAlpha;
    let style = '';
    let alpha = -1;

    for (let i = 0; i < data.length; i++) {
      const d = data[i]!;
      const next = fillStyle(d.fillStyle.color | 0, tint, tintRgba);
      if (next !== style) context.fillStyle = style = next;
      const a = d.fillStyle.alpha * worldAlpha;
      if (a !== alpha) context.globalAlpha = alpha = a;

      if (d.type === PIXI.SHAPES.RECT) {
        const r = d.shape as PIXI.Rectangle;
        context.fillRect(r.x, r.y, r.width, r.height);
      } else {
        const points = (d.shape as PIXI.Polygon).points;
        context.beginPath();
        context.moveTo(points[0]!, points[1]!);
        for (let j = 2; j < points.length; j += 2) context.lineTo(points[j]!, points[j + 1]!);
        if ((d.shape as PIXI.Polygon).closeStroke) context.closePath();
        context.fill();
      }
    }
  }
}
