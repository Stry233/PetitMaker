/*
 * The corner of a box being layout-animated inside a zoomed frame. A layout animation scales an
 * element, so Framer rewrites a px `borderRadius` as a percentage of the projected box each frame,
 * measured in page px with `getBoundingClientRect`; the browser resolves it against the element's own
 * box under the frame's CSS `zoom` (`units.ts:ZOOM` times the user's), so the corner comes out
 * `1 / zoom` short during a resize.
 *
 * Framer skips the correction whenever the projected transform is identity, a decision nothing
 * outside it can observe, so swapping values on animation start and complete jumps at the end. The
 * conversion is replaced instead: one authored number is the same physical corner before, during and
 * after. An element declares its drawing unit with `frameZoomAttr`; one that declares nothing gets
 * Framer's own arithmetic, the factor being 1.
 */
import { addScaleCorrector } from 'framer-motion';

/** The attribute an element carries to say what its own px are worth in page px. */
const ZOOM_ATTR = 'data-frame-zoom';

/** Put on a motion element that both LAYOUT-animates and carries a px corner, inside the frame's
 *  zoom. The value is live: a Ctrl +/- tween changes it per frame and the corner follows. */
export const frameZoomAttr = (zoom: number) => ({ [ZOOM_ATTR]: zoom });

/** Framer's own projection node, in the two members this needs. Typed here rather than imported:
 *  the type lives in `motion-dom`, which is Framer's dependency and not this project's. */
interface Projected {
  target?: { x: { min: number; max: number }; y: { min: number; max: number } };
  instance?: unknown;
}

const PX = /^-?[\d.]+px$/;

function drawnZoom(node: Projected): number {
  const el = node.instance;
  const declared = el instanceof HTMLElement ? Number(el.getAttribute(ZOOM_ATTR)) : NaN;
  return Number.isFinite(declared) && declared > 0 ? declared : 1;
}

/** Framer's `pixelsToPercent`, with the radius first put into the unit the box was measured in. */
const correctRadius = (latest: string | number, node: Projected): string | number => {
  if (!node.target) return latest;
  // A percentage is already relative to the box, so it stretches correctly on its own; any other
  // string is a unit this cannot reason about and is left exactly as it was authored.
  if (typeof latest === 'string') {
    if (!PX.test(latest)) return latest;
    latest = parseFloat(latest);
  }
  const page = latest * drawnZoom(node);
  const share = (axis: { min: number; max: number }) => (
    axis.max === axis.min ? 0 : (page / (axis.max - axis.min)) * 100
  );
  return `${share(node.target.x)}% ${share(node.target.y)}%`;
};

const CORNERS = [
  'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius',
];

addScaleCorrector({
  // The shorthand is what a style prop usually carries; the four longhands are corrected on their
  // own as well, since Framer treats each as its own value and one left behind would be the one
  // corner drawn in the other unit.
  borderRadius: { correct: correctRadius, applyTo: CORNERS },
  ...Object.fromEntries(CORNERS.map((key) => [key, { correct: correctRadius }])),
});
