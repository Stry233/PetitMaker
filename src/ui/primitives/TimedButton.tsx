/*
 * TimedButton.tsx — a button that presses itself, and says so while it counts.
 *
 * For a DEFAULT: an action a visitor would almost always take, offered rather than performed, and
 * taken for them if they say nothing. The countdown is the offer's honesty — it is the only warning
 * that something is about to happen without a hand on it, so it is drawn rather than merely timed.
 *
 * THE COUNTDOWN IS THE BUTTON'S OWN OUTLINE. It runs around the shape the button already is, taken
 * from the button rather than assumed: the corner comes off the rendered element's computed radius,
 * so a pill's outline and a circle's are one path at different radii and a caller never declares a
 * shape. A separate bar beside the button would be a second control to read.
 *
 * A DRAWING THE HOST ALREADY MAKES BEATS THE OUTLINE. Where the button is a picture rather than a
 * chip, an outline hugging it is a shape that interface draws nowhere else; the `stadium` clock is
 * the mark a shelf's row of names puts under the chosen name, standing under the button and
 * shortening. Same clock, same pauses, same press — only the path is different.
 *
 * IT DEPLETES. The outline starts whole and is spent down to nothing, which is a FUSE and not a
 * loading bar. A filling track is progress being made toward something and invites waiting; what is
 * actually happening here is the opposite, a chance to choose running out before the default takes
 * it. EMPTY MEANS FIRED, exactly: the same rAF tick that finds the clock spent draws the outline
 * away and clicks, so there is no frame where a stub is still on screen and no frame where the ring
 * has gone and nothing has happened. Two clocks would disagree by a frame or two and that is what
 * the disagreement would look like. Nothing redraws it while it is held, so a pointer arriving
 * stops the outline where it stands, which is how the pause is discovered rather than trusted.
 *
 * IT IS INTERRUPTIBLE, AND THAT IS THE WHOLE OF WHETHER IT IS USABLE. A control that fires while
 * someone is still reading defeats whatever it was attached to:
 *
 *   POINTER OVER IT — pauses, and resumes on leave. A pointer resting on a control is someone
 *     deciding; it is also ambiguous (a pointer crosses things), so it holds the clock rather than
 *     stopping it.
 *   THE HOST'S OWN EVIDENCE (`paused`) — the same, for a surface that knows better than the button
 *     does. The reading happens over the notice, not over its dismiss.
 *   KEYBOARD FOCUS — CANCELS, for good. Focus is not ambiguous: someone has put the keyboard on
 *     this control and is about to choose, and a control that chooses for them under their hands is
 *     worse than one that never fires at all. There is no way back into the countdown, which is the
 *     point: the offer has been declined by being considered.
 *   A HIDDEN TAB — pauses, for free. The clock is a rAF loop and a background tab does not raise
 *     frames, so time a visitor was not present for is not counted against them.
 *
 * COMPLETION IS A REAL PRESS. It calls `click()` on the element, so the browser runs the same path
 * a finger does — the handler, the focus and active states, anything listening above it. Calling
 * the handler directly would be a second way to press this button, and two ways diverge.
 *
 * WHICH LEAVES ONE THING ONLY THIS BUTTON KNOWS: whether the press that just happened was the
 * clock's or a hand's. Nothing in the event says so, and a host must not have to guess from its
 * internals, so `onPress` is TOLD (`byClock`). Most callers ignore it, and should: the whole point
 * of a default is that the two mean the same thing (the restore offer resumes either way). A caller
 * reads it only where the press carries a SECOND meaning that belongs to the hand alone — the
 * arrival notice answers the saved-session offer standing beside it when someone presses OK, and a
 * countdown running out is not somebody answering anything.
 *
 * REDUCED MOTION KEEPS IT. The ring is not decoration: it is the warning. What changes is how it is
 * drawn — a continuous sweep is motion, so under the preference the ring steps once a second, which
 * carries the same fact without anything gliding.
 *
 * ── AND ONE MODE WHERE THE CLOCK IS SOMEBODY ELSE'S (`external`) ──────────────────────────────
 *
 * Where the countdown belongs to a PROCESS rather than to the offer — a retry backoff a loop is
 * already running, whose length it recomputes per attempt — the button draws that clock instead of
 * keeping one. The caller hands in the fraction spent and the drawing is the same fuse: whole,
 * spent to nothing, EMPTY MEANS FIRED, and at empty the pill flashes lit for the beat the loop
 * takes to relight it.
 *
 * EVERY INTERRUPTION ABOVE IS DELIBERATELY INVERTED HERE, and that is the whole reason the mode is
 * a mode. The pointer does not pause, focus does not cancel, and the button never presses itself:
 * the loop retries whether a hand is resting on the pill or not, so a ring that paused under the
 * pointer would be a drawing of something that is not happening. The press this button still
 * carries is a hand's — retry NOW, ahead of the clock — and the clock is not the button's to stop.
 *
 * AND THE FUSE RUNS BETWEEN THE CALLER'S SAMPLES. A process clock is sampled at whatever rate its
 * owner repaints — a retry face reads its backoff once a second — and a ring redrawn only on those
 * samples is a nine-step staircase, which is the REDUCED-motion drawing of a countdown, not the
 * full-motion one. So `external.spanMs` (how long the whole of the caller's clock lasts) turns the
 * handed fraction into a RATE, and a rAF walks the outline on from the sample toward empty until
 * the next sample re-seats it. Under reduced motion the walk is dropped and the ring steps at the
 * caller's own rate, which is exactly the fallback that behaviour was already delivering.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../i18n/context';
import { buttonMotion, colors } from '../design/styles';
import { ACTIVE } from '../design/tokens';

/** The ring's thickness, and the air between it and the button's own edge, in css px. Thin enough
 *  to read as the button's outline rather than as a collar around it. */
