/*
 * caption.tsx — the help figures' own two recurring marks: a plated label over the picture, and
 * the pulse that says "the pictured cursor pressed here". Both are built from the shared design
 * tokens rather than redrawn per figure, so every figure's plate and pulse are the same ink.
 */
import type { CSSProperties } from 'react';
import { withAlpha } from '../../../../design/styles';
import { FOCUS_RING, PLATE, PLATE_INK } from '../../../../design/tokens';
import { radii, shadows } from '../../../../design/styles';
import { roleFont, type TextRole } from '../../../../design/text-weight';
import { isMotionReduced } from '../../../../../canvas/map2d/motion-state';

/** A figure's own plated label: the house plate, at whatever role and padding the figure needs.
 *  `alpha` under 1 lets a narration caption sit translucent over the picture it annotates;
 *  omitted, the plate is opaque (a name plate standing on its own, not over live content). */
export function figureCaption(opts: {
  role: TextRole;
  padding: string;
  ink?: string;
  alpha?: number;
  shadow?: boolean;
  maxWidth?: string;
  nowrap?: boolean;
}): CSSProperties {
  return {
    ...roleFont(opts.role),
    color: opts.ink ?? PLATE_INK,
    background: opts.alpha === undefined ? PLATE : withAlpha(PLATE, opts.alpha),
    borderRadius: radii.pill,
    padding: opts.padding,
    ...(opts.maxWidth !== undefined ? { maxWidth: opts.maxWidth } : {}),
    ...(opts.nowrap ? { whiteSpace: 'nowrap' as const } : {}),
    ...(opts.shadow ? { boxShadow: shadows.s1 } : {}),
  };
}

/** The pulse ring's own face, position and size aside: a figure places it. */
export const pressPulseFace: CSSProperties = {
  width: 30,
  height: 30,
  borderRadius: '50%',
  border: `3px solid ${FOCUS_RING}`,
  opacity: 0,
  transform: 'translate(-50%, -50%)',
  pointerEvents: 'none',
};

const PRESS_PULSE_KEYFRAMES: Keyframe[] = [
  { opacity: 0.9, transform: 'translate(-50%, -50%) scale(0.4)' },
  { opacity: 0, transform: 'translate(-50%, -50%) scale(1.6)' },
];

/** Plays the bloom on an already-mounted element: the one animation both a scripted press
 *  (HelpDemo's own imperative cursor) and a mounted mark (`PressPulse` below) fire. */
export function firePressPulse(el: HTMLElement, opts?: { repeat?: boolean }): void {
  if (typeof el.animate !== 'function') return;
  el.animate(PRESS_PULSE_KEYFRAMES, { duration: 420, easing: 'ease-out', iterations: opts?.repeat ? Infinity : 1 });
}

/** A mounted press mark, centred on `x, y`: one bloom by default, or a standing attention pulse
 *  with `repeat`. Reduced motion drops the play but leaves the ring undrawn (opacity starts at 0
 *  and nothing ever raises it), which is a cut rather than a stray static ring. */
export function PressPulse({ x, y, repeat }: { x: number; y: number; repeat?: boolean }) {
  const bloom = (el: HTMLSpanElement | null) => {
    if (!el || isMotionReduced()) return;
    firePressPulse(el, { repeat });
  };
  return <span ref={bloom} style={{ position: 'absolute', left: x, top: y, ...pressPulseFace }} />;
}
