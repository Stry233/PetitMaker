/**
 * The interface's one scale, as a pure function of the view it is drawn in: the window, the strip a
 * dock takes, the input mode, the arrangement's room and the UI zoom. Every size the interface draws
 * at derives from it: the chrome draws at the scale, the frame at `shell/units.ts:ZOOM` times it, and a
 * surface lifted for a fingertip at a fixed multiple of it (`liftOf`). The slider's reach, the hit-area
 * spacing and the dock's room are read off the same function, so nothing re-derives a scale beside it.
 */
import { UI_ZOOM_MAX, UI_ZOOM_MIN } from '../../platform/storage/prefs';

/** The window the fixed layout was judged in; below it the whole interface scales down to the tighter
 *  axis. Browser page zoom divides the css viewport and multiplies `devicePixelRatio` by the same
 *  factor, so at or above the reference the fit is pinned at 1 and zoom magnifies everything. */
export const FIT_REF = { w: 1280, h: 800 } as const;

/** The floor on the fit, which keeps a control clickable on a small window. */
export const FIT_FLOOR = 0.6;

/** The touch line: touch mode never draws under this times the UI zoom, the scale PC mode gives a
 *  window at its fit floor (UI-34), even where the workspace minimum would cap it, as on a phone. */
export const TOUCH_LINE = FIT_FLOOR;

/** The touch line at which a surface lifted for a fingertip draws each control `TOUCH_TARGET` across:
 *  the line at touch mode's 125% (`liftOf`). */
export const FINGERTIP_SCALE = 0.75;

/** A fingertip's hit area, in visual px. */
export const TOUCH_TARGET = 44;

/** Minimum workspace in chrome px, after the shell folds its controls and scrolls its rows. */
export const MIN_UI_ROOM = { w: 700, h: 525 } as const;


/** Which way a dock takes its strip: `x` from a side of the window, `y` from its foot. */
export type DockAxis = 'x' | 'y';

/** The strip a dock has taken out of the viewport: on `x` its width in reference px (the fit's
 *  widening), on `y` its height in css px, taken off the window's height. A size of 0 is none. */
export interface DockRef { axis: DockAxis; size: number }

export const NO_DOCK: DockRef = { axis: 'x', size: 0 };

/** The room the frame's arrangements need, in chrome px, which bounds the touch line (from
 *  `shell/frame-plan.ts`, handed down by the frame): the narrowest window the upright arrangement
 *  stands in and the shortest the wide one does. */
export interface ArrangementRoom { uprightLeastW: number; wideLeastH: number }

/** Everything a scale is computed from. `room` is the frame's arrangement room in touch mode, null
 *  where none applies (PC mode, or a subtree mounted without the frame). */
export interface ScaleView {
  vw: number;
  vh: number;
  dock: DockRef;
  touch: boolean;
  upright: boolean;
  uiZoom: number;
  room: ArrangementRoom | null;
}

/** The window the interface fits into beside a dock, and the reference widening a side dock costs. */
export function besideDock(vw: number, vh: number, dock: DockRef): { vw: number; vh: number; widen: number } {
  return dock.axis === 'x' ? { vw, vh, widen: dock.size } : { vw, vh: Math.max(0, vh - dock.size), widen: 0 };
}

/**
 * 1 at or above `FIT_REF`, the tighter axis's share below it, never under `FIT_FLOOR`. `refWiden` widens
 * the reference window, which is how a strip taken from the window is paid for: the interface fits
 * into what is left at one factor, the strip included, `fit = vw / (FIT_REF.w + refWiden)`.
 */
export function frameFit(vw: number, vh: number, refWiden = 0): number {
  return Math.max(FIT_FLOOR, Math.min(1, vw / (FIT_REF.w + refWiden), vh / FIT_REF.h));
}

/** The fit times the UI zoom, within the workspace the window must leave (`MIN_UI_ROOM`). */
export function fittedUiScale(vw: number, vh: number, uiZoom: number, refWiden = 0): number {
  return Math.min(
    frameFit(vw, vh, refWiden * uiZoom) * uiZoom,
    vw / (MIN_UI_ROOM.w + refWiden),
    vh / MIN_UI_ROOM.h,
  );
}

/** The most the touch scale may grow to in this room: the upright arrangement keeps its least width,
 *  the wide one its least height and the workspace's width; the map gives up the rest. */
