/**
 * A capture of a state that is not the live map (a thumbnail, a candidate, a saved map): its own
 * base, terrain, object and optional notes layers built off stage, so the live camera, culling and
 * sprites stay untouched. Thumbnails frame the saved island or an explicit crop, excluding the
 * surrounding grid sea. Icons, road tiles and the road-band clipper must be ready before this
 * single-pass capture, so it waits for them.
 */
import * as PIXI from 'pixi.js-legacy';
import type { GridState } from '../../../core/model/types';
import { cellsCaptureFrame } from '../../../core/grid/map-chunks';
import { isCoatingItem } from '../../../core/model/traits';
import { getCatalogItem } from '../../../state/catalog';
import { iconUrl } from '../../../assets/icon-urls';
import { annotationInkScale } from '../../../core/model/annotation/text-metrics';
import { TILE_SIZE } from '../geometry/world';
import { surfaceImagesReady } from '../../shared/road/surface-image';
import { roadTileReady } from '../../shared/road/tile-texture';
import { roadMaterialSettled } from '../../shared/road/material';
import { noteTagLabel } from '../../shared/annotation/draw-options';
import { decodeIcons } from '../draw/icon-texture';
import { objectSpriteUrl } from '../draw/object-sprite-url';
import { BaseLayer } from '../layers/base-layer';
import { TerrainLayer } from '../layers/terrain-layer';
import { ObjectLayer } from '../layers/object-layer';
import { AnnotationLayer } from '../layers/annotation-layer';
import type { CellFrame } from './thumbnail';

/** A capture of a map no view shows: the longest side (640 px when omitted), the cells to frame
 *  (the whole map when omitted) and whether the plan notes draw. */
export interface DetachedCaptureOptions { maxPx?: number; frame?: CellFrame; annotations?: boolean }

export async function captureDetachedState(
app: PIXI.Application, destroyed: () => boolean, state: GridState, capture: DetachedCaptureOptions = {},
): Promise<HTMLCanvasElement | null> {
  const { maxPx = 640, frame } = capture;
  const icons = new Set<string>();
  const tiles = new Set<string>();

  let banded = false;
  for (const obj of state.objects.values()) {
    const item = getCatalogItem(obj.catalogId);
    if (item?.roadMaterial) banded = true;

    const url = objectSpriteUrl(obj, item);
    if (url) icons.add(url);
    // A road carries a colour, so it has no sprite url — its art reaches the map as the fill of
    // its surface instead, one tile per material.
    const tile = isCoatingItem(item) ? item!.icon : undefined;
    const tileUrl = tile ? iconUrl(tile) : undefined;
    if (tileUrl) tiles.add(tileUrl);
  }
  await Promise.all([
    surfaceImagesReady(Array.from(state.objects.values(), obj => getCatalogItem(obj.catalogId))), decodeIcons(icons),
    ...[...tiles].map((url) => roadTileReady(url)), ...(banded ? [roadMaterialSettled()] : []),
  ]);
  if (destroyed()) return null;

  // A capture renders explicitly (generateTexture, below): no draw call here owes anyone a
  // render window.
  const quiet = (): void => {};
  const base = new BaseLayer(quiet);
  const terrain = new TerrainLayer(quiet);
  const objects = new ObjectLayer({ state: () => state, requestRender: quiet });
  const world = new PIXI.Container();
  world.addChild(base.container, terrain.container, objects.container);
  try {
    base.drawFull(state);
    terrain.drawFull(state);
    objects.sync(state.objects);
    // sync only queues the road surfaces for the next frame, and this capture has none: the world
    // is rasterized below and destroyed on the way out. Draw them now, as every other capture does.
    objects.flushRoadRegions();
    // Opt-in plan notes, drawn by the real annotation layer. A fresh layer fades notes in over a
    // few frames and this capture has exactly one, so every part is settled to opaque by hand.
    let notes: AnnotationLayer | null = null;
    if (capture.annotations && state.annotations?.items.length) {
      notes = new AnnotationLayer(quiet);
      world.addChild(notes.container);
      notes.draw(state.annotations, {
        draft: null, selectionIds: [], inkScale: annotationInkScale(state.template),
        tagLabel: noteTagLabel(state),
      });
      for (const pass of notes.container.children) {
        if (pass instanceof PIXI.Container) for (const part of pass.children) part.alpha = 1;
      }
    }

    // Thumbnail framing excludes the surrounding reference-grid sea and retains terrain bleed.
    const box = cellsCaptureFrame(frame ?? { x: 0, y: 0, width: state.template.width, height: state.template.height });
    const region = new PIXI.Rectangle(box.x * TILE_SIZE, box.y * TILE_SIZE, box.width * TILE_SIZE, box.height * TILE_SIZE);
    if (region.width <= 0 || region.height <= 0) return null;
    const resolution = Math.min(1, maxPx / Math.max(region.width, region.height));
    notes?.setCellPixels(resolution * TILE_SIZE, true);
    const rt = app.renderer.generateTexture(world, {
      resolution, region, multisample: PIXI.MSAA_QUALITY.NONE,
    });
    try { return app.renderer.extract.canvas(rt) as HTMLCanvasElement; }
    finally { rt.destroy(true); }
  } catch {
    return null;
  } finally {
    // The icon textures are shared with the live scene and with the next capture, so only the
    // nodes go.
    world.destroy({ children: true, texture: false, baseTexture: false });
  }
}
