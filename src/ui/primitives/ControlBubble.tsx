import { useState, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { font, radii, shadows, z } from '../design/styles';
import { presence } from '../design/motion';
import { roleFont } from '../design/text-weight';
import { skin } from '../design/window-skin';
import { TOUCH_TARGET } from '../design/scale';
import { useUiPreview } from '../design/preview';
import { useChromeLift } from './chrome-layer';
import { useFloatingPosition } from './use-floating-position';

/** The air between a bubble and its control, in the bubble's px. */
const GAP = 8;

const face: CSSProperties = {
  background: skin.plate, color: skin.ink, border: `1px solid ${skin.line}`, borderRadius: radii.md,
  padding: '4px 10px', fontFamily: font.family, ...roleFont('caption'), whiteSpace: 'nowrap', boxShadow: shadows.float,
  pointerEvents: 'none',
};

const bubble: CSSProperties = { ...face, position: 'absolute', left: '50%' };

/** Half the tail's side, in the bubble's px. */
const TAIL_HALF = 5;

/** A square turned to a point; `left` is where the point falls, its one drawn side border included. */
const tail: CSSProperties = {
  position: 'absolute', left: '50%', marginLeft: -TAIL_HALF - 1, width: 2 * TAIL_HALF, height: 2 * TAIL_HALF,
  background: skin.plate, border: `1px solid ${skin.line}`, transform: 'rotate(45deg)',
};

/**
 * A short word hung from a control: above it (`side="above"`, tail down) or below it. Place it
 * inside a positioned element around the control that does not clip. `announce` makes it a polite
 * status, for a word that reports what just happened; without it the bubble is hidden from
 * assistive technology, for a word the control's own label already says. Centring rides Framer's
 * `x`, so the element carries no CSS transform of its own.
 */
export function ControlBubble({ show, side, announce = false, style, children }: {
  show: boolean;
  side: 'above' | 'below';
  announce?: boolean;
  style?: CSSProperties;
  children: ReactNode;
}) {
  const above = side === 'above';
  const travel = above ? 6 : -6;
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="control-bubble"
          {...(announce ? { role: 'status', 'aria-live': 'polite' as const } : { 'aria-hidden': true })}
          style={{ ...bubble, ...(above ? { bottom: '100%', marginBottom: GAP } : { top: '100%', marginTop: GAP }), ...style }}
          {...presence('surface.arrive', { opacity: 0, y: travel, scale: 0.9 }, { hold: { x: '-50%' }, leave: 'surface.leave' })}
        >
          {children}
          <span
            style={{ ...tail, ...(above ? { bottom: -5, borderTop: 'none', borderLeft: 'none' } : { top: -5, borderBottom: 'none', borderRight: 'none' }) }}
            aria-hidden
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const layer: CSSProperties = { position: 'fixed', inset: 0, zIndex: z.heldName, pointerEvents: 'none' };

/**
 * The same word hung from `anchor` on the window's floating layer rather than inside the control, so
 * no clipping or scrolling ancestor cuts it. It is placed by `useFloatingPosition` on `side` where
 * that side has room, and draws at the chrome's touch lift on the `heldName` rung, above any window
 * that holds the control. A pictured subtree hangs it in place.
 */
export function FloatingControlBubble({ show, side, anchor, children }: {
  show: boolean;
  side: 'above' | 'below';
  anchor: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const { zoom, weights } = useChromeLift(TOUCH_TARGET);
  const pictured = useUiPreview();
  const { ref, piece, placement, style } = useFloatingPosition({ open: show && !pictured, anchor, zoom, gap: GAP, align: 'center', prefer: side });
  // The full-window layer stands only while the bubble shows or leaves.
  const [present, setPresent] = useState(show);
  if (show && !present) setPresent(true);
  if (pictured || typeof document === 'undefined') return <ControlBubble show={show} side={side}>{children}</ControlBubble>;
  if (!present) return null;
  const above = placement ? placement.above : side === 'above';
  // The tail aims at the control's centre, which a window edge may have pushed off the bubble's
  // centre, and stays clear of the rounded corners.
  const inset = radii.md + TAIL_HALF;
  const tailLeft = placement ? `clamp(${inset}px, ${placement.anchorX}px, calc(100% - ${inset}px))` : '50%';
  return createPortal(
    <div style={{ ...layer, zoom, ...weights }}>
      <AnimatePresence onExitComplete={() => setPresent(false)}>
        {show && (
          <motion.div
            key="control-bubble"
            ref={ref}
            {...piece}
            aria-hidden
            // A long word wraps within the window's width rather than running off it.
            style={{ ...face, whiteSpace: 'normal', overflowWrap: 'break-word', ...style }}
            {...presence('surface.arrive', { opacity: 0, y: above ? 6 : -6, scale: 0.9 }, { leave: 'surface.leave' })}
          >
            {children}
            <span
              style={{ ...tail, left: tailLeft, ...(above ? { bottom: -5, borderTop: 'none', borderLeft: 'none' } : { top: -5, borderBottom: 'none', borderRight: 'none' }) }}
              aria-hidden
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>,
    document.body,
  );
}
