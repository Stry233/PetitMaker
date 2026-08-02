/*
 * scale.tsx — responsive sizing for the phone card. Instead of a hard-coded
 * scale, the card is sized as a ratio of the viewport (preserving the design
 * aspect ratio) and recomputed on resize. All menu components read the current
 * scale via context and convert design px → screen px with px()/pxf().
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { pageZoom } from '../../core/runtime/page-zoom';
import { readMatch } from '../../core/runtime/portrait-signals';
import { CANVAS, CONTENT_BOTTOM_Y, HOME_POS, CARD } from './metrics';
import { useAnimatedUiZoom, useUiZooming } from './ui-zoom-anim';

/** Phone card's vertical centre in design px — the anchor the UI zoom scales around. */
const ANCHOR_Y = HOME_POS.y + CARD.h / 2;

/**
 * Map the design canvas onto the viewport by matching canvas height to viewport
 * height. Then any design coordinate × scale lands at its exact canvas fraction:
 * the home card becomes 1074/1918 ≈ 56% of viewport height, the collapsed
 * toggle sits at (108,41)·scale in the top-left, etc. Uniform → no distortion.
 *
 * The mapped height is CAPPED: beyond DESIGN_VH_CAP the UI stops growing with
 * the viewport. Pure vh-proportional scaling keeps the phone card at ~56% of
 * screen height on ANY monitor, which reads comically large on a 4K/100%-scaled
 * desktop (the same card is physically ~2x its laptop size). Up to ~1440p-css
 * the linear mapping matches the design intent; past it the extra room goes to
 * the map, not to bigger chrome. Per-device taste stays on uiZoom (Ctrl +/-),
 * which is persisted.
 */
export const DESIGN_VH_CAP = 1440;

/** Live device-pixel-ratio (1 where unavailable). Browser page zoom moves this. */
function currentDpr(): number {
  return (typeof window === 'undefined' ? 1 : window.devicePixelRatio) || 1;
}

/**
 * The viewport height the scale is derived from, with the cap applied.
 *
 * Page zoom multiplies devicePixelRatio and divides the CSS viewport by the same factor, so
 * `vh × dpr` — the viewport in real device pixels — does not move when the user zooms, and the
 * UNCAPPED mapping therefore already draws the UI at one physical size at every zoom level. The cap
 * is the one term that breaks it: a threshold in CSS px, which zoom changes underneath. Zooming out
 * inflates vh past the cap, the scale stops growing, and the UI gets physically smaller the further
 * out you zoom — backwards.
 *
 * So the cap is compared against the UNZOOMED height (`vh × zoom`, which is what vh would be at the
 * page's reference zoom) and then converted back. Both edges of the expression carry the same
 * factor, which is what leaves the on-screen size unmoved.
 */
export function cappedVh(vh: number, dpr: number = currentDpr()): number {
  const zoom = pageZoom(dpr);
  return Math.min(vh, DESIGN_VH_CAP / zoom);
}

/**
 * How much bigger the UI is drawn on a touch-primary device, at most. A CSS px is a smaller
 * physical thing on a phone than on a desktop (~150 css ppi against ~96), so mapping the canvas to
 * viewport height — right on a monitor — lands the phone card at barely an inch and a half tall.
 * The boost buys that back without abandoning the proportional mapping.
 *
 * The ceiling is the room the LAYOUT has, not a taste: the plain mapping fits the whole design
 * canvas in the viewport, so the boost may spend only the part of that canvas the UI leaves empty
 * below itself. Past it the Generate spoke hangs off the bottom of the screen, which is worse than
 * a small card on any device.
 */
/** Design px of air kept under the lowest panel, so a locale whose text wraps a line further than
 *  the measured one does not put its edge on the screen edge. */
const BOOST_BOTTOM_MARGIN = 24;
export const TOUCH_BOOST_MAX = CANVAS.h / (CONTENT_BOTTOM_Y + BOOST_BOTTOM_MARGIN);
/** Full strength at or below a phone's landscape height; nothing at or above a small laptop's. */
const BOOST_VH_FULL = 380;
const BOOST_VH_NONE = 700;

