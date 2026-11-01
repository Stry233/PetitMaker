import { subscribeViewportSize, viewportSizeSnapshot } from '../../platform/device/viewport-space';
/**
 * The interface's scale in React: the view a surface stands in (window, dock strip, input mode,
 * arrangement, UI zoom), handed to the one model in `scale-model.ts`, and the zoom a zoomed surface
 * tells its content it draws at (`DrawnAtProvider`). Nothing here computes a scale of its own.
 */
import { createContext, useContext, useSyncExternalStore, type CSSProperties } from 'react';
import { useUiPreviewPose } from './preview';
import { touchSizing, useLayoutShape, useTouchMode } from './input-mode';
import { onUiZoomSpan, uiZoomLive, uiZoomSpan, useSettledUiZoom } from './ui-zoom-anim';
import { isDenseScript, readableWeight, weightVars } from './text-weight';
import { UI_ZOOM_MIN } from '../../platform/storage/prefs';
import { useLocale } from '../../i18n/context';
import {
  NO_DOCK, reachOf, uiScaleOf,
  type ArrangementRoom, type DockRef, type ScaleView,
} from './scale-model';

export {
  FIT_FLOOR, MIN_UI_ROOM, NO_DOCK, TOUCH_TARGET, besideDock, fittedUiScale, liftOf, reachShareOf, touchReachPx, uiScaleOf,
  type ArrangementRoom, type DockAxis, type DockRef,
} from './scale-model';

/** One step of the UI scale, for the Settings slider and the Ctrl+(+/−) shortcut alike. */
export const UI_SCALE_STEP = 0.05;

/** The UI scale's stops for a scale whose default is `anchor`: the default plus or minus whole steps,
 *  from the lowest at or above `UI_ZOOM_MIN` to the highest at or below `reach`, never short of the
 *  default, so every default sits on its own track. */
export function scaleLattice(anchor: number, reach: number): { lo: number; hi: number; snap: (z: number) => number } {
  const at = (k: number) => +(anchor + k * UI_SCALE_STEP).toFixed(2);
  const lo = at(-Math.floor((anchor - UI_ZOOM_MIN) / UI_SCALE_STEP + 1e-6));
  const hi = Math.max(at(Math.max(0, Math.floor((reach - anchor) / UI_SCALE_STEP + 1e-6))), +(lo + UI_SCALE_STEP).toFixed(2));
  const snap = (z: number) => Math.min(hi, Math.max(lo, at(Math.round((z - anchor) / UI_SCALE_STEP))));
  return { lo, hi, snap };
}

/** The strip a dock has taken (`DockRef`), provided over the whole app (`App`) so the frame and the
 *  chrome read one answer. */
const DockRefContext = createContext<DockRef>(NO_DOCK);

export const DockRefProvider = DockRefContext.Provider;

export function useDockRef(): DockRef {
  return useContext(DockRefContext);
}

/** The frame's arrangement room (`shell/panel-frame.ts:ARRANGEMENT_ROOM`), provided by the app root; a
 *  subtree mounted without the frame (its own React root, a test) has none and sizes by the fit alone. */
const ArrangementRoomContext = createContext<ArrangementRoom | null>(null);

export const ArrangementRoomProvider = ArrangementRoomContext.Provider;

const SERVER_SIZE = { width: 1280, height: 800 };
const serverSize = () => SERVER_SIZE;

/** The live window, from the one shared reading (`platform/device/viewport-space.ts:subscribeViewportSize`),
 *  so a resize re-renders every reader in one commit. Exported for the one question that must not go
 *  through the fit: whether there is room to dock, which is what decides the widening the fit reads. */
export function useViewportSize(): { w: number; h: number } {
  const posed = useUiPreviewPose()?.viewport;
  const { width, height } = useSyncExternalStore(subscribeViewportSize, viewportSizeSnapshot, serverSize);
  // A pictured shell lays itself out for the window its figure poses, so every fit and plan
  // downstream of this reading agrees with the box the picture is drawn in.
  return posed ?? { w: width, h: height };
}

/** The inputs that move on their own clock: whether the sizes are touch mode's, the UI zoom, and, while
 *  a dock slides or its seam is held, the strip it takes on this frame. */
export interface ScaleInputs { touch: boolean; uiZoom: number; dock?: DockRef }

/** The dock's strip on this frame, published by the shell's dock driver (`shell/use-dock.ts`): one
 *  page-wide registration, so a writer or a gliding surface here hears the slide the frame hears. */
interface LiveDock {
  /** The strip as it stands on this frame. */
  now(): DockRef;
  /** Whether it is moving: a slide between its ends, or a held seam. */
  moving(): boolean;
  /** Calls `tell` on each frame it moves and when it lands. */
  subscribe(tell: () => void): () => void;
}

let liveDock: LiveDock | null = null;

/** Registers the page's live dock; returns the unregister. */
export function registerLiveDock(source: LiveDock): () => void {
  liveDock = source;
  if (writers.size > 0) { unwatch?.(); unwatch = null; watchWriters(); }
  flushWriters();
  return () => {
    if (liveDock !== source) return;
    liveDock = null;
    if (writers.size > 0) { unwatch?.(); unwatch = null; watchWriters(); }
  };
}

