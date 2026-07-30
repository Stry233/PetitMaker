/**
 * Spinner — the ONE circular loading indicator, for TIGHT spaces (badges,
 * chips, small squares) where the three-dot LoadingDots doesn't fit. Roomy
 * contexts (buttons, chat, panels) use ui/menu/LoadingDots instead — keep it
 * to these two; don't hand-roll loaders inline.
 *
 * Uses the global `spin` keyframes from animations.css. Size/colors are plain
 * CSS px: modal chrome is css-zoomed already, and design-px callers pass their
 * own px(...) value.
 */
import type { CSSProperties } from 'react';
import { colors, inkTint } from './styles';

export interface SpinnerProps {
  /** Outer diameter in CSS px (pre-zoom). */
  size?: number;
  /** Arc color (the moving part). */
  color?: string;
  /** Ring color (the static track). */
  trackColor?: string;
  thickness?: number;
}

export function Spinner({ size = 30, color = colors.tileYellow, trackColor = inkTint(0.15), thickness }: SpinnerProps) {
  const border = thickness ?? Math.max(2, Math.round(size * 0.13));
  const style: CSSProperties = {
    width: size,
    height: size,
    flexShrink: 0,
    borderRadius: '50%',
    border: `${border}px solid ${trackColor}`,
    borderTopColor: color,
    animation: 'spin .85s linear infinite',
  };
  // `pw-busy` opts out of the reduced-motion catch-all in animations.css: this is progress feedback,
  // not decoration, and a frozen spinner reads as a hung UI.
  return <div aria-hidden className="pw-busy" style={style} />;
}
