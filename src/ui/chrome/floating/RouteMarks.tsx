/*
 * Draggable HTML marks for a completed route's near and far endpoints. Their positions follow the
 * active view projection. Undo, redo, session close, and a changed arming epoch remove them
 * immediately; the epoch comparison uses the session's own value so switches during an async build
 * also invalidate its marks.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { getActiveView, onActiveViewChange } from '../../../canvas/active-view';
import type { MacroCoord } from '../../../core/model/types';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import {
  closeRouteMarks, getRouteSession, moveRouteMark, subscribeRouteSession, type RouteMarkId,
} from '../../../tools/macros';
import { cursors, font, springs, z } from '../../design/styles';
import { ACTIVE, PLATE_INK } from '../../design/tokens';

/** Smallest a mark may draw at, in css px: below this the word stops being readable and the mark stops
 *  doing its one job. */
const MIN_PX = 26;

function Mark({ id, cell, text, onMove }: {
  id: RouteMarkId;
  cell: MacroCoord;
  text: string;
  /** A cell the pointer is over: `false` while the drag is still running, `true` on the drop. */
  onMove: (cell: MacroCoord, dropped: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig();
  const eventBus = useEditorStore((s) => s.eventBus);

  const place = useCallback(() => {
    const el = ref.current;
    const projection = getActiveView()?.projection;
    if (!el) return;
    if (!projection) { el.style.display = 'none'; return; }
    const tl = projection.cellToScreen(cell.x, cell.y);
    const br = projection.cellToScreen(cell.x + 1, cell.y + 1);
    const size = Math.max(MIN_PX, br.x - tl.x);
    // A cell behind the camera projects through a negative divide: finite coordinates, mirrored.
    if (tl.behind || !(br.x - tl.x > 0)) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.style.top = `${tl.y + (br.y - tl.y) / 2 - size / 2}px`;
    // A PILL, NOT A DISC: the height is the cell's and the width is whatever the word needs, so a
    // longer language reads rather than being cut.
    el.style.height = `${size}px`;
    el.style.padding = `0 ${Math.round(size * 0.42)}px`;
    el.style.fontSize = `${size * 0.42}px`;
    // Measured after the text has its size, so the pill is centred on its cell by its OWN width.
    el.style.left = `${tl.x + (br.x - tl.x) / 2 - el.offsetWidth / 2}px`;
  }, [cell.x, cell.y]);

  useEffect(() => {
    place();
    eventBus.on('viewport-changed', place);
    window.addEventListener('resize', place);
    const offView = onActiveViewChange(place);
    return () => {
      eventBus.off('viewport-changed', place);
      window.removeEventListener('resize', place);
      offView();
    };
  }, [eventBus, place]);

  /*
   * THE DRAG IS FOLLOWED ON THE WINDOW, and the listeners go on AT THE PRESS.
   *
   * Not through `setPointerCapture`: a synthetic pointer (a browser driving the page) has no active
   * capture to claim and the call throws, which would take the whole press with it. And not through a
   * state flag either, since a flag is read by the NEXT render and the first moves of a drag arrive
   * before anything is listening. A mark is about a cell wide and a drag leaves it within a cell of
   * starting, so those first moves are most of the gesture.
   */
  const latest = useRef(onMove);
  latest.current = onMove;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const startDrag = useCallback((e: React.PointerEvent): void => {
    // A press that reached the canvas would put these marks away, which is exactly what grabbing one
    // must not do.
    e.preventDefault();
    e.stopPropagation();
    stop.current?.();
    const cellUnder = (ev: PointerEvent): MacroCoord | null =>
      getActiveView()?.projection.screenToMacro(ev.clientX, ev.clientY) ?? null;
    // The last cell the drag was over, so a release off the map (past the shore, over a bar) still
    // drops the mark where the ghost last promised it rather than leaving the nudge unfinished.
    let last: MacroCoord | null = null;
    const move = (ev: PointerEvent): void => {
      const at = cellUnder(ev);
      if (at) { last = at; latest.current(at, false); }
    };
    const up = (ev: PointerEvent): void => {
      stop.current?.();
      const at = cellUnder(ev) ?? last;
      if (at) latest.current(at, true);
    };
    stop.current = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      stop.current = null;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }, []);

  return (
    <motion.div
      ref={ref}
      data-testid={`route-mark-${id}`}
      data-cell={`${cell.x},${cell.y}`}
      role="button"
      aria-label={text}
      tabIndex={-1}
      onPointerDown={startDrag}
      initial={reduced ? false : { scale: 0 }}
      animate={{ scale: 1 }}
      whileHover={{ scale: 1.06 }}
      transition={reduced ? { duration: 0 } : springs.bouncy}
      style={{
        position: 'fixed', left: 0, top: 0, display: 'none',
        alignItems: 'center', justifyContent: 'center',
        background: ACTIVE, color: PLATE_INK,
        fontFamily: font.family,
        fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', borderRadius: 999,
        zIndex: z.canvasControls,
        cursor: cursors.clickable, touchAction: 'none',
      }}
    >
      {text}
    </motion.div>
  );
}

export function RouteMarks() {
  const t = useT();
  const eventBus = useEditorStore((s) => s.eventBus);
  const armingEpoch = useEditorStore((s) => s.armingEpoch);
  const [, bump] = useState(0);

  // The session is a module singleton (the tool owns it, not React), so re-render on its revision
  // rather than holding a copy that could go stale mid-drag.
  useEffect(() => subscribeRouteSession(() => bump((n) => n + 1)), []);

  useEffect(() => {
    const gone = () => { closeRouteMarks(); };
    eventBus.on('history-applied', gone);
    return () => { eventBus.off('history-applied', gone); };
  }, [eventBus]);

  const session = getRouteSession();
  // Marks under a different arming than the one that laid them are stale, whether the switch came
  // after they opened or before. Closing runs the owner's `finalize`, which cannot happen during a
  // render, so the effect does it and this render already draws nothing.
  const stale = session !== null && session.epoch !== armingEpoch;
  useEffect(() => { if (stale) closeRouteMarks(); }, [stale]);

  if (!session || stale) return null;
  return (
    <>
      <Mark
        id="from" cell={session.from} text={t('smart.mark_from')}
        onMove={(cell, dropped) => moveRouteMark('from', cell.x, cell.y, dropped)}
      />
      <Mark
        id="to" cell={session.to} text={t('smart.mark_to')}
        onMove={(cell, dropped) => moveRouteMark('to', cell.x, cell.y, dropped)}
      />
    </>
  );
}
