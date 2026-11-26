/*
 * The maze's two ends on the map and the drag that moves one. Where an end is dropped decides what it is
 * (`maze-endpoints.ts`): a hole on the maze's own wall, a place to reach anywhere else, which the mark
 * says. Portalled to the body, where the projection's screen coordinates are already right; a Help
 * figure hands in its own map's projection instead (`PicturedMap`) and the marks stand in its box.
 */
import { clientPoint } from '../../../../platform/device/viewport-space';
import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { mapMarkSize, readableWeight } from '../../../design/text-weight';
import { useDenseScript, useDevicePixelRatio } from '../../../design/scale';
import { getActiveView, onProjectionChange } from '../../../../view/active-view';
import type { ViewProjection } from '../../../../tools/pointer/runtime';
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
import { useWindowDrag } from '../../../primitives/use-window-drag';
import { useInteractionProfiles } from '../../../design/input-mode';
import type { I18nKey } from '../../../../i18n/keys';

/** Smallest a mark may draw at, in css px: below this the character stops being readable and the
 *  mark stops doing its one job. */
const MIN_PX = 26;

/** The mark's face at a given size (css px): fill, ink, weight and the size's own ratios. The one
 *  place both the live drag marker and the Help Center's still figure draw a gate pill from. */
function gateMarkStyle(size: number, dpr = 1, dense = false): CSSProperties {
  return {
    background: ACTIVE,
    color: PLATE_INK,
    fontFamily: font.family,
    fontWeight: readableWeight(900, mapMarkSize(size), dense, dpr),
    lineHeight: 1,
    whiteSpace: 'nowrap',
    borderRadius: radii.pill,
    height: `${size}px`,
    padding: `0 ${Math.round(mapMarkSize(size))}px`,
    fontSize: `${mapMarkSize(size)}px`,
  };
}

export type EndId = 'entrance' | 'exit';

/** A map the marks stand on other than the live one: a Help figure's, whose projection answers in
 *  the px of the box the marks are mounted in. They take no input there. */
interface PicturedMap {
  projection: () => ViewProjection | null;
  /** Calls `tell` whenever the projection may have moved; returns the unsubscribe. */
  watch: (tell: () => void) => () => void;
}

export interface MazeEnds {
  entrance: MazeEnd | null;
  exit: MazeEnd | null;
}

function Marker({ end, text, testId, onMove, pictured }: {
  end: MazeEnd;
  text: string;
  testId: string;
  pictured?: PicturedMap;
  /** A cell the pointer is over: `false` while the drag is still running, `true` on the drop. */
  onMove: (cell: MacroCoord, dropped: boolean) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const eventBus = useEditorStore((s) => s.eventBus);
  const dpr = useDevicePixelRatio();
  const dense = useDenseScript();
  const profile = useInteractionProfiles().pill;

  const place = useCallback(() => {
    const el = ref.current;
    const projection = pictured ? pictured.projection() : getActiveView()?.projection;
    if (!el) return;
    if (!projection) { el.style.display = 'none'; return; }
    // The cell's centre and its side on screen, which hold at any turn of either view.
    const centre = projection.cellToScreen(end.cell.x + 0.5, end.cell.y + 0.5);
    if (centre.behind) { el.style.display = 'none'; return; }
    const size = Math.max(MIN_PX, centre.scale);
    el.style.display = 'flex';
    el.style.top = `${centre.y - size / 2}px`;
    // A pill sized to the cell's height and the word's width, so a longer language reads whole.
    Object.assign(el.style, gateMarkStyle(size, dpr, dense));
    el.style.width = 'auto';
    // Measured after the text has its size, so the pill is centred on its cell by its own width.
    const w = el.offsetWidth;
    el.style.left = `${centre.x - w / 2}px`;
  }, [end.cell.x, end.cell.y, dpr, dense, pictured]);

  useEffect(() => {
    place();
    return pictured ? pictured.watch(place) : onProjectionChange(eventBus, place, { cells: false });
  }, [eventBus, place, pictured]);

  // A cancelled drag drops where the pointer last stood, as a release does.
  const cellAt = (e: PointerEvent): MacroCoord | null => {
    const view = getActiveView();
    return view ? cellUnder(view.projection, clientPoint(e).x, clientPoint(e).y, PLACEMENT_GRID) : null;
  };
  const drag = useWindowDrag<null>({
    move: (e) => { const cell = cellAt(e); if (cell) onMove(cell, false); },
    end: (e) => { const cell = cellAt(e); if (cell) onMove(cell, true); },
  });

  return (
    // Framer's scale owns `transform`, which `place()` never writes: it stands the mark by left and top.
    <motion.div
      ref={ref}
      data-testid={testId}
      data-cell={cellKey(end.cell.x, end.cell.y)}
      data-kind={end.kind}
      {...(pictured ? { inert: '' } : helpTargetAttr('maze'))}
      role="button"
      aria-label={text}
      tabIndex={-1}
      onPointerDown={pictured ? undefined : (e) => drag.start(e, null)}
      {...profile}
      style={{
        // The face (fill, ink, font, size ratios) is `place()`'s to draw, from `gateMarkStyle`,
        // once it knows the cell's projected size; this is the shell before that first measurement.
        position: pictured ? 'absolute' : 'fixed', left: 0, top: 0, display: 'none',
        alignItems: 'center', justifyContent: 'center',
        zIndex: pictured ? undefined : z.canvasControls, cursor: cursors.clickable, touchAction: 'none', pointerEvents: pictured ? 'none' : undefined,
      }}
    >
      {text}
    </motion.div>
  );
}

export function MazeEndpoints({ ends, onMove, pictured }: {
  ends: MazeEnds | null;
  onMove: (which: EndId, cell: MacroCoord, dropped: boolean) => void;
  pictured?: PicturedMap;
}) {
  const t = useT();
  if (!ends || typeof document === 'undefined') return null;
  // A hole is a way through and a destination is a place to arrive at, so each mark says which its
  // own end turned out to be rather than both wearing the word the request used.
  const word = (end: MazeEnd, hole: I18nKey): string => t(end.kind === 'hole' ? hole : 'generate.gate_to');
  const marks = (
    <>
      {ends.entrance ? (
        <Marker
          end={ends.entrance}
          text={word(ends.entrance, 'generate.gate_in')}
          testId="shell-gate-entrance"
          onMove={(cell, dropped) => onMove('entrance', cell, dropped)}
          pictured={pictured}
        />
      ) : null}
      {ends.exit ? (
        <Marker
          end={ends.exit}
          text={word(ends.exit, 'generate.gate_out')}
          testId="shell-gate-exit"
          onMove={(cell, dropped) => onMove('exit', cell, dropped)}
          pictured={pictured}
        />
      ) : null}
    </>
  );
  return pictured ? marks : createPortal(marks, document.body);
}
