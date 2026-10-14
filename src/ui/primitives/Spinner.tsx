/**
 * The circular loading indicator for tight spaces (badges, chips, small squares) where the
 * three-dot LoadingDots does not fit; roomy contexts (buttons, chat, panels) use LoadingDots.
 *
 * Uses the global `spin` keyframes from animations.css. Size/colors are plain
 * CSS px: modal chrome is css-zoomed already, and design-px callers pass their
 * own px(...) value.
 */
import { seconds, easingCss } from '../design/motion';
import type { CSSProperties } from 'react';
import { ACTIVE, inkTint } from '../design/tokens';

interface SpinnerProps {
  /** Outer diameter in CSS px (pre-zoom). */
  size?: number;
  /** Arc color (the moving part). */
  color?: string;
  /** Ring color (the static track). */
  trackColor?: string;
  thickness?: number;
}

export function Spinner({ size = 30, color = ACTIVE, trackColor = inkTint(0.15), thickness }: SpinnerProps) {
  const border = thickness ?? Math.max(2, Math.round(size * 0.13));
  const style: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: '50%',
    border: `${border}px solid ${trackColor}`,
    borderTopColor: color,
    animation: `spin ${seconds('loading.spinner')}s ${easingCss('loading.spinner')} infinite`,
  };
  // `pw-busy` opts out of the reduced-motion catch-all in animations.css: this is progress feedback,
  // not decoration, and a frozen spinner reads as a hung UI.
  return <div aria-hidden className="pw-busy" style={style} />;
}
