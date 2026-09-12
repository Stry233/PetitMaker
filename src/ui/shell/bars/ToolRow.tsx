import { useRef, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { useScrollFade } from '../../primitives/scroll-fade';
import { QUAD, SCALE } from '../units';
import { useRailClearance } from '../frame-layout';
import { cssMotion } from '../motion/use-motion';
import { CELL_BOX } from './ToolCell';
import { ACTIVE_PLATE } from './terrain-cells';
import { useFrameZoom, wheelGlider, wheelPush } from './row-scroll';

export const SWATCH_ROW_GAP = 20;
export const SWATCH_ROW_BOTTOM = QUAD.bottom + CELL_BOX.h + SWATCH_ROW_GAP;

/** Scroll crowded tools without stacking them into the mode row; padding preserves their captions. */
export function ToolRow({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(ref, 'x');
  const zoom = useFrameZoom();
  const reduced = useReducedMotionConfig() ?? false;
  const glide = useRef(wheelGlider()).current;
  const overhang = ACTIVE_PLATE.dy * SCALE;
  const clearance = useRailClearance(QUAD.bottom - overhang, CELL_BOX.h + 2 * overhang);
  return (
    <div
      ref={ref}
      data-testid="shell-tool-row"
      className="pw-noscroll"
      onWheel={(e) => {
        const row = e.currentTarget;
        const push = row.scrollWidth > row.clientWidth ? wheelPush(e, row.clientWidth, zoom) : null;
        if (push) glide.wheel(row, push.by, reduced);
      }}
      style={{
        display: 'flex', alignItems: 'flex-start', gap: QUAD.gap,
        overflowX: 'auto', overflowY: 'hidden', pointerEvents: 'none',
        padding: '16px 12px 36px', margin: '-16px -12px -36px',
        marginRight: clearance - 12,
        transition: cssMotion('frame.layout.adapt', 'margin-right'),
        ...fade,
      }}
    >
      {children}
    </div>
  );
}
