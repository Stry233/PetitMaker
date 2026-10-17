/*
 * The one picture-stage interaction: drag to pan (pointer-captured for the whole drag), pinch or
 * wheel to zoom, a press that does not travel counts as a tap, double-click or double-tap to reset,
 * with a transient reset hint that appears once the view has actually moved and fades after a quiet
 * spell. Every in-app picture that pans shares this, so the same picture answers the same hands the
 * same way on each.
 */
import { cssMotion } from '../design/motion';
import { clientPoint } from '../../platform/device/viewport-space';
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { clamp } from '../../core/base/math';
import { useCursorCss } from '../design/cursors/cursor-vars';

/** How long a quiet spell (no pan/zoom) must last before the reset hint fades back out. */
const HINT_QUIET_MS = 2500;

/** One notch of a mouse wheel. */
const ZOOM_STEP = 1.12;
/** Zoom per px of a ctrl-wheel delta (a trackpad pinch), which arrives as many small events. */
const PINCH_WHEEL_RATE = 0.01;
const SCALE_MIN = 0.5;
const SCALE_MAX = 6;
/** Travel under which a press counts as a tap rather than a pan, in client px. */
const TAP_SLOP = 4;
/** Two touch taps this close in time and place are a double-tap, in ms and client px. */
const DOUBLE_TAP_MS = 320;
const DOUBLE_TAP_SLOP = 24;

export interface PanZoomView { tx: number; ty: number; scale: number }

export interface PanZoom {
  view: PanZoomView;
  /** True mid-drag; the picture's transform transition turns off so it tracks the hand exactly. */
  dragging: () => boolean;
  /** Spread onto the stage element. The cursor is the map views' own pan hand, and it lives on the
   *  stage because the pointer is captured there for the whole drag: an image-only cursor reverts
   *  to the arrow the moment the drag starts. */
  stageProps: {
    onWheel: (e: ReactWheelEvent) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: (e: ReactPointerEvent) => void;
    onPointerLeave: (e: ReactPointerEvent) => void;
    onDoubleClick: () => void;
    style: CSSProperties;
  };
  /** The moved picture's transform, with its settle transition off while the hand holds it. */
  viewStyle: CSSProperties;
  showResetHint: boolean;
  reset: () => void;
}

export interface PanZoomOptions {
  /** A press released within the tap slop of where it began; a press that pans is not a tap. */
  onTap?: () => void;
}

interface Point { x: number; y: number }
/** One finger or the mouse: where it went down, and the view then. */
interface Drag { start: Point; at: Point; view: PanZoomView; travelled: boolean }
/** Two fingers: their spread and midpoint when the second went down, and the view then. */
interface Pinch { spread: number; mid: Point; view: PanZoomView }

const REST: PanZoomView = { tx: 0, ty: 0, scale: 1 };

const spreadOf = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const midOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function usePanZoom({ onTap }: PanZoomOptions = {}): PanZoom {
  const [view, setView] = useState<PanZoomView>(REST);
  const viewRef = useRef(view);
  viewRef.current = view;
  const pointers = useRef(new Map<number, Drag>());
  const pinch = useRef<Pinch | null>(null);
  const lastTap = useRef<{ at: Point; time: number } | null>(null);
  const [showResetHint, setShowResetHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panCursor = useCursorCss('move');
  const reduced = useReducedMotionConfig() === true;

  const noteInteraction = () => {
    setShowResetHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowResetHint(false), HINT_QUIET_MS);
  };
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const reset = () => {
    setView(REST);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setShowResetHint(false); // back at rest, nothing left to reset
  };

  /** The two fingers of a pinch, in press order. */
  const pair = (): [Drag, Drag] | null => {
    const [a, b] = [...pointers.current.values()];
    return a && b ? [a, b] : null;
  };

  /** A finger lifted from a pinch leaves the other panning from where it now stands. */
  const rebase = () => {
    pinch.current = null;
    for (const d of pointers.current.values()) { d.start = d.at; d.view = viewRef.current; d.travelled = true; }
  };

  const release = (e: ReactPointerEvent, tapped: boolean) => {
    const d = pointers.current.get(e.pointerId);
    pointers.current.delete(e.pointerId);
    if (!d) return;
    if (pinch.current) { rebase(); return; }
    if (!tapped || d.travelled || pointers.current.size > 0) return;
    onTap?.();
    // A mouse double-click arrives as `dblclick`; touch and pen browsers do not send one reliably.
    if (e.pointerType === 'mouse') return;
    const now = performance.now();
    const prev = lastTap.current;
    if (prev && now - prev.time <= DOUBLE_TAP_MS && spreadOf(prev.at, d.start) <= DOUBLE_TAP_SLOP) {
      lastTap.current = null;
      reset();
      return;
    }
    lastTap.current = { at: d.start, time: now };
  };

  return {
    view,
    dragging: () => pointers.current.size > 0,
    stageProps: {
      onWheel: (e) => {
        const f = e.ctrlKey ? Math.exp(-e.deltaY * PINCH_WHEEL_RATE) : e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
        setView((v) => ({ ...v, scale: clamp(v.scale * f, SCALE_MIN, SCALE_MAX) }));
        noteInteraction();
      },
      onPointerDown: (e) => {
        const at = clientPoint(e);
        pointers.current.set(e.pointerId, { start: at, at, view: viewRef.current, travelled: false });
        (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
        const two = pair();
        if (pointers.current.size === 2 && two) {
          for (const d of two) d.travelled = true;
          pinch.current = { spread: Math.max(1, spreadOf(two[0].at, two[1].at)), mid: midOf(two[0].at, two[1].at), view: viewRef.current };
        }
      },
      onPointerMove: (e) => {
        const d = pointers.current.get(e.pointerId);
        if (!d) return;
        d.at = clientPoint(e);
        if (Math.hypot(d.at.x - d.start.x, d.at.y - d.start.y) > TAP_SLOP) d.travelled = true;
        const p = pinch.current;
        const two = pair();
        if (p && two) {
          const mid = midOf(two[0].at, two[1].at);
          const scale = clamp(p.view.scale * spreadOf(two[0].at, two[1].at) / p.spread, SCALE_MIN, SCALE_MAX);
          setView({ scale, tx: p.view.tx + mid.x - p.mid.x, ty: p.view.ty + mid.y - p.mid.y });
          noteInteraction();
          return;
        }
        if (!d.travelled) return;
        setView((v) => ({ ...v, tx: d.view.tx + d.at.x - d.start.x, ty: d.view.ty + d.at.y - d.start.y }));
        noteInteraction();
      },
      onPointerUp: (e) => release(e, true),
      onPointerCancel: (e) => release(e, false),
      // A captured pointer leaves only once it lifts; without capture, leaving ends the drag.
      onPointerLeave: (e) => { if (!(e.currentTarget as Element).hasPointerCapture?.(e.pointerId)) release(e, false); },
      onDoubleClick: reset,
      style: { cursor: panCursor, touchAction: 'none' },
    },
    viewStyle: {
      transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
      transition: pointers.current.size > 0 ? 'none' : cssMotion('preview.zoom', ['transform'], reduced),
    },
    showResetHint,
    reset,
  };
}
