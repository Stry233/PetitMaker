/*
 * The anchors of a just-drawn curve, still adjustable.
 *
 * The curve is painted terrain; these are HTML controls anchored to the same screen points, in the
 * shape `SelectionCard` established: project each anchor through the `ACTIVE` view, re-track
 * imperatively on viewport-changed / resize / an active-view swap (React gets no per-frame signal),
 * and divide the chrome zoom back out of the rect-derived coordinates.
 *
 * Each anchor is a round grab, with a direction line through it ending in a smaller knob either
 * side. Dragging the grab moves the anchor; dragging a knob turns the tangent, and its opposite
 * mirrors so the path stays smooth through the anchor — hold the break key (Alt) and the two sides
 * turn apart, making the anchor a corner. Only the end of a drag re-lays the map, so a drag costs
 * one undo step and the frames in between are free.
 *
 * They are deliberately absent while the curve is being drawn — a handle under the cursor is in the
 * way of the next click, and there is nothing to tune until there is a curve. They arrive one after
 * another when it finishes, and fade out together when it is dismissed.
 */
import { cursors, shadows, z } from '../../design/styles';
import { framerMotion, NO_MOTION, staggerDelay } from '../../design/motion';
import { helpTargetAttr } from '../../session/help-targets';
import { clientPoint } from '../../../platform/device/viewport-space';
import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { getActiveView, onActiveViewChange, onProjectionChange } from '../../../view/active-view';
import type { ActiveView } from '../../../tools/pointer/runtime';
import type { CurveSessions } from '../../../tools/pointer/paint';
import { editorCurves } from '../../../editor/session/tool-wiring';
import { anchorHandles } from '../../../core/base/spline';
import { isCommandHeld } from '../../../state/keymap/held';
import { useEditorStore } from '../../../state/store';
import { useChromeScale } from '../../design/scale';
import { useT } from '../../../i18n/context';
import { TILE_SIZE } from '../../../view/map2d/geometry/world';
import { gridCellCentre } from '../../../core/grid/grids';
import { GRIDS } from '../../../core/game/profile';
import { FRAME_INK, ACTIVE, PLATE } from '../../design/tokens';
import { useInteractionProfiles } from '../../design/input-mode';
import { useWindowDrag } from '../../primitives/use-window-drag';

/**
 * Anchor grab and tangent knob at full map zoom, in css px — around the size of the selection's
 * corner buttons.
 *
 * Unlike those, these do shrink as the map zooms out, down to `MIN_SCALE`. A selection has one box
 * and a fixed control reads right over it at any zoom; a curve has an anchor every few cells, so
 * fixed controls swell to cover the very shape they are meant to be adjusting once the map is small.
 * The floor is what keeps them grabbable, and they never grow past the sizes below.
 */
const GRAB = 30;
const KNOB = 18;
const MIN_SCALE = 0.45;
/** Every control gets at least this much clickable width, whatever it looks like. A tangent knob is
 *  a small dot by design — it must not also be a small target, and at low zoom it shrinks further.
 *  The extra is transparent padding around the face, so precision does not cost visual weight. */
const MIN_HIT = 30;
const HIT_PAD = 12;

/** How much to shrink the controls: 1 at full map zoom, floored so they stay usable. */
function handleScale(cellPx: number): number {
  return Math.min(1, Math.max(MIN_SCALE, cellPx / TILE_SIZE));
}

interface ScreenAnchor {
  /** The anchor's own screen point. */
  x: number;
  y: number;
  /** The two ends of its direction line, in screen px. */
  out: { x: number; y: number };
  into: { x: number; y: number };
}

/** What is being dragged: an anchor body, or one end of its direction line. */
type Grab = { index: number; kind: 'anchor' | 'out' | 'into' };

/** The transparent target, centred on the point: bigger than the dot it holds. */
const hitBox = (face: number): CSSProperties => {
  const hit = Math.max(MIN_HIT, face + HIT_PAD);
  return {
    position: 'absolute',
    width: hit,
    height: hit,
    marginLeft: -hit / 2,
    marginTop: -hit / 2,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'transparent',
    border: 'none',
    borderRadius: '50%',
    cursor: cursors.clickable,
    pointerEvents: 'auto',
    padding: 0,
    WebkitTapHighlightColor: 'transparent',
    // The handle owns the drag; without this a touch drag scrolls the page instead.
    touchAction: 'none',
  };
};

/** The visible dot: the same round, borderless, shadowed face the selection's corner buttons wear —
 *  this is a control the user grabs, not a technical vertex marker. */