function arrangementCap(vw: number, vh: number, widen: number, upright: boolean, room: ArrangementRoom): number {
  return upright ? vw / room.uprightLeastW : Math.min(vw / (MIN_UI_ROOM.w + widen), vh / room.wideLeastH);
}

/** The touch line in this view (`TOUCH_LINE` times the UI zoom), bounded by the arrangement's room. */
function touchLineOf(view: ScaleView): number {
  const line = TOUCH_LINE * view.uiZoom;
  if (!view.room) return line;
  const { vw, vh, widen } = besideDock(view.vw, view.vh, view.dock);
  return Math.min(line, arrangementCap(vw, vh, widen, view.upright, view.room));
}

/**
 * The one scale, in chrome terms: the fit times the UI zoom within the workspace minimum. Touch mode
 * keeps it on or over the touch line and bounds the whole by the arrangement's room, so every step of
 * the UI zoom changes every surface alike until the room stops them all together.
 */
export function uiScaleOf(view: ScaleView): number {
  const { vw, vh, widen } = besideDock(view.vw, view.vh, view.dock);
  const fitted = fittedUiScale(vw, vh, view.uiZoom, widen);
  if (!view.touch) return fitted;
  const capped = view.room ? Math.min(fitted, arrangementCap(vw, vh, widen, view.upright, view.room)) : fitted;
  return Math.max(capped, touchLineOf(view));
}

/** The zoom a surface of `control`-px controls draws at: the scale, and in touch mode at least the
 *  touch line lifted until each control is a fingertip across where the line stands at
 *  `FINGERTIP_SCALE`. Where the touch line leads, as on a phone, a lifted surface keeps one proportion
 *  to the frame; where the fit leads, as on a tablet, it draws the size the same UI zoom gives it on a
 *  phone, or the scale where that is larger. `touch` names the mode a surface was opened for, where it
 *  is not the view's. */
export function liftOf(view: ScaleView, control?: number, touch = view.touch): number {
  const scale = uiScaleOf(view);
  return touch && control !== undefined ? Math.max(scale, fingertipLift(control) * touchLineOf(view)) : scale;
}

/** The multiple of the touch line a surface of `control`-px controls is lifted to in touch mode. */
export function fingertipLift(control: number): number {
  return Math.max(1, TOUCH_TARGET / (control * FINGERTIP_SCALE));
}

/** The scale at the UI zoom's 100% in this view, which every surface spaces its controls a fingertip
 *  apart for. */
export function spacedOf(view: ScaleView): number {
  return uiScaleOf({ ...view, uiZoom: 1 });
}

/** The share of a fingertip a hit area takes on screen in this view: all of it at and over 100%, and
 *  under it the share the drawing has shrunk by, so neighbouring hit areas never meet. */
export function reachShareOf(view: ScaleView): number {
  return Math.min(1, uiScaleOf(view) / spacedOf(view));
}

/** The span, in a control's own px drawn at `zoom`, its fingertip hit area takes at `share`
 *  (`reachShareOf`). */
export function touchReachPx(zoom: number, share = 1): number {
  return (TOUCH_TARGET * share) / zoom;
}

/** Whether a side dock `size` reference px wide leaves the interface beside it its fit floor at
 *  `uiZoom`; past it the dock cannot stand. */
export function sideDockFits(vw: number, size: number, uiZoom: number): boolean {
  return vw >= FIT_FLOOR * (FIT_REF.w + size * uiZoom);
}

/** The largest UI zoom in this view that still changes the scale and keeps a side dock standing: past
 *  it the window's caps hold every surface where it stands, or a step would undock the panel, so the
 *  slider and the shortcuts end there. */
export function reachOf(view: ScaleView): number {
  const at = (uiZoom: number) => uiScaleOf({ ...view, uiZoom });
  const most = at(UI_ZOOM_MAX);
  let lo = UI_ZOOM_MIN;
  let hi = UI_ZOOM_MAX;
  if (at(lo) >= most - 1e-9) return lo;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid) < most - 1e-9) lo = mid; else hi = mid;
  }
  const { axis, size } = view.dock;
  if (axis !== 'x' || size <= 0) return hi;
  return Math.max(UI_ZOOM_MIN, Math.min(hi, (view.vw / FIT_FLOOR - FIT_REF.w) / size));
}
