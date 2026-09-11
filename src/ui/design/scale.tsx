/**
 * Fixed providers convert design coordinates to CSS pixels. `fittedUiScale` supplies the shared live
 * CSS zoom for chrome and frame; the frame adds its constant authored ratio. The minimum workspace
 * applies to the rendered size without rewriting the user's preferred scale.
 */
import { createContext, useContext, useEffect, useState, type CSSProperties } from 'react';
import { useEditorStore } from '../../state/store';
import { useUiPreviewPose } from '../primitives/ui-preview';
import { useAnimatedUiZoom, useUiZooming } from './ui-zoom-anim';
import { isDenseScript, readableWeight, weightVars } from './text-weight';

/** The design canvas, in design pixels: the surface every coordinate here is measured against. */
export const CANVAS = { w: 3754, h: 1918 } as const;

/**
 * The window the fixed layout was judged in, and below which the whole interface scales DOWN
 * proportionally to the tighter axis. `FIT_FLOOR` keeps a control tappable where that factor would
 * take it under a fingertip — which is also what a touch device gets in place of a size boost, since
 * a boost the chrome takes and the frame does not is the drift above in another form. One trade the
 * floor makes plainly: a 768×1024 portrait tablet lands at the floor's 0.60 — a real shrink, but one
 * standing behind a dismissible `PortraitGuard`, which is what makes it a trade rather than a fault.
 *
 * Browser page zoom needs no term of its own: it divides the css viewport and multiplies
 * `devicePixelRatio` by the same factor. At or above the reference `frameFit` is pinned at 1, so zoom
 * passes straight through and magnifies the chrome exactly as it already magnifies the frame; below
 * the reference `frameFit` falls by the same factor zoom rose by, so the two cancel and the chrome's
 * physical size holds still under further zooming, at whatever size a genuinely smaller window would
 * already show.
 */
export const FIT_REF = { w: 1280, h: 800 } as const;
export const FIT_FLOOR = 0.6;

/**
 * 1 at or above `FIT_REF`, the tighter axis's share below it, never under `FIT_FLOOR`.
 *
 * `refWiden` WIDENS THE REFERENCE WINDOW, which is how a surface that takes a strip of the viewport
 * for itself is paid for: the interface then fits into what is LEFT of the window at one factor,
 * itself included. It is the strip's width at fit 1, and the solved form of the circular
 * definition — the strip is drawn at the fit, so the room left for the reference window is
 * `vw - strip x fit`, which is `fit = vw / (FIT_REF.w + refWiden)` — so the answer needs no
 * iteration and the strip and the interface cannot end up at two different sizes. Today the one
 * caller is the assistant's DOCKED panel (`shell/panel-frame.ts:PINNED_DOCK_REF_W`), handed in
 * rather than named here: the dock's width is the frame's own arithmetic, and this file is below it.
 */
export function frameFit(vw: number, vh: number, refWiden = 0): number {
  return Math.max(FIT_FLOOR, Math.min(1, vw / (FIT_REF.w + refWiden), vh / FIT_REF.h));
}

/** Minimum workspace in chrome pixels, after the shell folds its controls and scrolls its rows. */
export const MIN_UI_ROOM = { w: 700, h: 525 } as const;

/** Fit the requested size without changing the saved preference, including the dock's own width. */
export function fittedUiScale(vw: number, vh: number, uiZoom: number, refWiden = 0): number {
  return Math.min(
    frameFit(vw, vh, refWiden * uiZoom) * uiZoom,
    vw / (MIN_UI_ROOM.w + refWiden),
    vh / MIN_UI_ROOM.h,
  );
}

/**
 * How much the reference window is widened by right now, in reference px: the strip some surface
 * has taken out of the viewport, or 0 while none has.
 *
 * A CONTEXT rather than a constant, because the number belongs to a layer ABOVE this one and this
 * one is the floor every scaling answer comes from. The provider stands over the whole app (`App`),
 * so the frame and the chrome read one answer — a fit either of them derived on its own is the
 * drift this file exists to prevent.
 */
const DockRefContext = createContext(0);