/**
 * The touch boost for a viewport, ramped so a big tablet is untouched and a phone gets all of it.
 *
 * Gated on the pointer being COARSE, never on size alone: a small desktop window is a normal thing
 * and must keep desktop proportions. That is the same signal the portrait guard reads, and for the
 * same reason — it describes the device, not the window.
 */
export function touchBoost(vh: number, coarsePointer: boolean): number {
  if (!coarsePointer) return 1;
  const t = Math.min(1, Math.max(0, (BOOST_VH_NONE - vh) / (BOOST_VH_NONE - BOOST_VH_FULL)));
  return 1 + (TOUCH_BOOST_MAX - 1) * t;
}

export function computeScale(
  vh: number,
  dpr: number = currentDpr(),
  coarsePointer: boolean = readMatch('(pointer: coarse)'),
): number {
  return (cappedVh(vh, dpr) / CANVAS.h) * touchBoost(vh, coarsePointer);
}

/** Reactive scale derived from the viewport, times the user's UI zoom (Ctrl
 *  +/-, or the Settings slider) — the ANIMATED value, so both paths ease. */
export function useMenuScale(): number {
  const [scale, setScale] = useState(() =>
    typeof window === 'undefined' ? 0.56 : computeScale(window.innerHeight),
  );
  useEffect(() => {
    const onResize = () => setScale(computeScale(window.innerHeight));
    window.addEventListener('resize', onResize);
    // The touch boost keys off the pointer, which can change under a tablet as a mouse is attached
    // or removed; a resize does not necessarily follow.
    const pointerMq = window.matchMedia?.('(pointer: coarse)');
    pointerMq?.addEventListener('change', onResize);
    onResize();
    return () => {
      window.removeEventListener('resize', onResize);
      pointerMq?.removeEventListener('change', onResize);
    };
  }, []);
  const uiZoom = useAnimatedUiZoom();
  return scale * uiZoom;
}

/**
 * Vertical offset that makes the UI zoom (Ctrl +/-) scale the menu around the
 * phone's MIDDLE instead of the top-left. Positions are `px(y) = y·scale`, so a
 * large uiZoom pushes tall panels off the bottom. Added to a panel's `top`, this
 * keeps the phone's vertical centre pinned at its uiZoom-1 position, so panels
 * grow symmetrically up+down. Zero at uiZoom = 1 (default layout unchanged).
 */
