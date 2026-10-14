/* The frame's live zoom: the whole frame stands under one `zoom`, so a measurement from outside divides by it. */
import { useAnimatedUiZoom } from '../design/ui-zoom-anim';
import { useDenseScript, useDevicePixelRatio, useViewportFit } from '../design/scale';
import { readableWeight } from '../design/text-weight';
import { ZOOM } from './units';

/**
 * The factor every frame length is drawn at: page zoom, the window's fit and the live UI zoom (the chrome
 * rides the same fit).
 */
export function useFrameZoom(): number {
  return ZOOM * useViewportFit() * useAnimatedUiZoom();
}

/**
 * Weights for frame text whose size is its own (`TEXT_ROLES` inherit the frame root's custom properties);
 * the chrome's `useReadableWeight` would read the wrong zoom here.
 */
export function useFrameReadableWeight(): (nominal: number, cssPx: number) => number {
  const zoom = useFrameZoom();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  return (nominal, cssPx) => readableWeight(nominal, cssPx * zoom, dense, dpr);
}

/**
 * The `transformTemplate` a Framer layout animation needs under the frame's zoom: Framer measures page px
 * and applies them as own px, so wrapping the transform in the zoom and its inverse divides the translate
 * by the zoom and leaves scale alone, at every level of a nested projection.
 */
export function useZoomedLayoutTransform(): (values: object, generated: string) => string {
  const zoom = useFrameZoom();
  return (_values, generated) => (
    generated === 'none' || generated === '' ? generated : `scale(${1 / zoom}) ${generated} scale(${zoom})`
  );
}
