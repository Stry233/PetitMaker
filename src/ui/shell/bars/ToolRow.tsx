import { useRef, type ReactNode } from 'react';
import { useScrollRow } from '../../primitives/use-scroll-row';
import { QUAD, SCALE } from '../units';
import { useRailClearance } from '../frame-layout';
import { cssMotion } from '../../design/motion';
import { CELL_BOX } from './ToolCell';
import { ACTIVE_PLATE } from './terrain-cells';
import { useFrameZoom } from './row-scroll';

export const SWATCH_ROW_GAP = 20;
export const SWATCH_ROW_BOTTOM = QUAD.bottom + CELL_BOX.h + SWATCH_ROW_GAP;

/** Scroll crowded tools without stacking them into the mode row; padding preserves their captions. */
export function ToolRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const zoom = useFrameZoom();
  const fade = useScrollRow(ref, { zoom, bleed: { top: 16, right: 12, bottom: 36, left: 12 }, pointerEvents: 'none' });
  const overhang = ACTIVE_PLATE.dy * SCALE;
  const clearance = useRailClearance(QUAD.bottom - overhang, CELL_BOX.h + 2 * overhang);
  return (
    <div
      ref={ref}
      data-testid="shell-tool-row"
      className="pw-noscroll"
      style={{
        display: 'flex', alignItems: 'flex-start', gap: QUAD.gap,
        ...fade,
        marginRight: clearance - 12,
        transition: cssMotion('frame.layout.adapt', ['margin-right']),
      }}
    >
      {children}
    </div>
  );
}
