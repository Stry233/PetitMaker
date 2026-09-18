import { clientPoint } from '../../../../core/runtime/viewport-space';
/*
 * use-pan-zoom.ts — the one picture-stage interaction: drag to pan (pointer-captured for the whole
 * drag), wheel to zoom in steps, double-click to reset, with a transient reset hint that appears
 * once the view has actually moved and fades after a quiet spell. The export preview and the
 * stylize studio's canvas are the two stages; they share this so the same picture answers the same
 * hands the same way on both.
 */
import { useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from 'react';
import { clamp } from '../../../../core/model/math';
import { useCursorCss } from '../../../design/cursors/cursor-vars';

/** How long a quiet spell (no pan/zoom) must last before the reset hint fades back out. */
const HINT_QUIET_MS = 2500;

const ZOOM_STEP = 1.12;
const SCALE_MIN = 0.5;
const SCALE_MAX = 6;

export interface PanZoomView { tx: number; ty: number; scale: number }

export interface PanZoom {
  view: PanZoomView;
  /** True mid-drag; the picture's transform transition turns off so it tracks the hand exactly. */
  dragging: () => boolean;
  /** Spread onto the stage element. The cursor is the map views' own pan hand, and it lives on the
   *  STAGE because the pointer is captured there for the whole drag: an image-only cursor reverts
   *  to the arrow the moment the drag starts. */
  stageProps: {
    onWheel: (e: ReactWheelEvent) => void;
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerMove: (e: ReactPointerEvent) => void;
    onPointerUp: () => void;
    onPointerLeave: () => void;
    onDoubleClick: () => void;
    style: CSSProperties;
  };
  /** The moved picture's transform, with its settle transition off while the hand holds it. */
  viewStyle: CSSProperties;
  showResetHint: boolean;
  reset: () => void;
}

export function usePanZoom(): PanZoom {
  const [view, setView] = useState<PanZoomView>({ tx: 0, ty: 0, scale: 1 });
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null);
  const [showResetHint, setShowResetHint] = useState(false);
  const hintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panCursor = useCursorCss('move');

  const noteInteraction = () => {
    setShowResetHint(true);
    if (hintTimer.current) clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setShowResetHint(false), HINT_QUIET_MS);
  };
  useEffect(() => () => { if (hintTimer.current) clearTimeout(hintTimer.current); }, []);

  const reset = () => {
    setView({ tx: 0, ty: 0, scale: 1 });
    if (hintTimer.current) clearTimeout(hintTimer.current);
    setShowResetHint(false); // back at rest — nothing left to reset
  };

  return {
    view,
    dragging: () => drag.current !== null,
    stageProps: {
      onWheel: (e) => { const f = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP; setView((v) => ({ ...v, scale: clamp(v.scale * f, SCALE_MIN, SCALE_MAX) })); noteInteraction(); },
      onPointerDown: (e) => { drag.current = { x: clientPoint(e).x, y: clientPoint(e).y, tx: view.tx, ty: view.ty }; (e.currentTarget as Element).setPointerCapture?.(e.pointerId); },
      onPointerMove: (e) => { const d = drag.current; if (!d) return; setView((v) => ({ ...v, tx: d.tx + (clientPoint(e).x - d.x), ty: d.ty + (clientPoint(e).y - d.y) })); noteInteraction(); },
      onPointerUp: () => { drag.current = null; },
      onPointerLeave: () => { drag.current = null; },
      onDoubleClick: reset,
      style: { cursor: panCursor, touchAction: 'none' },
    },
    viewStyle: {
      transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`,
      transition: drag.current ? 'none' : 'transform .08s',
    },
    showResetHint,
    reset,
  };
}
