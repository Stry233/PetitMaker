/*
 * MazeEndpoints.tsx — the maze's two ends, on the map, and the drag that moves one.
 *
 * BOTH ARE THERE FROM THE MOMENT A MAZE IS ON THE MAP, on a default that already makes sense: in
 * from the edge, out at the plaza. So the feature teaches itself by being visible, and most people
 * will never move one — which is the goal rather than a failure. There is no arming button, no
 * two-click sequence and no mode; the old one asked for a click on a boundary that did not exist
 * yet and then silently waited for a second one.
 *
 * WHERE AN END IS DROPPED DECIDES WHAT IT IS (`tools/generation/maze-endpoints.ts`): on the maze's
 * own wall it is a hole you pass through, anywhere else it is a place inside to reach. The marker
 * says which it became — that is feedback, not a question, and there is no control for it.
 *
 * DRAGGING RECOMPUTES THE WALK, IT DOES NOT RE-CARVE. Moving a destination costs no terrain at all;
 * moving a hole moves ONE cell of wall, opening where the marker landed and closing where it left.
 * Both edits go through the live executor in one stroke group, so the map is never half-moved: a
 * refusal puts the marker back where it was.
 *
 * Portalled to the body: the marks belong over the map, and outside the bar's chrome-zoomed subtree
 * the projection's screen coordinates are already the right ones.
 */
import { useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { getActiveView, onActiveViewChange } from '../../../canvas/active-view';
import type { MacroCoord } from '../../../core/model/types';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { MazeEnd } from '../../../tools/generation/maze-endpoints';
import { cursors, font } from '../../design/styles';
import { ACTIVE, PLATE_INK } from '../../design/tokens';

/** Smallest a mark may draw at, in css px: below this the character stops being readable and the
 *  mark stops doing its one job. */
const MIN_PX = 26;

export type EndId = 'entrance' | 'exit';

export interface MazeEnds {
  entrance: MazeEnd | null;
  exit: MazeEnd | null;
}

function Marker({ end, text, testId, onMove }: {
  end: MazeEnd;
  text: string;
  testId: string;
  /** A cell the pointer is over: `false` while the drag is still running, `true` on the drop. */
  onMove: (cell: MacroCoord, dropped: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const eventBus = useEditorStore((s) => s.eventBus);

  const place = useCallback(() => {
    const el = ref.current;
    const projection = getActiveView()?.projection;
    if (!el) return;
    if (!projection) { el.style.display = 'none'; return; }
    const tl = projection.cellToScreen(end.cell.x, end.cell.y);
    const br = projection.cellToScreen(end.cell.x + 1, end.cell.y + 1);
    const size = Math.max(MIN_PX, br.x - tl.x);
    // A cell behind the camera projects through a negative divide: finite coordinates, mirrored.
    if (tl.behind || !(br.x - tl.x > 0)) { el.style.display = 'none'; return; }
    el.style.display = 'flex';
    el.style.top = `${tl.y + (br.y - tl.y) / 2 - size / 2}px`;
    // A PILL, NOT A DISC. The mark carries a WORD, and a circle sized to the cell clipped it: the
    // whole point of naming the two ends is that a person should not have to work out which is
    // which. The height is the cell's, the width is whatever the word needs, and the pill grows
    // around it — so a longer language reads rather than being cut.
    el.style.height = `${size}px`;
    el.style.width = 'auto';
    el.style.padding = `0 ${Math.round(size * 0.42)}px`;
    el.style.fontSize = `${size * 0.42}px`;
    el.style.borderRadius = '999px';
    // Measured after the text has its size, so the pill is centred on its cell by its OWN width.
    const w = el.offsetWidth;
    el.style.left = `${tl.x + (br.x - tl.x) / 2 - w / 2}px`;
  }, [end.cell.x, end.cell.y]);

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
   * capture to claim and the call throws, which would take the whole press with it. And not through
   * a state flag either — a flag is read by the NEXT render, so the first moves of a drag arrive
   * before anything is listening. The mark is a 26 px disc and a drag leaves it within a cell of
   * starting, so those first moves are most of the gesture.
   */
  const latest = useRef(onMove);
  latest.current = onMove;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const startDrag = useCallback((): void => {
    stop.current?.();
    const cellUnder = (e: PointerEvent): MacroCoord | null =>
      getActiveView()?.projection.screenToMacro(e.clientX, e.clientY) ?? null;
    const move = (e: PointerEvent): void => {
      const cell = cellUnder(e);
      if (cell) latest.current(cell, false);
    };
    const up = (e: PointerEvent): void => {
      stop.current?.();
      const cell = cellUnder(e);
      if (cell) latest.current(cell, true);
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
    <div
      ref={ref}
      data-testid={testId}
      data-cell={`${end.cell.x},${end.cell.y}`}
      data-kind={end.kind}
      role="button"
      aria-label={text}
      tabIndex={-1}
      onPointerDown={startDrag}
      style={{
        position: 'fixed', left: 0, top: 0, display: 'none',
        alignItems: 'center', justifyContent: 'center',
        background: ACTIVE, color: PLATE_INK,
        // The interface's own face. It was falling back to the browser's default, which is why the
        // marks read as foreign to everything around them.
        fontFamily: font.family,
        fontWeight: 900, lineHeight: 1, whiteSpace: 'nowrap', zIndex: 2,
        cursor: cursors.clickable, touchAction: 'none',
      }}
    >
      {text}
    </div>
  );
}

export function MazeEndpoints({ ends, onMove }: {
  ends: MazeEnds | null;
  onMove: (which: EndId, cell: MacroCoord, dropped: boolean) => void;
}) {
  const t = useT();
  if (!ends || typeof document === 'undefined') return null;
  // A hole is a way THROUGH and a destination is a place to arrive at, so each mark says which its
  // own end turned out to be rather than both wearing the word the request used.
  const word = (end: MazeEnd, hole: string): string => t(end.kind === 'hole' ? hole : 'gen.gate_to');
  return createPortal(
    <>
      {ends.entrance ? (
        <Marker
          end={ends.entrance}
          text={word(ends.entrance, 'gen.gate_in')}
          testId="shell-gate-entrance"
          onMove={(cell, dropped) => onMove('entrance', cell, dropped)}
        />
      ) : null}
      {ends.exit ? (
        <Marker
          end={ends.exit}
          text={word(ends.exit, 'gen.gate_out')}
          testId="shell-gate-exit"
          onMove={(cell, dropped) => onMove('exit', cell, dropped)}
        />
      ) : null}
    </>,
    document.body,
  );
}