export function useMenuCenterOffset(): number {
  const uiZoom = useAnimatedUiZoom();
  const [vh, setVh] = useState(() => (typeof window === 'undefined' ? 1080 : window.innerHeight));
  useEffect(() => {
    const onResize = () => setVh(window.innerHeight);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // The anchor (phone centre) sits at ANCHOR_Y·base in screen px; keep it there
  // regardless of uiZoom: shift by anchorScreen·(1 − uiZoom). Reads the SAME base scale the layout
  // uses, so the cap and the touch boost cannot drift out of the anchor.
  return ANCHOR_Y * computeScale(vh) * (1 - uiZoom);
}

/**
 * Chrome scale: the EXACT menu factor (capped viewport height × uiZoom),
 * renormalized so 1 = a 1080px-tall css viewport, where the chrome's fixed-px
 * designs (modals, corner controls) read right. One scaling logic for the whole
 * UI: chrome tracks the menu 1:1 across monitors and Ctrl +/- — no second curve,
 * no separate clamps (uiZoom is already clamped in the store, the vh cap bounds
 * the top, and a small window shrinks chrome exactly as it shrinks the menu).
 * Applied as css `zoom` (crisp layout scaling; browsers without `zoom` render
 * at 1 — a graceful no-op).
 */
const CHROME_BASE_VH = 1080;
export function chromeScaleOf(menuScale: number): number {
  return (menuScale * CANVAS.h) / CHROME_BASE_VH;
}

export function useChromeScale(): number {
  return chromeScaleOf(useMenuScale());
}

const ScaleContext = createContext<number>(0.56);

export const ScaleProvider = ScaleContext.Provider;

export function useScale(): number {
  return useContext(ScaleContext);
}

/** Effective-resolution-aware font weight: the bundled Heavy faces (800/900)
 *  fuse dense CJK strokes when glyphs rasterize small (1080p at DPR 1: design
 *  40px → ~22 physical px). Below the threshold, heavy weights drop to 600
 *  (user-validated); lighter weights and high-res displays are untouched.
 *  Threshold: 1080p → 0.563×1 = 0.56 < 0.7 → cap; 1440p → 0.75 ≥ 0.7 → keep
 *  (user reports 2K fine); 1080p at DPR ≥ 1.25 → ≥ 0.70 → keep. */
export function effectiveWeight(w: number, scale: number, dpr: number): number {
  return w >= 800 && scale * Math.min(dpr, 2) < 0.7 ? 600 : w;
}

/** px helpers bound to the current scale. */
export function usePx() {
  const scale = useScale();
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // While the UI zoom animates, px() snaps to integers at rounding boundaries
  // that each element crosses at a different scale, so the layout JITTERS.
  // Drop the rounding mid-zoom (subpixel = smooth); restore it when the zoom
  // settles (crisp static layout). One flip per zoom, not per frame.
  const zooming = useUiZooming();
  // Rounding to whole DEVICE pixels, not CSS ones. Snapping is what keeps edges crisp, but the CSS
  // pixel is not the grid the screen actually has: at a fractional dpr — which is every page-zoom
  // step — rounding to it lands elements on a grid that browser zoom moves underneath, so the whole
  // layout shifts by up to a pixel each time the zoom changes. The device grid does not move.
  const px = zooming
    ? (n: number) => n * scale
    : (n: number) => Math.round(n * scale * dpr) / dpr;
  return {
    scale,
    px,
    pxf: (n: number) => +(n * scale).toFixed(2),
    /** Scale-aware font weight: caps 800/900 to 600 at low effective resolution. */
    fw: (w: number) => effectiveWeight(w, scale, dpr),
  };
}

/**
 * Native content down-scaling for a spoke authored larger than the others in the
 * design source (Generate: ~1.4x). Its CONTENT (card + controls) renders at
 * `contentScale` the outer scale. Rather than a CSS `transform: scale()` on the
 * wrapper (which rasterizes the composited content at layout resolution then
 * GPU-downscales it — blurry at DPR 1), we render the content NATIVELY at
 * `inner = scale × contentScale` and translate the wrapper.
 *
 * Geometry equivalence (must be pixel-identical within rounding):
 *   A transform:scale(contentScale) with transformOrigin=origin maps a child at
 *   design coord p to screen
 *     scale·(origin + (p − origin)·contentScale)  where origin = (CARD.x, TIP_Y).
 *   Native renders it at  wrapperOffset + p·scale·contentScale .
 *   Setting wrapperOffset = origin·scale·(1 − contentScale)
 *   makes the two equal (the constant origin·(1−contentScale) translation is what
 *   the transformOrigin bakes in). So the wrapper is a NON-scaling div offset by
 *   left = px(origin.x·(1−contentScale)), top = px(origin.y·(1−contentScale)) and
 *   its children render under <ScaleProvider value={inner}> with design-absolute
 *   coordinates.
 *
 * Returns inner px helpers (ipx/ipxf), a content-scaled font-weight cap (ifw,
 * keyed off the inner effective resolution), and the wrapper's innerOffset.
 */
export function useContentScale(contentScale: number, origin: { x: number; y: number }) {
  const zooming = useUiZooming();
  const scale = useScale();
  const { px } = usePx();
  const inner = scale * contentScale;
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  // Device-pixel snapping, same as `usePx` — see the note there.
  const ipx = zooming
    ? (n: number) => n * inner
    : (n: number) => Math.round(n * inner * dpr) / dpr;
  const ipxf = (n: number) => +(n * inner).toFixed(2);
  const ifw = (w: number) => effectiveWeight(w, inner, dpr);
  const innerOffset = { left: px(origin.x * (1 - contentScale)), top: px(origin.y * (1 - contentScale)) };
  return { inner, ipx, ipxf, ifw, innerOffset };
}
