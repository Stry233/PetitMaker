/**
 * The circular loading indicator for tight spaces (badges, chips, small squares) where the
 * three-dot LoadingDots does not fit; roomy contexts (buttons, chat, panels) use LoadingDots.
 *
 * A round-capped arc turning on its track, as the Regional load disc draws its reading
 * (`shell/controls/LoadMeter.tsx`), the whole ring inside `size`. Uses the global `spin` keyframes
 * from animations.css. Size and colours are plain CSS px: modal chrome is css-zoomed already, and
 * design-px callers pass their own px(...) value.
 */
import { cssAnimation } from '../design/motion';
import { ACTIVE, inkTint } from '../design/tokens';

interface SpinnerProps {
  /** Outer diameter in CSS px (pre-zoom), the ring included. */
  size?: number;
  /** Arc color (the moving part). */
  color?: string;
  /** Ring color (the static track). */
  trackColor?: string;
}

/** The drawing's own box, 100 units across. */
const BOX = 100;
/** The ring's width, a share of the diameter: three quarters of the Regional load disc's band (0.3),
 *  so small and large spinners keep one weight. */
const RING = 0.225 * BOX;
const RADIUS = (BOX - RING) / 2;
const TURN = 2 * Math.PI * RADIUS;
/** The arc spans a quarter of the ring, its round caps included. */
const ARC = TURN / 4 - RING;

export function Spinner({ size = 38, color = ACTIVE, trackColor = inkTint(0.15) }: SpinnerProps) {
  // `pw-busy` opts out of the reduced-motion catch-all in animations.css: this is progress feedback,
  // not decoration, and a frozen spinner reads as a hung UI.
  return (
    <svg aria-hidden className="pw-busy" width={size} height={size} viewBox={`0 0 ${BOX} ${BOX}`}
      style={{ display: 'block', flexShrink: 0, animation: cssAnimation('loading.spinner', 'spin') }}>
      <circle cx={BOX / 2} cy={BOX / 2} r={RADIUS} fill="none" stroke={trackColor} strokeWidth={RING} />
      <circle cx={BOX / 2} cy={BOX / 2} r={RADIUS} fill="none" stroke={color} strokeWidth={RING}
        strokeLinecap="round" strokeDasharray={`${ARC} ${TURN}`} />
    </svg>
  );
}
