/*
 * row-scroll.ts — how a shelf row that travels sideways is moved: what one wheel event does to it,
 * what its pixels are worth against the page's, and how something inside it is brought back.
 *
 * The object shelf has two such rows, one above the other: the category names and the item cards.
 * They answer the wheel by the SAME rule, which is the reason this is one module rather than a
 * behaviour copied into the second row. Two rows a pointer can be over, moved by one gesture, have
 * to travel the same way per notch; two that answered it differently would be the confusing thing.
 */
import { MOTIONS } from '../motion/registry';

/**
 * What one wheel event does to a row, or null where the browser scrolls it itself.
 *
 * A VERTICAL NOTCH GLIDES, THE WAY THE SIDEWAYS AXIS ALREADY DOES. This row's horizontal scroll is
 * the browser's own, and on a mouse with smooth scrolling the browser glides it — so a vertical
 * notch handed straight to `scrollLeft` was the one stepped movement on a surface where everything
 * else arrived, and the two rolls of one wheel felt like different controls. Two things made a
 * glide read as lag, and `wheelGlider` answers both: aiming FROM THE ROW'S CURRENT POSITION (rapid
 * notches each re-aimed one step past a row that had barely moved, so the notches now accumulate
 * against the TARGET), and the browser's smooth `scrollTo` itself, whose slow-start fixed-length
 * ease holds the row still for the first frames of every notch. The glider drives its own
 * exponential approach instead — the registry's `shelf.row.wheel-glide` — so the row moves on the
 * next frame after every notch, the way the browser's own axis does.
 *
 * A WHEEL REPORTS IN THE PAGE'S PIXELS AND THE ROW IS NOT DRAWN IN THEM. The shelf stands inside the
 * frame's `zoom` (`useFrameZoom` below), where one of the row's own pixels is bigger than one of the
 * page's, and `scrollLeft` counts the row's. So the browser scrolling a row from a horizontal wheel
 * moves it `delta / zoom`, and a vertical notch handed straight to `scrollLeft` moved it `delta` — a
 * quarter further per notch than the same notch sideways, at the shipped zoom. Measured over the two
 * axes, that overshoot was the whole of the difference between them: one wheel, one distance,
 * whichever way it is turned.
 */
export interface WheelPush {
  /** The row's own px along the row, positive to the right. */
  by: number;
}

/** A line of wheel travel, in the page's css px: what a `deltaMode` of LINE means. Chosen at a
 *  comfortable reading step rather than a text line, since what scrolls here is a row of tiles. */
const WHEEL_LINE = 40;

export function wheelPush(
  e: { deltaX: number; deltaY: number; deltaMode: number },
  page: number,
  zoom: number,
): WheelPush | null {
  // A sideways wheel or swipe is this container's own scroll and the browser is already doing it,
  // so only the DOWNWARD travel is turned here. It is the dominant direction that decides, not any
  // sideways travel at all: a trackpad's near-vertical swipe carries a pixel or two of drift, and
  // standing back from the whole gesture for it left the row moving by that drift alone.
  if (Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return null;
  // A PAGE is the row's own width, so it is already in the row's pixels; a line and a pixel are the
  // page's, and the frame's zoom comes back out of them.
  const by = e.deltaMode === 2
    ? e.deltaY * page
    : (e.deltaY * (e.deltaMode === 1 ? WHEEL_LINE : 1)) / zoom;
  if (by === 0) return null;
  return { by };
}

/** The glide's time constant in ms, from its registry declaration: the whole feel of the approach
 *  is that number, and a duration typed here would be the unfindable decision the registry exists
 *  to prevent. */
const GLIDE_TAU_MS = MOTIONS['shelf.row.wheel-glide'].duration * 1000;

/** Above this many frames' gap the clock is a returning background tab, not a frame: integrating
 *  the approach over it would teleport the row. */
const GLIDE_DT_CAP_MS = 64;

export interface WheelGlider {
  /** One notch: aim the target and drive toward it. Mid-glide the notches stack onto the TARGET
   *  rather than the position, which is what keeps a fast roll ahead of the row; `instant`
   *  (reduced motion) lands the same target at once. */
  wheel: (row: HTMLElement, by: number, instant: boolean) => void;
}

/** One per row (a component keeps it in a ref): the target and the run only mean something against
 *  the one element they were measured on. */
export function wheelGlider(): WheelGlider {
  let target: number | null = null;
  /** Where the glide last left the row, so its own movement can be told from a hand's. */
  let written = 0;
  let raf = 0;
  let at = 0;
  const stop = (): void => {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    target = null;
  };
  const drive = (row: HTMLElement): void => {
    raf = requestAnimationFrame((t) => {
      // The row moved under someone else's hand (the scrollbar, the browser's own sideways axis)
      // or left the document: the glide yields rather than fights.
      if (target == null || !row.isConnected || Math.abs(row.scrollLeft - written) > 2) {
        stop();
        return;
      }
      // Floored at zero: the first callback's timestamp is the FRAME's start, which can precede
      // the mid-frame `performance.now()` the run was stamped with. A negative dt turns the
      // approach factor negative — a step AWAY from the target, which at a row still at 0 cannot
      // stick and read as the clamped-edge stop: the glide died on its first notch.
      const dt = Math.max(0, Math.min(GLIDE_DT_CAP_MS, t - at));
      at = t;
      const left = target - row.scrollLeft;
      if (Math.abs(left) < 0.5) {
        row.scrollLeft = target;
        stop();
        return;
      }
      const before = row.scrollLeft;
      const step = left * (1 - Math.exp(-dt / GLIDE_TAU_MS));
      row.scrollLeft += step;
      // Read back after writing: the browser clamps and rounds `scrollLeft`, and the yield check
      // above must compare against what actually stuck.
      written = row.scrollLeft;
      // A step that did not stick is the browser's own stop: under a CSS `zoom` the real maximum
      // offset sits a couple of px short of `scrollWidth - clientWidth`, so a target at the
      // computed end is unreachable and driving at it would spin this loop forever — at ANY step
      // size, since a sub-px step near a clamped edge stays sub-px every frame after. `step !== 0`
      // spares the one innocent case, a same-timestamp frame, whose zero step proves nothing.
      if (step !== 0 && written === before) {
        stop();
        return;
      }
      drive(row);
    });
  };
  return {
    wheel(row, by, instant) {
      const base = raf && target != null ? target : row.scrollLeft;
      target = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, base + by));
      if (instant) {
        row.scrollLeft = target;
        stop();
        return;
      }
      if (!raf) {
        written = row.scrollLeft;
        at = performance.now();
        drive(row);
      }
    },
  };
}

/** What one of a shelf row's pixels is worth in the page's, which is what a wheel reports in:
 *  the frame's one live zoom. Re-exported so a row's wheel math and the frame can never divide
 *  by different factors. */
export { useFrameZoom } from '../use-frame-zoom';

/**
 * Put a control back inside the row that holds it.
 *
 * `nearest` is the whole of it: it moves nothing that is already in view, and it stops at the first
 * ancestor that can scroll, so a name brought back is not also a page scrolled out from under the
 * shelf. jsdom implements no scrolling at all, which is what the guard is for.
 */
export function reveal(el: HTMLElement | null | undefined): void {
  if (typeof el?.scrollIntoView === 'function') {
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
}