const face = (size: number, fill: string): CSSProperties => ({
  width: size,
  height: size,
  borderRadius: '50%',
  background: fill,
  boxShadow: shadows.float,
  pointerEvents: 'none',
});

/** Where a handle layer reads its curve and map: the curve sessions, the view whose projection
 *  places the handles, and when to place them again. The live layer reads the editor's; a Help
 *  figure hands in its own world's and renderer's. What ends a session and where its footprint
 *  draws are its host's (`editor/session/tool-wiring.ts:watchCurveSession`). */
export interface CurveHandleSource {
  sessions: CurveSessions;
  view: () => Pick<ActiveView, 'projection'> | null;
  /** Calls `tell` whenever the view may have moved or been swapped; returns the unsubscribe. */
  watch: (tell: () => void) => () => void;
  /** The zoom the layer stands under, which projected screen px are divided by. */
  zoom: number;
}

export function CurveHandles() {
  const chrome = useChromeScale();
  const eventBus = useEditorStore((s) => s.eventBus);
  const [, bump] = useState(0);
  useEffect(() => editorCurves.subscribe(() => bump((n) => n + 1)), []);
  const anchored = (editorCurves.get()?.anchors.length ?? 0) > 0;
  const watch = useCallback((tell: () => void) => {
    const offView = onActiveViewChange(tell);
    const offProjection = anchored ? onProjectionChange(eventBus, tell) : () => {};
    return () => { offView(); offProjection(); };
  }, [eventBus, anchored]);
  const source = useMemo<CurveHandleSource>(
    () => ({ sessions: editorCurves, view: getActiveView, watch, zoom: chrome }),
    [watch, chrome],
  );
  return <CurveHandleLayer source={source} />;
}

/** The handles of the curve `source` holds open: the live controls in the editor, the same controls
 *  pictured in a Help figure, where the layer fills its box and takes no input. */
