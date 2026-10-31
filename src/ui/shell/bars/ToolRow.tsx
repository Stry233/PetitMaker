import { useRef, type ReactNode } from 'react';
import { useScrollRow } from '../../primitives/use-scroll-row';
import { QUAD, SCALE } from '../units';
import { usePlanGlide, useRailClearance } from '../frame-layout';
import { ACTIVE_PLATE, CELL_BOX } from './terrain-cells';
import { useFrameZoom } from '../use-frame-zoom';
import { CAPTION_HANG, PILL_RISE } from './ToolPill';

/** The room the row's controls draw past its box: a pill's plate, hover growth and badge above, hover
 *  growth at the ends, captions below. */
const BLEED = { top: PILL_RISE, right: 12, bottom: CAPTION_HANG, left: 12 } as const;

/** Scroll crowded tools without stacking them into the mode row; padding preserves their captions. */
export function ToolRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useFrameZoom();
  const fade = useScrollRow(ref, { zoom, bleed: BLEED, pointerEvents: 'none' });
  const overhang = ACTIVE_PLATE.dy * SCALE;
  const clearance = useRailClearance(QUAD.bottom - overhang, CELL_BOX.h + 2 * overhang);
  const glide = usePlanGlide('frame.layout.adapt');
  return (
    <div
      ref={ref}
      data-testid="shell-tool-row"
      className="pw-noscroll"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: QUAD.gap,
        ...fade,
        // The rail's clearance replaces the bleed's own right margin, so the bleed still reaches past it.
        marginRight: clearance - BLEED.right,
        transition: glide(['margin-right']),
      }}
    >
      {children}
    </div>
  );
}
