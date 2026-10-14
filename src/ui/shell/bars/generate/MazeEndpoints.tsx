/*
 * The maze's two ends on the map and the drag that moves one. Where an end is dropped decides what it is
 * (`maze-endpoints.ts`): a hole on the maze's own wall, a place to reach anywhere else, which the mark
 * says. Portalled to the body, where the projection's screen coordinates are already right.
 */
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { isDenseScript, readableWeight } from '../../../design/text-weight';
import { getActiveView, onProjectionChange } from '../../../../view/active-view';
import type { MacroCoord } from '../../../../core/model/types';
import { useT } from '../../../../i18n/context';
import { useEditorStore } from '../../../../state/store';
import type { MazeEnd } from '../../../../tools/generation/maze';
import { helpTargetAttr } from '../../../session/help-targets';
import { cursors, font, radii, z } from '../../../design/styles';
import { ACTIVE, PLATE_INK } from '../../../design/tokens';
import { PLACEMENT_GRID } from '../../../../core/game/profile';
import { cellUnder } from '../../../../core/grid/pointer';
import { cellKey } from '../../../../core/grid/rect';
import type { I18nKey } from '../../../../i18n/keys';

/** Smallest a mark may draw at, in css px: below this the character stops being readable and the
 *  mark stops doing its one job. */
export const MIN_PX = 26;

/** The mark's face at a given size (css px): fill, ink, weight and the size's own ratios. The one
 *  place both the live drag marker and the Help Center's still figure draw a gate pill from. */
export function gateMarkStyle(size: number, dpr = 1, dense = false): CSSProperties {
  return {
    background: ACTIVE,
    color: PLATE_INK,
    fontFamily: font.family,
    fontWeight: readableWeight(900, size * 0.42, dense, dpr),
    lineHeight: 1,
    whiteSpace: 'nowrap',
    borderRadius: radii.pill,
    height: `${size}px`,
    padding: `0 ${Math.round(size * 0.42)}px`,
    fontSize: `${size * 0.42}px`,
  };
}

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
    // A pill sized to the cell's height and the word's width, so a longer language reads whole.
    Object.assign(el.style, gateMarkStyle(size, window.devicePixelRatio || 1, isDenseScript(useEditorStore.getState().locale)));
    el.style.width = 'auto';
    // Measured after the text has its size, so the pill is centred on its cell by its own width.
    const w = el.offsetWidth;
    el.style.left = `${tl.x + (br.x - tl.x) / 2 - w / 2}px`;
  }, [end.cell.x, end.cell.y]);

  useEffect(() => {
    place();
    return onProjectionChange(eventBus, place, { cells: false });
  }, [eventBus, place]);

  /*
   * The drag is followed on the window from the press: synthetic pointers cannot claim a capture, and a state
   * flag would miss the first moves.
   */
  const latest = useRef(onMove);
  latest.current = onMove;
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const startDrag = useCallback((): void => {
    stop.current?.();
    const cellAt = (e: PointerEvent): MacroCoord | null => {
      const view = getActiveView();
      return view ? cellUnder(view.projection, clientPoint(e).x, clientPoint(e).y, PLACEMENT_GRID) : null;
    };
    const move = (e: PointerEvent): void => {
      const cell = cellAt(e);
      if (cell) latest.current(cell, false);
    };
    const up = (e: PointerEvent): void => {
      stop.current?.();
      const cell = cellAt(e);
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
      data-cell={cellKey(end.cell.x, end.cell.y)}
      data-kind={end.kind}
      {...helpTargetAttr('maze')}
      role="button"
      aria-label={text}
      tabIndex={-1}
      onPointerDown={startDrag}
      style={{
        // The face (fill, ink, font, size ratios) is `place()`'s to draw, from `gateMarkStyle`,
        // once it knows the cell's projected size; this is the shell before that first measurement.
        position: 'fixed', left: 0, top: 0, display: 'none',
        alignItems: 'center', justifyContent: 'center',
        zIndex: z.canvasControls, cursor: cursors.clickable, touchAction: 'none',
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
  // A hole is a way through and a destination is a place to arrive at, so each mark says which its
  // own end turned out to be rather than both wearing the word the request used.
  const word = (end: MazeEnd, hole: I18nKey): string => t(end.kind === 'hole' ? hole : 'generate.gate_to');
  return createPortal(
    <>
      {ends.entrance ? (
        <Marker
          end={ends.entrance}
          text={word(ends.entrance, 'generate.gate_in')}
          testId="shell-gate-entrance"
          onMove={(cell, dropped) => onMove('entrance', cell, dropped)}
        />
      ) : null}
      {ends.exit ? (
        <Marker
          end={ends.exit}
          text={word(ends.exit, 'generate.gate_out')}
          testId="shell-gate-exit"
          onMove={(cell, dropped) => onMove('exit', cell, dropped)}
        />
      ) : null}
    </>,
    document.body,
  );
}
