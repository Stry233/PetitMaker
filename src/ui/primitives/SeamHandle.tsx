/**
 * A grip on a horizontal seam that a drag moves up or down, with a seam line across it while held. Its
 * owner hears each move past the pointer's drag threshold (`onDrag`, to resize live) and the drag once
 * more on release (`onRelease`, to settle it); a handle whose owner moves it with the seam (`follows`)
 * does not move itself. A press within the threshold moves nothing, and the arrow keys step it.
 * A finger's hit area grows past the strip (`reach`) or, where the strip's own sides are taken, past
 * its grip (`gripReach`). Placement and what a depth means are the owner's.
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { easingCss, seconds } from '../design/motion';
import type { MotionId } from '../design/motion/registry';
import { clientPoint } from '../../platform/device/viewport-space';
import { timingFor, travelledPast } from '../../platform/input/gesture-timing';
import { radii } from '../design/styles';
import { inkTint, ON_DARK, PANEL_EDGE, rgbaOf } from '../design/tokens';
import { TouchReach, type ReachSides } from './TouchReach';
import { useMorph } from './morph';

/** The handle's strip and the grip drawn in it, in its own px. */
export const SEAM_HANDLE = { h: 24, grip: { w: 40, h: 5 } } as const;

/** The grip's ink: the hairline family, a little heavier so it reads as something to hold, and the
 *  same weight of the light ink on a dark plate. */
const GRIP_INK = { light: inkTint(0.2), dark: rgbaOf(ON_DARK, 0.35) } as const;

export function SeamHandle({
  label, zoom, value, clamp, onDrag, onRelease, onStep, follows = false, style, reach = { top: false }, gripReach, plate = 'light', testId, morph, arrive,
}: {
  /** The separator's accessible name. */
  label: string;
  /** Visual px per own px, which a drag in visual px is drawn at. */
  zoom: number;
  /** What the seam's position reads as, for assistive technology. */
  value: { now: number; min: number; max: number };
  /** Keeps a drag of `dy` visual px (down positive) within where the seam may stand. */
  clamp: (dy: number) => number;
  /** Each move of a drag past its pointer's drag threshold, `dy` visual px down and clamped; null once
   *  the drag ends, after `onRelease`. */
  onDrag?: (dy: number | null) => void;
  /** A drag let go past its pointer's drag threshold, `dy` visual px down, clamped and not zero. */
  onRelease: (dy: number) => void;
  /** The owner moves the handle with the seam it resizes, so the handle draws no travel of its own. */
  follows?: boolean;
  /** An arrow key: -1 up, 1 down. */
  onStep: (direction: -1 | 1) => void;
  /** Where the strip stands; it is `SEAM_HANDLE.h` tall. */
  style: CSSProperties;
  /** Which sides the strip's fingertip reach may grow past; by default down into the plate under the
   *  seam only, never up over the map above it. Null grows none. */
  reach?: Partial<ReachSides> | null;
  /** Which sides a finger's reach around the grip may grow past, for a strip whose own reach would
   *  cover what stands beside it (`reach: null`); none by default. */
  gripReach?: Partial<ReachSides>;
  /** The plate the grip is drawn on. */
  plate?: 'light' | 'dark';
  testId?: string;
  /** Its piece id where it stands alone in one arrangement of a re-arranging frame (`morph.ts:useMorph`). */
  morph?: string;
  /** The fade it arrives on as it mounts, where it shows up once its seam has formed. */
  arrive?: MotionId;
}) {
  // A strip as wide as the window: it takes each box exactly, its grip too small to show the stretch.
  const marked = useMorph(morph ?? '', 'fill');
  // `travelled` turns true once the press passes its pointer's drag threshold, and stays so.
  const grab = useRef<{ id: number; y: number; travelled: boolean } | null>(null);
  // Whether something holds the seam: React hears only the press and the let-go, and a handle that
  // draws its own travel writes it to its element on each move.
  const [held, setHeld] = useState(false);
  const self = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotionConfig() === true;
  // Only its mount arrives; a change of motion setting later has nothing to fade.
  const arrival = useRef(arrive && !reduced ? arrive : null);
  useLayoutEffect(() => {
    const motion = arrival.current;
    if (motion) self.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: seconds(motion) * 1000, easing: easingCss(motion) });
  }, []);
  const travel = (dy: number | null) => {
    if (!follows && self.current) self.current.style.transform = dy === null ? '' : `translateY(${dy / zoom}px)`;
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    grab.current = { id: e.pointerId, y: clientPoint(e).y, travelled: false };
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setHeld(true);
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const grip = grab.current;
    if (!grip || grip.id !== e.pointerId) return;
    const dy = clientPoint(e).y - grip.y;
    // Within the drag threshold the seam stays put, so a jittering tap never shows a move it will not make.
    if (!grip.travelled && !travelledPast(0, dy, timingFor(e).dragThreshold)) return;
    grip.travelled = true;
    const kept = clamp(dy);
    travel(kept);
    onDrag?.(kept);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const grip = grab.current;
    if (!grip || grip.id !== e.pointerId) return;
    grab.current = null;
    setHeld(false);
    travel(null);
    const moved = clientPoint(e).y - grip.y;
    if (grip.travelled || travelledPast(0, moved, timingFor(e).dragThreshold)) {
      const dy = clamp(moved);
      if (dy !== 0) onRelease(dy);
    }
    if (grip.travelled) onDrag?.(null);
  };
  const cancel = () => {
    if (grab.current?.travelled) onDrag?.(null);
    grab.current = null;
    setHeld(false);
    travel(null);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    e.preventDefault();
    onStep(e.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={label}
      aria-valuemin={value.min}
      aria-valuemax={value.max}
      aria-valuenow={value.now}
      ref={self}
      tabIndex={0}
      data-testid={testId}
      {...(morph ? marked : {})}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={key}
      style={{
        ...style,
        height: SEAM_HANDLE.h, boxSizing: 'border-box',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        touchAction: 'none',
        ...(held ? { borderTop: PANEL_EDGE } : null),
      }}
    >
      <span
        aria-hidden
        style={{ position: 'relative', width: SEAM_HANDLE.grip.w, height: SEAM_HANDLE.grip.h, borderRadius: radii.pill, background: GRIP_INK[plate] }}
      >
        {gripReach ? <TouchReach w={SEAM_HANDLE.grip.w} h={SEAM_HANDLE.grip.h} zoom={zoom} sides={gripReach} /> : null}
      </span>
      {reach ? <TouchReach h={SEAM_HANDLE.h} zoom={zoom} sides={reach} /> : null}
    </div>
  );
}