export const DockRefProvider = DockRefContext.Provider;

export function useDockRef(): number {
  return useContext(DockRefContext);
}

/** The live window, re-read on resize. Two numbers rather than one object: a drag-resize fires this
 *  many times a second, and an object would be a new identity (and a re-render) on every one of them
 *  even where neither axis moved. Exported for the one question that must NOT go through the fit:
 *  whether there is room to dock, which is what decides the widening the fit reads. */
export function useViewportSize(): { w: number; h: number } {
  const posed = useUiPreviewPose()?.viewport;
  const [w, setW] = useState(() => (typeof window === 'undefined' ? FIT_REF.w : window.innerWidth));
  const [h, setH] = useState(() => (typeof window === 'undefined' ? FIT_REF.h : window.innerHeight));
  useEffect(() => {
    const onResize = () => { setW(window.innerWidth); setH(window.innerHeight); };
    window.addEventListener('resize', onResize);
    onResize();
    return () => window.removeEventListener('resize', onResize);
  }, []);
  // A pictured shell lays itself out for the window its figure poses, so every fit and plan
  // downstream of this reading agrees with the box the picture is drawn in.
  return posed ?? { w, h };
}

/** The shared live fit, normalized so callers can multiply by the animated UI preference. */
export function useViewportFit(): number {
  const { w, h } = useViewportSize();
  const widen = useDockRef();
  const zoom = useAnimatedUiZoom();
  return fittedUiScale(w, h, zoom, widen) / zoom;
}

/**
 * Chrome scale: the window's fit times the user's UI zoom — the frame's own factor without the
 * frame's page zoom, so 1 means "the size the modals and corner controls were designed at" and the
 * chrome:frame ratio is a constant. Applied as css `zoom` (crisp layout scaling; browsers without
 * `zoom` render at 1, a graceful no-op).
 */
export function useChromeScale(): number {
  return useViewportFit() * useAnimatedUiZoom();
}

/** The display's own pixel multiplier, re-read on the media change that moves it (browser page zoom
 *  moves `devicePixelRatio`, and a window dragged between screens changes it outright). Without
 *  `matchMedia` there is no such event to hang off, so the first reading stands. */
export function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1));
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    let cancel = () => {};
    const watch = () => {
      const ratio = window.devicePixelRatio || 1;
      setDpr(ratio);
      // The query matches only at exactly this ratio, so it CHANGES the moment the ratio does —
      // which is the one event the platform gives for a dpr move. Re-armed at the new ratio each
      // time, since a single query can only ever report leaving the value it was built for.
      const mq = window.matchMedia(`(resolution: ${ratio}dppx)`);
      const onChange = () => { cancel(); watch(); };
      mq.addEventListener('change', onChange);
      cancel = () => mq.removeEventListener('change', onChange);
    };
    watch();
    return () => cancel();
  }, []);
  return dpr;
}

/** Whether the live locale is written in a script that fills its em (the dense weight floors). */
export function useDenseScript(): boolean {
  return isDenseScript(useEditorStore((s) => s.locale));
}

/**
 * `(nominalWeight, cssPx) => weight` for a surface standing under the CHROME zoom — a modal, a
 * window, a floating popover. Reach for it where a site's size is its own rather than a role's;
 * anything on the role table inherits its answer from `useWeightVars` instead.
 */
export function useReadableWeight(denseOverride?: boolean): (nominal: number, cssPx: number) => number {
  const zoom = useChromeScale();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  return (nominal, cssPx) => readableWeight(nominal, cssPx * zoom, denseOverride ?? dense, dpr);
}

/** Every role's weight resolved for the CHROME zoom, as the custom properties a surface publishes.
 *  Spread onto the element carrying the surface's own `zoom`. */
export function useWeightVars(): CSSProperties {
  return weightVars(useChromeScale(), useDevicePixelRatio(), useDenseScript());
}

const ScaleContext = createContext<number>(0.56);

export const ScaleProvider = ScaleContext.Provider;

export function useScale(): number {
  return useContext(ScaleContext);
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
  };
}
