import type * as PIXI from 'pixi.js-legacy';
import type { MapRenderer } from '../../view/map2d/scene/map-renderer';
import type { BaseLayer } from '../../view/map2d/layers/base-layer';
import type { ObjectLayer } from '../../view/map2d/layers/object-layer';
import type { AnnotationLayer } from '../../view/map2d/layers/annotation-layer';
import type { OverlayLayer } from '../../view/map2d/layers/overlay-layer';
import type { GridLayer } from '../../view/map2d/layers/grid-layer';

/** A 2D renderer's own layers, which callers reach only through `asEditorView` and its verbs; the
 *  suites that pin what a layer holds read them here. */
export interface RendererLayers {
  worldContainer: PIXI.Container;
  baseLayer: BaseLayer;
  objectLayer: ObjectLayer;
  annotationLayer: AnnotationLayer;
  overlayLayer: OverlayLayer;
  gridLayer: GridLayer;
}

export const rendererLayers = (renderer: MapRenderer): RendererLayers => renderer as unknown as RendererLayers;
