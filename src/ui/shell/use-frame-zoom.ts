/*
 * use-frame-zoom.ts — the frame's live zoom, and what a moving element has to do about it.
 *
 * The whole frame stands under one `zoom` (`units.ts:ZOOM` times the window's fit times the user's
 * Ctrl +/-), which is what lets the chrome be authored in fixed css px. Everything inside it is
 * therefore laid out in a unit that is not the page's, and anything measuring the frame from outside
 * has to divide.
 */
import { useAnimatedUiZoom } from '../design/ui-zoom-anim';
import { useDenseScript, useDevicePixelRatio, useViewportFit } from '../design/scale';
import { readableWeight, textDevicePx } from '../design/text-weight';
import { ZOOM } from './units';

/** The factor every length inside the frame is drawn at: the frame's own page zoom, times the
 *  window's fit below the design reference, times the user's UI zoom — live through that tween
 *  rather than snapping when it starts. The chrome rides the same fit (`useChromeScale`), so the
 *  two carry one ratio at every window shape. */
export function useFrameZoom(): number {
  return ZOOM * useViewportFit() * useAnimatedUiZoom();
}

/**
 * `(nominalWeight, cssPx) => weight` for text INSIDE the frame — the `TEXT` ladder is authored in css
 * px and the frame's zoom is what carries it to the glass, so a size here lands `ZOOM` larger than
 * the same number in a modal and keeps a weight the modal drops. The chrome's own is
 * `design/scale:useReadableWeight`; a frame surface must not take that one.
 *
 * Only for a site whose size is its own. Anything on `text-weight:TEXT_ROLES` inherits its answer
 * from the custom properties the frame root already publishes.
 */
export function useFrameReadableWeight(): (nominal: number, cssPx: number) => number {
  const zoom = useFrameZoom();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  return (nominal, cssPx) => readableWeight(nominal, textDevicePx(cssPx, zoom, dpr), dense);
}

/**
 * The `transformTemplate` a Framer LAYOUT animation needs to run correctly inside the frame.
 *
 * Framer measures a layout animation with `getBoundingClientRect`, which reports PAGE pixels, and
 * then applies the difference as a `transform`, which is read in the element's OWN pixels. Under the
 * frame's zoom those are not the same unit, so the travel is handed a translate `zoom` times too
 * long: measured in the browser, the mode plate crossing four blocks began its flight 100 px past
 * the block it was leaving, half off the window. Landing was exact either way, because the
 * difference is animated to zero.
 *
 * Wrapping the generated transform in the zoom and its inverse divides the translate by the zoom and
 * leaves any scale untouched: uniform scales commute, so S(1/z) . T(d) . S(z) is a pure translate of
 * d/z. `transformOrigin`, which Framer writes as a percentage, is unaffected. It holds at every
 * level of a nested projection too, since the correction is the same constant factor everywhere and
 * Framer's own scale corrections are ratios, which the zoom does not touch.
 */
export function useZoomedLayoutTransform(): (values: object, generated: string) => string {
  const zoom = useFrameZoom();
  return (_values, generated) => (
    generated === 'none' || generated === '' ? generated : `scale(${1 / zoom}) ${generated} scale(${zoom})`
  );
}