/** The view this render stands in, at the settled inputs or the given ones (`useGlidingScale`). The
 *  arrangement's room applies in touch mode only. */
export function useScaleView(at?: ScaleInputs): ScaleView {
  const { w, h } = useViewportSize();
  const settled: ScaleInputs = { touch: useTouchMode(), uiZoom: useSettledUiZoom() };
  const { touch, uiZoom, dock } = at ?? settled;
  const room = useContext(ArrangementRoomContext);
  const settledDock = useDockRef();
  return { vw: w, vh: h, dock: dock ?? settledDock, touch, uiZoom, upright: useLayoutShape() === 'portrait', room: touch ? room : null };
}

/** The settled view's reach (`scale-model.ts:reachOf`), where the Settings slider and the shortcuts end. */
export function useScaleReach(): number {
  return reachOf(useScaleView());
}

/** The zoom the nearest zoomed surface draws at (the frame, the docked desk, a window, a lifted
 *  card), which it tells its content so a weight, a scroll row or a hit area inside reads the zoom it
 *  actually stands under rather than choosing a scale of its own. */
const SurfaceZoomContext = createContext<number | null>(null);

export const SurfaceZoomProvider = SurfaceZoomContext.Provider;

/** The zoom this render stands under: its surface's, or the chrome scale outside every surface. */
export function useSurfaceZoom(): number {
  const surface = useContext(SurfaceZoomContext);
  const chrome = useChromeScale();
  return surface ?? chrome;
}

/** The scale inputs this frame, for a writer outside a render: the live sizing and UI zoom, which
 *  equal the settled ones at rest. */
export function liveScaleNow(): ScaleInputs {
  const dock = liveDock?.moving() ? liveDock.now() : undefined;
  return { touch: touchSizing.get(), uiZoom: uiZoomLive.get(), ...(dock ? { dock } : {}) };
}

const writers = new Set<() => void>();
let unwatch: (() => void) | null = null;

function flushWriters(): void {
  for (const write of [...writers]) write();
}

function watchWriters(): void {
  const offs = [touchSizing.subscribe(flushWriters), uiZoomLive.on('change', flushWriters), onUiZoomSpan(flushWriters)];
  if (liveDock) offs.push(liveDock.subscribe(flushWriters));
  unwatch = () => { for (const off of offs) off(); };
}

/** Calls `write` once a frame while the UI zoom glides (its follow moves it once a frame) or the dock
 *  moves, when either starts or ends, and when the sizing steps with the mode (synchronously, so a
 *  start or a landing is written before the paint), so a writer holds its styles on the live scale
 *  while React renders only the settled one. */
export function onLiveScale(write: () => void): () => void {
  writers.add(write);
  if (!unwatch) watchWriters();
  return () => {
    writers.delete(write);
    if (writers.size > 0 || !unwatch) return;
    unwatch();
    unwatch = null;
  };
}

let gliding: ScaleInputs = { touch: false, uiZoom: 1 };
/** The live inputs while the UI zoom glides or the dock moves, as one snapshot replaced only when they
 *  moved; null at rest. */
function readGliding(): ScaleInputs | null {
  if (!scaleMovingNow() && !liveDock?.moving()) return null;
  const now = liveScaleNow();
  if (now.touch !== gliding.touch || now.uiZoom !== gliding.uiZoom
    || now.dock?.axis !== gliding.dock?.axis || now.dock?.size !== gliding.dock?.size) gliding = now;
  return gliding;
}
const glidingAtRest = () => null;

const hearNothing = () => () => {};

/**
 * The scale inputs a surface standing on the window renders at so it glides with the frame: the live
 * ones, re-rendering it once a frame while the UI zoom glides or the dock moves. For the open surfaces whose zoom, placement
 * or caps must move with the frame; everything else renders the settled scale. A surface mounted
 * while it shows nothing passes `active` false and reads the settled inputs, as a pictured one does.
 */
export function useGlidingScale(active = true): ScaleInputs {
  const live = useSyncExternalStore(active ? onLiveScale : hearNothing, readGliding, glidingAtRest);
  const settled = { touch: useTouchMode(), uiZoom: useSettledUiZoom() };
  return useUiPreviewPose() || !active || !live ? settled : live;
}

/** The chrome scale (`useChromeScale`) at the gliding inputs (`useGlidingScale`). */
export function useGlidingChromeScale(active = true): number {
  return uiScaleOf(useScaleView(useGlidingScale(active)));
}

const atRest = () => null;

/** The UI zoom's glide, from where its follow last retargeted to its target, re-read only when it
 *  starts, retargets or ends; null at rest. The input mode's sizing never glides: it steps with the
 *  mode, and the chrome's morph carries the re-size (`shell/ChromeMorph.tsx`). */
export function useScaleSpan(): { from: number; to: number } | null {
  return useSyncExternalStore(onUiZoomSpan, uiZoomSpan, atRest);
}