export function CurveHandleLayer({ source, pictured = false }: { source: CurveHandleSource; pictured?: boolean }) {
  const t = useT();
  const profiles = useInteractionProfiles();
  const reduced = useReducedMotionConfig();
  const { sessions, view, watch, zoom } = source;
  const [, bump] = useState(0);
  const [screen, setScreen] = useState<ScreenAnchor[]>([]);
  const [zoomK, setZoomK] = useState(1);

  // The session is owned by the tool, not by React, so re-render on its revision rather than holding
  // a copy that could go stale mid-drag.
  useEffect(() => sessions.subscribe(() => bump((n) => n + 1)), [sessions]);

  const session = sessions.get();

  /** Project every anchor, and the two ends of its direction line, into screen px. */
  const reproject = useCallback(() => {
    const live = sessions.get();
    const proj = view()?.projection;
    if (!live || !proj) { setScreen([]); return; }
    setZoomK(handleScale(proj.cellToScreen(0, 0).scale));
    const handles = anchorHandles(live.anchors);
    // Anchors are cells of the session's grid, so the handles sit on those cells' centres. A
    // free-coord session's anchors already carry their own fractions.
    const shift = live.freeCoords ? { x: 0, y: 0 } : gridCellCentre(GRIDS[live.grid], { x: 0, y: 0 });
    const point = (x: number, y: number) => {
      const p = proj.cellToScreen(x + shift.x, y + shift.y);
      return { x: p.x / zoom, y: p.y / zoom };
    };
    setScreen(live.anchors.map((a, i) => ({
      ...point(a.x, a.y),
      out: point(a.x + handles[i]!.hx, a.y + handles[i]!.hy),
      into: point(a.x + handles[i]!.ihx, a.y + handles[i]!.ihy),
    })));
  }, [sessions, view, zoom]);

  useEffect(() => { reproject(); }, [session, reproject]);
  useEffect(() => watch(reproject), [watch, reproject]);

  // The pointer routinely leaves an 18px target, so a grab follows it on the window.
  const apply = (e: PointerEvent, g: Grab, commit: boolean) => {
    const live = sessions.get();
    const proj = view()?.projection;
    if (!live || !proj) return;
    const cell = sessions.anchorAt(proj.screenToPoint(clientPoint(e).x, clientPoint(e).y));
    if (!cell) return;
    if (g.kind === 'anchor') { sessions.moveAnchor(g.index, cell.x, cell.y, commit); return; }
    const a = live.anchors[g.index];
    if (!a) return;
    // The knob's offset from its anchor is that side of the handle. Read the break key from the
    // event rather than at press time: pressing or releasing it mid-drag takes effect there and
    // then, the way it does in a drawing app.
    sessions.setHandle(g.index, g.kind, cell.x - a.x, cell.y - a.y, {
      commit, mirror: !isCommandHeld('tool.break_handle'),
    });
  };
  const drag = useWindowDrag<Grab>({
    move: (e, g) => { e.preventDefault(); apply(e, g, false); reproject(); },
    end: (e, g) => { apply(e, g, true); reproject(); },
    cancel: () => { sessions.end(); reproject(); },
  });

  const start = (index: number, kind: 'anchor' | 'out' | 'into') => (e: React.PointerEvent) => {
    // Stop the press reaching the canvas: down there means "dismiss the handles", which is exactly
    // what grabbing one must not do. A pictured layer takes no input.
    e.preventDefault();
    e.stopPropagation();
    if (!pictured) drag.start(e, { index, kind });
  };

  return (
    <AnimatePresence>
      {screen.length > 0 && (
        <motion.div
          {...(pictured ? { inert: '' } : helpTargetAttr('terrain', 'terrain-curve'))}
          key="curve-handles"
          data-testid="curve-handles"
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          // Dismissing is a quiet exit: the curve is already on the map, and the handles going is
          // the only thing that happens.
          exit={reduced ? { opacity: 0, transition: NO_MOTION } : { opacity: 0, transition: framerMotion('curve.fade') }}
          style={{
            position: pictured ? 'absolute' : 'fixed', inset: 0, zIndex: pictured ? undefined : z.canvasControls,
            pointerEvents: 'none', zoom,
          }}
        >
          {/* Every direction line in one full-screen svg. Not one per anchor: an svg sized to the
              viewport cannot be inside an element that scales, or the entrance animation scales the
              whole coordinate space and the line sweeps in from the corner. */}
          <svg width="100%" height="100%" aria-hidden
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }}>
            {session?.tangents && screen.map((s, i) => (
              // Through the anchor rather than knob to knob: a broken handle bends here, and a
              // straight line across it would draw a smooth join the path does not have.
              <motion.polyline
                key={i}
                points={`${s.into.x},${s.into.y} ${s.x},${s.y} ${s.out.x},${s.out.y}`}
                fill="none"
                stroke={FRAME_INK} strokeWidth={3 * zoomK} strokeLinecap="round"
                strokeLinejoin="round"
                initial={reduced ? false : { strokeOpacity: 0 }}
                animate={{ strokeOpacity: 0.35 }}
                transition={reduced ? NO_MOTION : { ...framerMotion('curve.fade'), delay: staggerDelay('curve.fade', i) }}
              />
            ))}
          </svg>

          {/* The grabs. The pop is on each dot, so it scales about its own centre and lands where it
              belongs; one after another rather than together, which reads as the curve's direction.
              Hover and press scale the target around it, on their own spring and free of the pop's
              stagger delay. */}
          {screen.map((s, i) => {
            const grabPx = GRAB * zoomK;
            const knobPx = KNOB * zoomK;
            // A handle pops one stagger after the anchor it belongs to.
            const dot = (size: number, fill: string, handle: boolean) => (
              <motion.span
                style={face(size, fill)}
                initial={reduced ? false : { scale: 0 }} animate={{ scale: 1 }}
                transition={reduced ? NO_MOTION : { ...framerMotion('surface.pop'), delay: staggerDelay('curve.fade', handle ? i + 1 : i) }}
              />
            );
            return (
              <div key={i}>
                <motion.button
                  type="button" aria-label={t('a11y.curve_anchor', { n: i + 1 })}
                  onPointerDown={start(i, 'anchor')}
                  {...profiles.curveVertex}
                  style={{ ...hitBox(grabPx), left: s.x, top: s.y }}
                >
                  {dot(grabPx, ACTIVE, false)}
                </motion.button>
                {session?.tangents && <><motion.button
                  type="button" aria-label={t('a11y.curve_out', { n: i + 1 })}
                  onPointerDown={start(i, 'out')}
                  {...profiles.curveHandle}
                  style={{ ...hitBox(knobPx), left: s.out.x, top: s.out.y }}
                >
                  {dot(knobPx, PLATE, true)}
                </motion.button>
                <motion.button
                  type="button" aria-label={t('a11y.curve_in', { n: i + 1 })}
                  onPointerDown={start(i, 'into')}
                  {...profiles.curveHandle}
                  style={{ ...hitBox(knobPx), left: s.into.x, top: s.into.y }}
                >
                  {dot(knobPx, PLATE, true)}
                </motion.button></>}
              </div>
            );
          })}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
