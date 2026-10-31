/**
 * The ring that fills by each still finger while its hold is under way (`gesture-channel.ts:holdPresses`).
 * On the map it rings the fingertip until the menu opens. On a control that a hold lifts, such as an
 * object shelf card, it stands above the fingertip, where the finger does not cover it, until the
 * card lifts. It fills over the hold time and goes when the press resolves. Under reduced motion it
 * stands full. No part of it takes pointer input.
 */
import { useSyncExternalStore } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { holdPresses, onHoldPressChange, type HoldPress } from '../../../view/interaction/pointer/gesture-channel';
import { z } from '../../design/styles';
import { ACTIVE, inkTint } from '../../design/tokens';
import { framerMotion } from '../../design/motion';
import { useViewportSize } from '../../design/scale';

/** The ring's outer size and stroke, in layout px. */
const RING = { size: 56, stroke: 6 } as const;
const RING_R = (RING.size - RING.stroke) / 2;
/** The shade under the fingertip the map's ring fills around, 4px inside the stroke. */
const PAD = RING.size - 2 * RING.stroke - 8;
/** How far a control's ring's lower edge stands above the contact point, in layout px: it clears a
 *  fingertip's pad by about a centimetre. */
const FINGER_CLEARANCE = 33;
/** How far above the fingertip a control's ring stands, centre to contact point, in layout px. */
const ABOVE = RING.size / 2 + FINGER_CLEARANCE;

export function HoldRing() {
  const presses = useSyncExternalStore(onHoldPressChange, holdPresses);
  const reduced = useReducedMotionConfig();
  return <>{presses.map((press) => <Ring key={press.id} press={press} reduced={reduced} />)}</>;
}

function Ring({ press, reduced }: { press: HoldPress; reduced: boolean | null }) {
  const onMap = press.place === 'map';
  // A control's ring stays inside the window's top, left and right edges, even for a card pressed
  // near one.
  const half = RING.size / 2;
  const windowW = useViewportSize().w;
  const cx = onMap ? press.x : Math.min(Math.max(half, press.x), windowW - half);
  const cy = onMap ? press.y : Math.max(half, press.y - ABOVE);
  return (
    <div
      aria-hidden
      data-testid="press-hold"
      data-place={press.place}
      style={{
        position: 'fixed', left: cx - half, top: cy - half, width: RING.size, height: RING.size,
        pointerEvents: 'none', zIndex: onMap ? z.canvasControls : z.heldName,
      }}
    >
      {onMap && <span style={{ position: 'absolute', left: (RING.size - PAD) / 2, top: (RING.size - PAD) / 2, width: PAD, height: PAD, borderRadius: '50%', background: inkTint(0.18) }} />}
      <svg width={RING.size} height={RING.size} viewBox={`0 0 ${RING.size} ${RING.size}`} style={{ position: 'absolute', inset: 0, transform: 'rotate(-90deg)' }}>
        <motion.circle
          cx={RING.size / 2} cy={RING.size / 2} r={RING_R} fill="none" stroke={ACTIVE} strokeWidth={RING.stroke} strokeLinecap="round"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={framerMotion('press.hold', reduced)}
        />
      </svg>
    </div>
  );
}
