import * as PIXI from 'pixi.js-legacy';
import type { PlacedObject } from '../../../../core/model/types';
import { objectRect } from '../../../../state/object-geometry';
import { TILE_SIZE } from '../../geometry/world';
import { FLAG_MARK, GHOST_LOSS } from '../../../shared/viewport/view-constants';
import type { OverlayHost } from './host';
import { paintItemSprite } from './ghost';

/** Objects flagged as standing where they may not: each footprint washed and edged in the loss red
 *  with its sprite over it, all above the object layer, so one under a landmark shows whole. The
 *  live overlay and the detached capture's pictures both draw them through this. */
export class OverlayFlagged {
  constructor(private readonly host: OverlayHost) {}

  private repaint = (): void => this.host.requestRender();

  readonly washGraphics = new PIXI.Graphics();
  readonly spriteSlot = new PIXI.Container();
  readonly edgeGraphics = new PIXI.Graphics();
  private flagged: readonly PlacedObject[] = [];

  show(objects: readonly PlacedObject[] | null): void {
    this.flagged = objects ?? [];
    this.draw();
  }

  /** Edges keep their screen width. */
  rezoom(): void { if (this.flagged.length > 0) this.draw(); }

  private draw(): void {
    this.host.requestRender();
    if (this.host.disposed) return;
    const wash = this.washGraphics, edge = this.edgeGraphics;
    wash.clear();
    edge.clear();
    for (const s of this.spriteSlot.removeChildren()) s.destroy();
    if (this.flagged.length === 0) return;
    wash.beginFill(GHOST_LOSS, FLAG_MARK.wash);
    edge.lineStyle(FLAG_MARK.edgePx / this.host.viewZoom, GHOST_LOSS, 1);
    for (const o of this.flagged) {
      const r = objectRect(o);
      const px = { x: r.x * TILE_SIZE, y: r.y * TILE_SIZE, w: r.w * TILE_SIZE, h: r.h * TILE_SIZE };
      wash.drawRect(px.x, px.y, px.w, px.h);
      edge.drawRect(px.x, px.y, px.w, px.h);
      const sprite = new PIXI.Sprite();
      const { catalogId, position: { x, y }, rotation, spanLength } = o;
      const at = { catalogId, x, y, rotation, ...(spanLength === undefined ? {} : { spanLength }) };
      if (paintItemSprite(sprite, at, true, this.repaint)) {
        this.spriteSlot.addChild(sprite);
      } else {
        sprite.destroy();
      }
    }
    wash.endFill();
    edge.lineStyle();
  }
}