const RING = 2;
const RING_GAP = 2;

/**
 * The stadium's thickness, and the air between it and the button's foot, in css px.
 *
 * It is the mark a shelf's row of names wears under the chosen name, at that mark's own
 * proportions — a drawing this interface already makes, rather than a second one invented for a
 * clock. The numbers are restated rather than read from the shell's layout: a primitive that
 * reached into one surface's units would stop being one.
 */
const STADIUM = 8;
const STADIUM_GAP = 7;

/** How the countdown is drawn under reduced motion: one step per second, so the ring still falls
 *  but nothing glides. */
const STEP_MS = 1000;

/** Announced but not seen: the sentence a screen reader is given about a button that presses
 *  itself. Off the button rather than inside it — a node inside a button is part of its accessible
 *  NAME, so a description written there would be read out as though it were the label. */
const spoken: CSSProperties = {
  position: 'absolute',
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

export interface TimedButtonProps {
  /** Seconds until the button presses itself. */
  after: number;
  /** What the press does. Reached through a real click, never called directly. `byClock` is true
   *  for the press this button makes when its time runs out, false for one a hand or a keyboard
   *  made — the distinction the event itself cannot carry. */
  onPress: (byClock: boolean) => void;
  /**
   * The host's own reason to hold the clock: it owns the surface this button stands on and knows
   * when someone is reading it, which the button cannot see from where it is.
   */
  paused?: boolean;
  /** The ring's colour. The accent by default, which is what an interface uses to say "this one". */
  ring?: string;
  /** How the countdown is drawn: the outline ring the button already is, or the yellow STADIUM
   *  under it — the mark a shelf's row of names puts under the chosen one, spent rather than
   *  filled. One control, two drawings; everything about the clock's behaviour is shared. */
  clock?: 'ring' | 'stadium';
  /**
   * The clock belongs to the CALLER, and `fraction` is how much of it is spent (0 = whole, 1 =
   * empty, which means FIRED). Either drawing takes it. Present, this button keeps no clock of its
   * own and none of the interruptions apply — see the header.
   *
   * `spanMs` is the whole length of that clock, which is what lets the fuse GLIDE between the
   * caller's samples instead of stepping with them (see the header). Omitted, the ring is drawn at
   * the handed fraction and nothing interpolates — the right answer for a caller whose clock is
   * already sampled per frame.
   */
  external?: { fraction: number; spanMs?: number };
  /** Whether the press feedback moves the element. A band-sized surface must not spring under the
   *  pointer: the spring is a chip's way of saying "button", and a surface has other ways. */
  pressMotion?: boolean;
  style?: CSSProperties;
  'aria-label'?: string;
  'data-testid'?: string;
  children: ReactNode;
}

export function TimedButton({
  after, onPress, paused = false, ring = colors.accentPrimary, clock = 'ring', external,
  pressMotion = true, style, 'aria-label': ariaLabel, 'data-testid': testId, children,
}: TimedButtonProps) {
  const t = useT();
  const reduced = useReducedMotionConfig();
  const btn = useRef<HTMLButtonElement>(null);
  const arc = useRef<SVGRectElement | SVGLineElement>(null);
  const hintId = useId();
  const [hovered, setHovered] = useState(false);
  /** Raised around the click the countdown makes, and read by the handler inside it. A ref rather
   *  than state: `click()` dispatches synchronously, so the flag is up for exactly that call. */
  const selfPress = useRef(false);
  const [cancelled, setCancelled] = useState(false);
  /** The button's own laid-out box and corner. `offsetWidth` and not a client rect: the press
   *  feedback scales the element, and a measured rect would then describe the button mid-press. */
  const [box, setBox] = useState({ w: 0, h: 0, r: 0 });

  useLayoutEffect(() => {
    const el = btn.current;
    if (!el) return undefined;
    const read = () => {
      const r = Number.parseFloat(getComputedStyle(el).borderTopLeftRadius) || 0;
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      // Same object unless something actually moved: a fresh one every pass is a render loop, since
      // the effect runs on the render its own state change caused.
      setBox((was) => (was.w === w && was.h === h && was.r === r ? was : { w, h, r }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /** Whether the clock is the caller's, and how much of it is spent. */
  const lentClock = external != null;
  const lent = external ? Math.max(0, Math.min(1, external.fraction)) : 0;
  const fired = lentClock && lent >= 1;
  /** How long the caller's whole clock lasts, which is what makes the handed fraction a rate. */
  const lentSpan = external?.spanMs ?? 0;

  // THE LENT FUSE, GLIDING between the caller's samples. It walks the drawn outline on from the
  // fraction just handed in and stops at empty, re-seated at every sample: an inline style beats
  // the rendered attribute, so this effect is the ONE writer while the clock is lent — a walk that
  // ran fast or slow is corrected by the caller's next sample rather than accumulating, and a
  // sample that says FIRED is drawn as fired rather than leaving the last walked frame standing.
  // Reduced motion keeps the ring and drops the walk: the caller's sample rate becomes the step
  // rate, which is the fact without the movement.
  useEffect(() => {
    if (!lentClock) return undefined;
    const draw = (spent: number) => {
      if (arc.current) arc.current.style.strokeDashoffset = String(spent);
    };
    if (reduced || lentSpan <= 0 || lent >= 1) {
      draw(lent);
      return undefined;
    }
    const from = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const spent = Math.min(1, lent + (now - from) / lentSpan);
      draw(spent);
      if (spent < 1) raf = requestAnimationFrame(tick);
    };
    draw(lent);
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `box.w` is a dependency because the ring is not RENDERED until the button has been measured:
    // without it the first laid-out frame would carry no writer at all.
  }, [lentClock, reduced, lentSpan, lent, box.w]);

  const running = !lentClock && after > 0 && !cancelled && !paused && !hovered;
  /** What is left of the countdown, in ms. Held across a pause, which is what makes a pause a pause
   *  rather than a restart. */
  const left = useRef(after * 1000);
  useEffect(() => { left.current = after * 1000; }, [after]);

  useEffect(() => {
    if (!running) return undefined;
    const total = after * 1000;
    let last = performance.now();
    let raf = 0;
    // The dash is the whole outline and the offset walks it off the end, so `spent` at 1 leaves
    // nothing drawn. `pathLength` made both numbers fractions of the ring rather than lengths.
    const draw = (spent: number) => {
      if (arc.current) arc.current.style.strokeDashoffset = String(spent);
    };
    const tick = (now: number) => {
      left.current -= now - last;
      last = now;
      if (left.current <= 0) {
        draw(1);
        // A real press, so the countdown and a finger cannot take two different paths.
        selfPress.current = true;
        btn.current?.click();
        selfPress.current = false;
        return;
      }
      const spent = 1 - left.current / total;
      draw(reduced ? (Math.floor((spent * total) / STEP_MS) * STEP_MS) / total : spent);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, after, reduced]);

  // Focus declines an offer this button is making. It has no offer to decline while the clock is
  // the caller's, and cancelling would only stop the DRAWING of something still running.
  const stop = useCallback(() => { if (!lentClock) setCancelled(true); }, [lentClock]);

  // The ring stands just outside the button's edge, so its corner is the button's plus that offset:
  // a rounded rect grown by `d` has a corner of `r + d`, or it pinches at the corners.
  const out = RING_GAP + RING;
  const w = box.w + 2 * out;
  const h = box.h + 2 * out;
  const r = Math.min(box.r + out, w / 2, h / 2);

  return (
    <>
      <motion.button
        ref={btn}
        type="button"
        {...(pressMotion ? buttonMotion : {})}
        aria-label={ariaLabel}
        aria-describedby={after > 0 ? hintId : undefined}
        data-testid={testId}
        onClick={() => onPress(selfPress.current)}
        onFocus={stop}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        // `relative` is the default a caller gets for free (it makes the button its own
        // containing block, which is what anchors the ring/stadium svg below); a caller naming its
        // OWN position — the band's `absolute`, spanning the window edge to edge — must win, or
        // the button collapses to zero width with nothing in flow to give it one.
        // EMPTY MEANS FIRED, said as the pill lighting: at the last frame of the caller's clock the
        // ring stands spent and the fill goes lit for the beat before the next attempt relights it.
        // It stands AFTER the caller's own style, and is the one thing here that does: a caller that
        // dresses the pill with a fill of its own (every one on a coloured paper does) would
        // otherwise paint over the lighting and the fired beat would never be seen.
        style={{ position: 'relative', ...style, ...(fired ? { backgroundColor: ACTIVE } : null) }}
      >
        {children}
        {(lentClock || (after > 0 && !cancelled)) && box.w > 0 ? (
          clock === 'stadium' ? (
            <svg
              aria-hidden
              width={box.w}
              height={STADIUM}
              viewBox={`0 0 ${box.w} ${STADIUM}`}
              style={{
                position: 'absolute', left: 0, top: box.h + STADIUM_GAP,
                pointerEvents: 'none', overflow: 'visible',
              }}
            >
              {/* As wide as the thing it marks, ending in the round caps that make it a stadium
                  rather than a bar — so the ends are held inside the width by half the thickness.
                  It is spent from the far end, the remaining length anchored where it started. */}
              <line
                ref={arc as RefObject<SVGLineElement>}
                x1={STADIUM / 2} y1={STADIUM / 2} x2={box.w - STADIUM / 2} y2={STADIUM / 2}
                stroke={ring} strokeWidth={STADIUM} strokeLinecap="round"
                pathLength={1} strokeDasharray={1} strokeDashoffset={lent}
              />
            </svg>
          ) : (
            <svg
              aria-hidden
              width={w}
              height={h}
              viewBox={`0 0 ${w} ${h}`}
              style={{ position: 'absolute', left: -out, top: -out, pointerEvents: 'none', overflow: 'visible' }}
            >
              {/* `pathLength` normalises the outline to 1, so nothing has to know how long a pill of
                  this size actually is. It is drawn WHOLE and spent from there. */}
              <rect
                ref={arc as RefObject<SVGRectElement>}
                x={RING / 2} y={RING / 2} width={w - RING} height={h - RING} rx={r} ry={r}
                fill="none" stroke={ring} strokeWidth={RING} strokeLinecap="round"
                pathLength={1} strokeDasharray={1} strokeDashoffset={lent}
              />
            </svg>
          )
        ) : null}
      </motion.button>
      {after > 0 ? (
        // A live region, because the cancellation is caused BY the focus that would have read a
        // description: by the time the description is spoken it is already the wrong one. It changes
        // at most once, so it is not chatty.
        <span id={hintId} role="status" style={spoken}>
          {cancelled ? t('timed.stopped') : t('timed.self_press', { seconds: after })}
        </span>
      ) : null}
    </>
  );
}