/** How much of the UI zoom's glide is still to run, 1 at its start and 0 where it lands; null at rest.
 *  For a motion that must land with the glide. */
export function glideRemainingNow(): number | null {
  const zoom = uiZoomSpan();
  if (!zoom) return null;
  return zoom.to !== zoom.from ? Math.min(1, Math.abs(zoom.to - uiZoomLive.get()) / Math.abs(zoom.to - zoom.from)) : 0;
}

/** Whether the UI zoom glides right now, for a writer outside a render. */
export function scaleMovingNow(): boolean {
  return uiZoomSpan() !== null;
}
const stillNow = () => false;

/** True only while the UI zoom glides. Elements gate their Framer `layout` animations and px rounding
 *  off during it, so nothing trails or jitters while the scale moves each frame. Flips at most twice
 *  per glide. */
export function useScaleMoving(): boolean {
  return useSyncExternalStore(onUiZoomSpan, scaleMovingNow, stillNow);
}

/**
 * The chrome scale: the one scale (`scale-model.ts:uiScaleOf`) in the settled view, so 1 means "the
 * size the modals and corner controls were designed at", and the frame draws at `units.ts:ZOOM` times
 * it. Applied as css `zoom` (crisp layout scaling; browsers without `zoom` render at 1).
 */
export function useChromeScale(): number {
  return uiScaleOf(useScaleView());
}

/** The exact-ratio query to watch. A `resolution` query that does not match the ratio it was built
 *  for is one the engine did not understand (Safari before 16 has no such media feature), so the
 *  prefixed pair states the same exact value instead. */
function dprQuery(ratio: number): MediaQueryList {
  const exact = window.matchMedia(`(resolution: ${ratio}dppx)`);
  if (exact.matches) return exact;
  return window.matchMedia(`(-webkit-min-device-pixel-ratio: ${ratio}) and (-webkit-max-device-pixel-ratio: ${ratio})`);
}

const readDpr = () => (typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
const serverDpr = () => 1;
const dprListeners = new Set<() => void>();
let unwatchDpr: (() => void) | null = null;

/** One media watch for every reader, armed while any listens. The query matches only at exactly the
 *  ratio it was built for, so it changes the moment the ratio does, which is the one event the
 *  platform gives for a dpr move; it is re-armed at the new ratio each time. */
function subscribeDpr(listener: () => void): () => void {
  dprListeners.add(listener);
  if (!unwatchDpr && typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    let cancel = () => {};
    const watch = () => {
      const mq = dprQuery(readDpr());
      const onChange = () => { cancel(); watch(); for (const tell of [...dprListeners]) tell(); };
      mq.addEventListener('change', onChange);
      cancel = () => mq.removeEventListener('change', onChange);
    };
    watch();
    unwatchDpr = () => cancel();
  }
  return () => {
    dprListeners.delete(listener);
    if (dprListeners.size > 0 || !unwatchDpr) return;
    unwatchDpr();
    unwatchDpr = null;
  };
}

/** The display's own pixel multiplier, re-read on the media change that moves it (browser page zoom
 *  moves `devicePixelRatio`, and a window dragged between screens changes it outright). Without
 *  `matchMedia` nothing announces a move, so a reader takes it on its next render. */
export function useDevicePixelRatio(): number {
  return useSyncExternalStore(subscribeDpr, readDpr, serverDpr);
}

/** Whether the live locale is written in a script that fills its em (the dense weight floors). */
export function useDenseScript(): boolean {
  return isDenseScript(useLocale());
}

/**
 * `(nominalWeight, cssPx) => weight` at the zoom this render stands under (`useSurfaceZoom`). Reach
 * for it where a site's size is its own rather than a role's; anything on the role table inherits its
 * answer from `useWeightVars` instead.
 */
export function useReadableWeight(denseOverride?: boolean): (nominal: number, cssPx: number) => number {
  const zoom = useSurfaceZoom();
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  return (nominal, cssPx) => readableWeight(nominal, cssPx * zoom, denseOverride ?? dense, dpr);
}

/** Every role's weight resolved for the zoom this render stands under times `fit`, the zoom the
 *  surface itself adds, as the custom properties a surface publishes. Spread onto the element carrying
 *  that `zoom`. */
export function useWeightVars(fit = 1): CSSProperties {
  return weightVars(useSurfaceZoom() * fit, useDevicePixelRatio(), useDenseScript());
}

const ScaleContext = createContext<number>(0.56);

export const ScaleProvider = ScaleContext.Provider;

function useScale(): number {
  return useContext(ScaleContext);
}

/** px helpers bound to the current scale. */
export function usePx() {
  const scale = useScale();
  const dpr = useDevicePixelRatio();
  // While the UI zoom animates, px() snaps to integers at rounding boundaries
  // that each element crosses at a different scale, so the layout jitters.
  // Drop the rounding mid-zoom (subpixel = smooth); restore it when the zoom
  // settles (crisp static layout). One flip per zoom, not per frame.
  const zooming = useScaleMoving();
  // Rounding to whole device pixels, not CSS ones. Snapping is what keeps edges crisp, but the CSS
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
