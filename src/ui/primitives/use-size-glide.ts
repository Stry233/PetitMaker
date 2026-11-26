/**
 * Animates one box axis to its content's newly measured size on Web Animations, drawing the axis
 * and both its bounds together. Web Animations write no inline style, so the size and bounds React
 * gives the box stay its own, and cancelling a glide exposes the natural size again. It avoids Framer
 * layout projection because that projection does not account for the shell's CSS `zoom` and
 * temporarily scales children. Callers clip overflow while `gliding`; reduced motion applies the
 * target immediately.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { easingCss, seconds } from '../design/motion';
import type { MotionId } from '../design/motion/registry';
import { pageMorphCarrying } from './morph';

/** How far the box's natural size may have moved under a glide before the difference is travelled
 *  rather than taken, in css px. Under a pixel there is nothing to see. */
const SETTLE_PX = 1;

/** How many times a landing may set off again for a size that moved while it was travelling.
 *  Content that answers its own size would otherwise chase itself: two legs cover what actually
 *  happens (a font or an image arriving once, mid-flight) and the last one takes what it finds. */
const SETTLE_LEGS = 2;

export type GlideAxis = 'width' | 'height';

interface SizeGlideOptions {
  axis: GlideAxis;
  /** The registry motion the box travels on; card-sized surfaces use one that does not overshoot. */
  motionId: MotionId;
  /**
   * The value that means "the content is different now": an arrival's sequence number, a window's
   * chosen destination. Given, the box is measured whenever it changes and only then, and a size the
   * caller did not announce is simply the size the box has. Absent, every commit is measured.
   */
  change?: unknown;
  /** While true every size is taken at once. */
  disabled?: boolean;
  /** A new value takes the size it brings at once: the room around the box changed, not its content. */
  resetKey?: unknown;
}

interface SizeGlide<T extends HTMLElement> {
  /** Hang this on the box whose size should ease. */
  ref: RefObject<T>;
  /** Whether the box is travelling right now: what the caller clips on. */
  gliding: boolean;
}

/** One leg of travel toward `target`, the natural size measured when it set off. */
interface Leg { anim: Animation; target: number; legs: number }

const BOUNDS = {
  width: ['width', 'minWidth', 'maxWidth'],
  height: ['height', 'minHeight', 'maxHeight'],
} as const satisfies Record<GlideAxis, readonly string[]>;

function measure(el: HTMLElement, axis: GlideAxis): number {
  return axis === 'width' ? el.offsetWidth : el.offsetHeight;
}

/** One keyframe holding the axis and both its bounds at `px`, so the box's own bounds cannot cut the travel. */
function frame(axis: GlideAxis, px: number): Keyframe {
  return Object.fromEntries(BOUNDS[axis].map((prop) => [prop, `${px}px`]));
}

export function useSizeGlide<T extends HTMLElement = HTMLDivElement>(options: SizeGlideOptions): SizeGlide<T> {
  const { axis, motionId, disabled = false, resetKey } = options;
  const everyCommit = !('change' in options);
  const { change } = options;
  const ref = useRef<T>(null);
  /** The size the box settled at last, and what the next glide starts from. Zero means there is
   *  nothing to glide from: a surface arriving takes its own size. */
  const rest = useRef(0);
  /** The element that size was measured on, and its observer. A caller whose box unmounts and comes
   *  back (a modal card between opens) hands over a new element with nothing to glide from. */
  const box = useRef<{ el: T; axis: GlideAxis; observer: ResizeObserver | null } | null>(null);
  const flight = useRef<Leg | null>(null);
  /** The inputs the box was last measured under, for a caller that announces its changes. */
  const heard = useRef<readonly unknown[] | null>(null);
  const room = useRef(resetKey);
  const [gliding, setGliding] = useState(false);
  const shown = useRef(false);
  // `null` is Framer's "nobody has said", which is not a request for less.
  const reduced = useReducedMotionConfig() === true;

  useLayoutEffect(() => {
    const el = ref.current;
    const show = (next: boolean) => {
      if (shown.current === next) return;
      shown.current = next;
      setGliding(next);
    };
    if (box.current && (box.current.el !== el || box.current.axis !== axis)) {
      flight.current?.anim.cancel();
      flight.current = null;
      box.current.observer?.disconnect();
      box.current = null;
      rest.current = 0;
      heard.current = null;
      show(false);
    }
    if (!el) return;
    if (!box.current) {
      // Fonts and images can change the resting size without changing the caller's state.
      const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => {
        if (!flight.current) rest.current = measure(el, axis);
      });
      observer?.observe(el);
      box.current = { el, axis, observer };
    }
    const inputs = [change, motionId, reduced, disabled, resetKey];
    if (!everyCommit && heard.current?.every((value, i) => Object.is(value, inputs[i]))) return;
    heard.current = inputs;
    // A change the chrome's morph carries lands at once: the morph draws the box from its old place.
    const reset = !Object.is(room.current, resetKey) || pageMorphCarrying();
    room.current = resetKey;

    const fly = (from: number, to: number, legs: number) => {
      const anim = el.animate([frame(axis, from), frame(axis, to)], { duration: seconds(motionId) * 1000, easing: easingCss(motionId) });
      const leg: Leg = { anim, target: to, legs };
      flight.current = leg;
      /**
       * It lands on what the box is, not on what it was aimed at. The target was measured when the
       * glide was planned, and the content can settle under it while it flies (a web font arriving,
       * an image decoding, a line finishing its crossfade); the finished animation hands the box its
       * natural size before the frame paints, so whatever is left of the distance is travelled.
       */
      anim.onfinish = () => {
        if (flight.current !== leg) return;
        flight.current = null;
        const settled = measure(el, axis);
        rest.current = settled;
        if (leg.legs < SETTLE_LEGS && Math.abs(settled - leg.target) >= SETTLE_PX) fly(leg.target, settled, leg.legs + 1);
        else show(false);
      };
      show(true);
    };

    const live = flight.current;
    const running = live?.anim.playState === 'running';
    const time = live?.anim.currentTime ?? null;
    // Where the box stands drawn now: mid-glide that is the glide's own size.
    const from = live ? (running ? measure(el, axis) : live.target) : rest.current;
    // Cancelling exposes the new natural size under the box's current bounds.
    live?.anim.cancel();
    const to = measure(el, axis);
    const still = disabled || reduced || reset || typeof el.animate !== 'function';
    if (live && running && Math.abs(to - live.target) < SETTLE_PX && !still) {
      live.anim.play();
      live.anim.currentTime = time;
      return;
    }
    flight.current = null;
    rest.current = to;
    if (!from || Math.abs(to - from) < SETTLE_PX || still) { show(false); return; }
    fly(from, to, 1);
  });

  useLayoutEffect(() => () => {
    flight.current?.anim.cancel();
    flight.current = null;
    box.current?.observer?.disconnect();
    box.current = null;
  }, []);

  return { ref, gliding };
}
