/*
 * zoom-corrected-radius.ts — the corner of a box that is being LAYOUT-ANIMATED inside a zoomed frame.
 *
 * A layout animation does not resize an element, it SCALES one, and a scaled corner is an ellipse.
 * Framer fixes that by rewriting a px `borderRadius` as a PERCENTAGE of the box it is projecting,
 * recomputed every frame, which is what keeps the corner circular the whole way across. It measures
 * that box with `getBoundingClientRect`, in PAGE px; the browser then resolves the percentage
 * against the element's OWN box. The frame is drawn under a CSS `zoom` (`units.ts:ZOOM` times the
 * user's), so those are two different units and the corner comes out `1 / zoom` short — measured on
 * the layer plate, 20 page px where 25 was wanted, for the whole of a resize.
 *
 * WHICH VALUE IS RIGHT DEPENDS ON WHETHER FRAMER IS CORRECTING, AND NOTHING OUTSIDE FRAMER CAN SEE
 * THAT FRAME. The decision is taken inside its own render — the correction is skipped whenever the
 * projected transform comes out identity — so a component that hands over one number while
 * projecting and another at rest is racing a switch it cannot observe. Handing the page-px number
 * over on `onLayoutAnimationStart` and taking it back on completion put a 25% over-round corner on
 * screen for the one or two frames between the projection reaching identity and the callback
 * arriving: a visible jump at the end of the move.
 *
 * So the conversion is replaced rather than the value switched. One authored number then describes
 * the same physical corner before, during and after, and there is no moment to get right. An
 * element declares the unit it is drawn in with `frameZoomAttr`; an element that declares nothing
 * gets Framer's own arithmetic exactly, since the factor is then 1.
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

/** Framer's `pixelsToPercent`, with the radius first put into the unit the box was measured in.
 *  Exported for its test: what has to hold is that an undeclared element gets Framer's own answer
 *  and a declared one gets the same PHYSICAL corner at every projection scale, identity included. */
export const correctRadius = (latest: string | number, node: Projected): string | number => {
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
