/**
 * Ease an element's box to whatever its content has just made it.
 *
 * For a surface whose CONTENT changes in place: a greeting whose words and picture are replaced by
 * another arrival's, a window that grows a row when there is something to ask. The change itself is
 * what carries the information; the box arriving at its new size in one frame is the part that reads
 * as a fault, and this is the only thing that moves.
 *
 * IMPERATIVE, NOT `layout`. Framer's layout animation measures in real px (`getBoundingClientRect`)
 * and writes transforms in the element's own coordinate space. Every surface here is drawn inside a
 * CSS `zoom` — the chrome scale — which Framer does not read, so its correction would be out by that
 * factor on every monitor but the one where the scale happens to be 1. Layout projection also scales
 * children for the length of the animation, which is exactly the mid-glide reflow a caller reaches
 * for this to avoid. So the size is measured and sprung by hand, and nothing else about the element
 * is touched: the caller's own enter/exit motion (opacity, scale, y) composes with it untouched.
 *
 * NOTHING EVER LEAVES AN INLINE SIZE BEHIND, which is what keeps the measurement honest: the natural
 * size is read straight off the element on every change, so a glide can never head for a stale
 * target, and a change landing mid-glide takes over from where the box actually stands.
 *
 * ONE AXIS AT A TIME, because that is what the surfaces need and because two would need either two
 * springs or one clock driving both, and no caller has asked which.
 *
 * WHAT THE CALLER OWES IT: clip the box while `gliding` (it is briefly smaller or larger than what
 * stands in it) and keep the content from re-laying itself out inside — for a row, children that do
 * not shrink. Reduced motion is handled here: the new size is taken outright, since the change has
 * already said what it had to say.
 *
 * NOT THE SAME THING AS `ModalShell`'s `motionSize`, which morphs a card BETWEEN two views whose
 * sizes the consumer already knows. This is for content that changes where it stands and a size
 * nobody can name in advance.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { animate, useReducedMotionConfig, type AnimationPlaybackControls, type Transition } from 'framer-motion';
import { springs } from '../design/styles';

/** How far the box's natural size may have moved under a glide before the difference is travelled
 *  rather than taken, in css px. Under a pixel there is nothing to see. */
const SETTLE_PX = 1;

/** How many times a landing may set off again for a size that moved while it was travelling.
 *  Content that answers its own size would otherwise chase itself: two legs cover what actually
 *  happens (a font or an image arriving once, mid-flight) and the last one takes what it finds. */
const SETTLE_LEGS = 2;

export type GlideAxis = 'width' | 'height';

export interface SizeGlideOptions {
  axis: GlideAxis;
  /**
   * How the box travels. `springs.gentle` by default rather than a bouncier one: a box that
   * overshoots its own size shows, for the length of the overshoot, a surface bigger than anything
   * in it. A CARD-sized traveller should pass the modal family's own tween (`SIZE_MORPH_TWEEN`),
   * whose comment has the rest of that argument.
   */
  transition?: Transition;
}

export interface SizeGlide<T extends HTMLElement> {
  /** Hang this on the box whose size should ease. */
  ref: RefObject<T>;
  /** Whether the box is travelling right now: what the caller clips on. */
  gliding: boolean;
}

/**
 * `change` is the value that means "the content is different now" — an arrival's sequence number, a
 * window's chosen destination. The box is measured whenever it changes, and only then: a size the
 * caller did not announce is simply the size the box has.
 */
export function useSizeGlide<T extends HTMLElement = HTMLDivElement>(
  change: unknown,
  { axis, transition = springs.gentle }: SizeGlideOptions,
): SizeGlide<T> {
  const ref = useRef<T>(null);
  /** The size the box settled at last, and what the next glide starts from. Zero means there is
   *  nothing to glide from: a surface arriving takes its own size. */
  const rest = useRef(0);
  /** The element that size was measured on. A caller whose box unmounts and comes back (a modal
   *  card between opens) hands over a NEW element with nothing to glide from, and an effect that
   *  runs on the caller's change alone can only notice at its next run. */
  const restEl = useRef<T | null>(null);
  const [gliding, setGliding] = useState(false);
  // `null` is Framer's "nobody has said", which is not a request for less.
  const reduced = useReducedMotionConfig() === true;

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { rest.current = 0; restEl.current = null; return undefined; }
    if (restEl.current !== el) { rest.current = 0; restEl.current = el; }
    const measure = () => (axis === 'width' ? el.offsetWidth : el.offsetHeight);
    const from = rest.current;
    const to = measure();
    rest.current = to;
    if (!from || from === to || reduced) return undefined;
    let travelling = true;
    let legs = 0;
    let glide: AnimationPlaybackControls | null = null;
    const run = (a: number, b: number) => {
      legs += 1;
      const leg = animate(a, b, {
        ...transition,
        onUpdate: (v: number) => { el.style[axis] = `${v}px`; },
      });
      glide = leg;
      void leg.then(() => land(b));
    };
    /**
     * The end of the travel, and the one place the inline size comes off.
     *
     * IT LANDS ON WHAT THE BOX IS, NOT ON WHAT IT WAS AIMED AT. The target was measured when the
     * glide was planned, and the content can settle under it while it flies — a web font arriving,
     * an image decoding, a line finishing its crossfade. Clearing the inline size then hands the
     * box a size it never travelled to, in one frame, which is the step this hook exists to remove.
     * So the natural size is read again here and whatever is left of the distance is travelled.
     */
    const land = (target: number) => {
      if (!travelling) return;
      el.style[axis] = '';
      const settled = measure();
      rest.current = settled;
      if (legs < SETTLE_LEGS && Math.abs(settled - target) >= SETTLE_PX) {
        // Back to where the travel ended before anything is painted: this runs inside the frame the
        // glide finished on, so the natural size above was measured and never shown.
        el.style[axis] = `${target}px`;
        run(target, settled);
        return;
      }
      travelling = false;
      setGliding(false);
    };
    setGliding(true);
    run(from, to);
    return () => {
      // ONLY A GLIDE STILL IN FLIGHT IS INTERRUPTED HERE. This cleanup runs on every later change,
      // long after the box landed, and the DOM it would measure then is the change's own NEW
      // content — so re-measuring unconditionally records the size the next glide is meant to
      // travel TO as the size it starts FROM, and that change snaps. It alternated: a change after
      // a glide snapped, the change after that (whose run registered no cleanup) glided again.
      if (!travelling) return;
      rest.current = measure(); // where the box actually stands, not where it was headed
      travelling = false;
      glide?.stop();
      el.style[axis] = '';
      setGliding(false);
    };
    // `transition` is a caller's constant, not a reason to re-measure: a fresh object literal each
    // render would restart the glide on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [change, axis, reduced]);

  return { ref, gliding };
}
