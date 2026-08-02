/*
 * The first-launch tour's one visible surface: a dim over the app, a spotlight on the thing being
 * explained, and a bubble that names it.
 *
 * The dim is ONE element (`TourDim`, an SVG whose hole is masked out) doing both jobs: a plain
 * full-viewport dim until the current step's target has been measured, then that same dim with the
 * target's box cut out of it. One element rather than a scrim plus a spotlight, because two
 * translucent dims stacked over the same pixels read darker than either, and because the lit hole
 * and the dim around it then cannot disagree about where the target is. It stays mounted for as
 * long as the tour runs, so the app never flashes undimmed between steps.
 *
 * The CARD is the opposite of a tracked highlight: it never travels. Which transition a step change
 * gets is POSITIONAL, decided by where the new card lands:
 *
 *   - somewhere else: a NEW card, entering and exiting the way every other panel surface in this
 *     app does (SpokeShell, RestoreBubble) — springs.bouncy in, exitTransition out, an asymmetry
 *     styles.ts documents: a panel arrives with life and is put away cleanly. Both are on screen for
 *     the length of the exit, one leaving the control it described as the other pops at its own.
 *   - the same place (the two centred steps at the start): the SAME card, its copy crossing over
 *     inside it. An exit and an entrance in one place accomplish nothing visible.
 *
 * A card's POSITION is never animated either way: one is born at its anchor, and the other stays at
 * its own. A KEPT card's HEIGHT is the exception: it grows or shrinks to the incoming copy's measured
 * size while the copy crosses over inside it (detailed at the block that renders it).
 *
 * It renders the step it is SHOWING, which lags the current step until that step's target has been
 * measured, so nothing is ever put on screen against a box that has not been read yet.
 *
 * Focus is taken by each card as it MOUNTS, which is what keeps the keyboard path unbroken across
 * the remount; the card that is kept never loses focus in the first place.
 *
 * Measuring a step's target only AFTER the app has prepared that step (the phone card is collapsed,
 * and therefore absent from the DOM, when the app opens; onStepEnter is what expands it) rests on
 * two invariants, spelled out at the effects that carry them: the announcement is a layout effect,
 * and the measurement is deferred to a rAF.
 *
 * The measurement TRACKS rather than sampling once: getBoundingClientRect reports the TRANSFORMED
 * box and a target animates in under a spring, so a single read lands on a box the target is still
 * leaving. A step is shown from the first frame its target is measurable at all, and the rect goes
 * on being read for a bounded window after that, the spotlight gliding after each new value. The
 * follow IS the correction, which is why a first read taken mid-flight costs nothing. Reading stops
 * once two consecutive frames agree (never before a floor: a target that has not started moving yet
 * agrees with itself) or at the frame cap.
 *
 * A step whose target cannot be measured is passed over rather than drawing a spotlight at the
 * origin. A resize, a viewport change, a UI-scale change and the phone card opening or closing all
 * re-run the same tracking: those are the four things that move a target. A step that names NO target measures
 * nothing at all: it keeps the full-viewport scrim and centres its bubble, and it is on screen from
 * the commit that made it current.
 *
 * The bubble is PLACED, not clamped (`place-bubble`): a step's preferred side is honoured only
 * where the bubble fits beside the lit box, because clamping one that does not fit puts it on top
 * of the control the step is describing.
 *
 * The bubble scales with `useChromeScale()` as css `zoom`, like every other chrome surface here
 * (ContextMenu, DeletePopover, FloatingCluster). The spotlight does NOT: it is positioned from the
 * live rect and has to sit exactly on the real element, in visual px.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { useT } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import { colors, font, modalTitle, radii, scaleRest, shadows, snapTween, springs, exitTransition, pressable, cursors, z } from '../../styles';
import { useChromeScale } from '../../menu/scale';
import { Wavy } from '../../menu/Wavy';
import { useOverlayLock } from '../../hooks/useOverlayLock';
import { BrandLockup } from '../BrandLockup';
import { placeBubble, type Box } from './place-bubble';
import { measureTarget } from './measure';
import { useTour } from './use-tour';
import { type TourStep } from './steps';

const BUBBLE_W = 340; // css px inside the chrome-zoomed subtree; its VISUAL width is this x chrome
const BUBBLE_H = 200; // the card is content-sized, so this is the estimate the placement fits against
const GAP = 18; // between the spotlight edge and the bubble
const LIT_INSET = 8; // how far the lit hole is grown past the target on every side, in visual px

/** The box that is actually LIT: the measured target, grown by the inset the ring is drawn at. The
 *  bubble has to clear what is drawn, not what was measured. Exported so a test can build one from
 *  a measured rect without duplicating the inset math. */
export function litBox(rect: DOMRect): Box {
  return {
    left: rect.left - LIT_INSET,
    top: rect.top - LIT_INSET,
    width: rect.width + LIT_INSET * 2,
    height: rect.height + LIT_INSET * 2,
  };
}
/** Frames that must be READ before two agreeing reads are allowed to STOP the tracking. An
 *  animation writes its t=0 keyframe on the animator's first tick, and this loop is registered
 *  during the commit, ahead of that tick: frames 1 and 2 can therefore both read the pre-animation
 *  box and agree on it, letting go of a target that has not moved yet. A third read puts a live
 *  frame into the compared pair. Exported because a test waits on frames read, not on wall time. */
export const TRACK_MIN_FRAMES = 3;

/** Hard cap on how long the loop follows a target before letting go. 30 frames is ~0.5s at 60Hz,
 *  SHORTER than springs.bouncy takes to reach its rest thresholds (~0.9s), so for a target riding
 *  that spring the cap is the normal exit and the last box read can sit a pixel or two short of the
 *  resting one — invisible, since the spotlight is already on the target and only stops following
 *  it those last two pixels. It is also the window a target has to become measurable AT ALL: one
 *  that never does releases its step, which is what passes the step over. */
export const TRACK_MAX_FRAMES = 30;

/** Rects are compared by value: getBoundingClientRect allocates a new object per call, so identity
 *  says nothing. Both null (an absent target) counts as agreement. */
function sameRect(a: DOMRect | null, b: DOMRect | null): boolean {
  if (!a || !b) return a === b;
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Ties the mask to its one consumer; there is never more than one tour overlay mounted. */
const HOLE_MASK_ID = 'petit-tour-hole';

/** How far the lit box may move and still be worth MOVING, as a fraction of the viewport's
 *  diagonal, which is the only length that means the same thing on every screen. Past about a third
 *  of the screen the eye saccades to the new position instead of tracking the box across it, so the
 *  glide is played to someone already looking at the destination: all it adds is the wait, and a
 *  streak back across ground the eye has left. Under it the move is short enough to follow, and
 *  following is what ties the highlight to what it moved to. Exported so a test can check the tour's
 *  OWN step pairs against the same threshold, rather than a copy of it. */
export const GLIDE_MAX_TRAVEL = 1 / 3;

/** Distance between two lit boxes' centres, against that fraction of the viewport diagonal.
 *  Exported for the same reason as `GLIDE_MAX_TRAVEL`. */
export function movedFar(from: Box, to: Box): boolean {
  const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
  const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
  return Math.hypot(dx, dy) > Math.hypot(window.innerWidth, window.innerHeight) * GLIDE_MAX_TRAVEL;
}

/**
 * The dim, and the lit hole punched out of it.
 *
 * SVG rather than a `0 0 0 9999px` box-shadow on the hole: that spread gives the element a paint
 * box roughly 20000px on a side, which past a device pixel ratio of 2 is beyond the maximum texture
 * a compositor will allocate, and this element sits over a composited WebGL canvas so it is
 * composited too. An SVG mask is exactly the size of the viewport whatever the hole is.
 *
 * ONE element, always mounted while the tour runs: the app never flashes undimmed between steps,
 * and two translucent dims over the same pixels (a scrim plus a shadowed spotlight) would read
 * darker than either. Without a lit box it is a plain full-viewport dim.
 *
 * The hole and its ring GLIDE to a nearby box rather than cutting to it, because the box moves
 * under the visitor for reasons that are not a step change: a target animating in, and a UI-scale
 * change rescaling every target at once. The glide is a PURE EASE (`snapTween`), never a spring: a
 * highlight that overshoots stops covering the control it is highlighting, and what the eye catches
 * is the miss, not the movement.
 *
 * A FAR box is cut to instead (`GLIDE_MAX_TRAVEL`), and so is every box under reduced motion. Both
 * take the same path: plain SVG rects React writes the geometry straight into, with no animator
 * involved at all.
 *
 * The geometry rides on `attrX`/`attrY`, not `x`/`y`: on an SVG element framer reads those two as
 * transforms, and the hole has to move the mask's own rectangle.
 */
/**
 * The spotlight's corner radius, in the SCREEN px the mask is drawn in.
 *
 * `radii.lg` is a CSS radius, and every control it traces wears it scaled by the chrome zoom — so
 * the hole matches the control's own corner only if it scales too. It is then clamped to half the
 * box: on a phone, where the whole UI is scaled well down, a fixed radius is wider than the target
 * and the highlight reads as a pill or a circle rather than as the control it is pointing at.
 */
export function spotlightRx(w: number, h: number, chrome: number): number {
  return Math.max(2, Math.min(radii.lg * chrome, w / 2, h / 2));
}

function TourDim({ lit, reduced, chrome }: { lit: Box | null; reduced: boolean; chrome: number }) {
  const style: CSSProperties = { position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: z.tour };
  // The ring sits just OUTSIDE the hole, over the dim, so it does not eat into the lit area.
  const ring = lit && { left: lit.left - 1.5, top: lit.top - 1.5, width: lit.width + 3, height: lit.height + 3 };
  // The box this one is arriving from, which is what says whether the move is worth animating. The
  // next render after a cut compares the box against itself, so the rects come back under the
  // animator already sitting where they were cut to.
  const from = useRef<Box | null>(null);
  const cut = reduced || (lit != null && from.current != null && movedFar(from.current, lit));
  useLayoutEffect(() => { from.current = lit; });
  const holeRx = lit ? spotlightRx(lit.width, lit.height, chrome) : 0;
  const ringRx = ring ? spotlightRx(ring.width, ring.height, chrome) : 0;
  return (
    <svg style={style} width="100%" height="100%" aria-hidden data-testid="tour-dim">
      <defs>
        <mask id={HOLE_MASK_ID}>
          {/* White paints the dim, black cuts the hole out of it. */}
          <rect x="0" y="0" width="100%" height="100%" fill="#fff" />
          {lit && (cut
            ? <rect x={lit.left} y={lit.top} width={lit.width} height={lit.height} rx={holeRx} fill="#000" />
            : <motion.rect
                initial={false}
                animate={{ attrX: lit.left, attrY: lit.top, width: lit.width, height: lit.height }}
                transition={snapTween}
                rx={holeRx} fill="#000"
              />)}
        </mask>
      </defs>
      <rect x="0" y="0" width="100%" height="100%" fill={colors.surfaceOverlay} mask={`url(#${HOLE_MASK_ID})`} />
      {ring && (cut
        ? <rect
            x={ring.left} y={ring.top} width={ring.width} height={ring.height}
            rx={ringRx} fill="none" stroke={colors.accentPrimary} strokeWidth={3}
          />
        : <motion.rect
            initial={false}
            animate={{ attrX: ring.left, attrY: ring.top, width: ring.width, height: ring.height }}
            transition={snapTween}
            rx={ringRx} fill="none" stroke={colors.accentPrimary} strokeWidth={3}
          />)}
    </svg>
  );
}

/**
 * A step title, with the app's own name carrying the wavy underline.
 *
 * The name is SPLIT out of the already-translated title rather than composed around it: each
 * locale puts `{app}` where its grammar wants it (last in English, first in Japanese), and a split
 * is the one form that does not care which. A title that does not carry the name renders plain.
 *
 * `Wavy` sizes its wave through the menu scale context, which the tour is mounted outside of, so
 * the wave is the design default for a 1080px viewport and the bubble's chrome `zoom` scales it
 * from there — the same size relationship it has inside the menu.
 */
function StepTitle({ text, name }: { text: string; name: string }) {
  const at = name ? text.indexOf(name) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <Wavy>{name}</Wavy>
      {text.slice(at + name.length)}
    </>
  );
}

export interface TourOverlayProps {
  /** Fired once per step as it becomes current, in order — before its target is confirmed
   *  measurable, so this is where the app prepares a step (e.g. revealing its target), not where
   *  it reacts to the step already being shown. */
  onStepEnter?: (step: TourStep) => void;
}

/** A measurement result, tied to the step it was taken for. */
interface Measurement {
  step: TourStep;
  rect: DOMRect | null;
}

export function TourOverlay({ onStepEnter }: TourOverlayProps) {
  const t = useT();
  const { running, step, total, indexOf, next, advanceFrom, skip } = useTour();
  const reduced = useReducedMotionConfig();
  const chrome = useChromeScale();
  const eventBus = useEditorStore((s) => s.eventBus);
  /** The most recent measurement, stamped with the step it belongs to. A measurement whose `step`
   *  no longer matches the current step is stale and read as "not yet measured" rather than as the
   *  new step's result — this is what keeps a step from ever being skipped by a PREVIOUS step's
   *  leftover result. */
  const [seen, setSeen] = useState<Measurement | null>(null);
  /** The step the bubble is SHOWING, and the box it is placed against. It lags `step` by the one
   *  frame a newly-current step's target takes to be measured, and that lag is what keeps the card
   *  mounted across a step change: gating the render on the CURRENT step's measurement unmounted
   *  the bubble for that frame, so its entrance replayed and focus fell to <body>. A step that is
   *  passed over never becomes shown at all. */
  const [shown, setShown] = useState<Measurement | null>(null);
  const announced = useRef<TourStep | null>(null);
  const armed = useRef<TourStep | null>(null);
  const frame = useRef<number | null>(null);
  /** Where the last card RENDERED sat, so the next step can tell whether its card lands on the same
   *  pixels. */
  const lastPos = useRef<string | null>(null);
  /** The card ELEMENT's identity. It changes only when a step change MOVES the card, so a step
   *  change that lands in the same place keeps the card it already has. */
  const [cardTag, setCardTag] = useState<{ id: number; step: TourStep | null }>({ id: 0, step: null });
  /** The copy's own height, which is what a KEPT card animates between as its copy changes.
   *  Stamped with the card it was measured on: a card that has just been replaced is already at its
   *  own size, and must not animate out of the height the card before it happened to have. */
  const [contentH, setContentH] = useState<{ card: number; h: number } | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  // The outgoing copy holds this same ref until its exit finishes, which is AFTER the incoming one
  // has claimed it; taking only the attach keeps the ref on the copy that is staying.
  const setContentNode = useCallback((el: HTMLDivElement | null) => { if (el) contentRef.current = el; }, []);
  // Focus is taken as a card MOUNTS. A step change replaces the card, so a ref shared by both would
  // be nulled by the outgoing one's detach; a callback ref belongs to one card and fires exactly
  // once for it. Once per step and never on a remeasure, which is what keeps a pan or a resize from
  // stealing focus back from a control the visitor had tabbed to.
  const focusCard = useCallback((el: HTMLDivElement | null) => { el?.focus(); }, []);

  const menuCollapsed = useEditorStore((s) => s.menuCollapsed);
  const uiZoom = useEditorStore((s) => s.uiZoom);
  const satisfied = step?.advanceWhen === 'menu-open' ? !menuCollapsed
    : step?.advanceWhen === 'menu-closed' ? menuCollapsed
    : false;

  useOverlayLock(running);

  // MUST BE A LAYOUT EFFECT, and the measurement below MUST STAY DEFERRED to a rAF: together those
  // two facts, not the order these effects are declared in, are what gets a step's target measured
  // only after the app has prepared it (`menu: 'expand'` opens the phone card, which is what brings
  // that step's target into the DOM at all). React runs the layout pass at DiscreteEventPriority,
  // so a setState from ANY layout effect lands on SyncLane and is flushed synchronously inside the
  // same task as the commit, while a rAF registered during that commit cannot run until the task
  // yields — so the host's expansion is in the DOM first. Announce from a passive effect and it
  // runs after paint, a frame too late; read the DOM inline here instead of from a rAF and the read
  // happens before that sync flush (the whole layout pass precedes it) and finds the collapsed card.
  //
  // It fires the moment a step becomes CURRENT, not once the step can be shown: gating it on the
  // rect that the announcement itself is supposed to produce would deadlock. A step that is
  // announced and then passed over (its own measurement lands absent anyway) has run its side
  // effect for a step nobody saw — for the card's expand/collapse that is harmless and desired, since
  // the choreography is defined by the step order, not by which steps turned out to be showable.
  //
  // The same effect ENDS a run: this overlay is mounted for the app's whole life and TOUR_STEPS
  // entries are module singletons, so a value left on a ref would be read by the NEXT run as its
  // own. ANNOUNCED and ARMED are the two values that is true for, and are cleared here (a step
  // whose gesture was armed and then passed by the BUTTON must not credit a later run for it). The
  // card's travel origin (`lastPos`) and its measured height (`contentH`) are left as they are: the
  // ordinary step-to-step comparison already reads the former as wherever the outgoing card sat, run
  // boundary or not, and the layout effect that measures the latter re-runs before every paint
  // regardless.
  useLayoutEffect(() => {
    if (step && announced.current !== step) { announced.current = step; onStepEnter?.(step); }
    if (!step) { announced.current = null; armed.current = null; }
  }, [step, onStepEnter]);

  // One read per frame. A rect is published the moment there is one, and republished on every
  // later frame it MOVES on, so the step is on screen while its target is still animating in and
  // the spotlight glides after it. Reading stops once two consecutive frames agree, or at the cap.
  // `step` is captured by this closure, so a frame that lands after the step has moved on stamps a
  // measurement for the OLD step, not the new one.
  const track = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    // Cleared unconditionally, here rather than only on the targetless path: TOUR_STEPS entries
    // are module singletons, so a later run reaching the SAME step object a past run passed over
    // would otherwise find that old `{ step, rect: null }` still stamped as a match for it, with
    // no frame ever read this time.
    setSeen(null);
    // No step, or a step with no target: nothing to measure, and a targetless step must not spend
    // frames waiting for one before it can be shown.
    const target = step?.target;
    if (!step || !target) { frame.current = null; return; }
    let prev: DOMRect | null | undefined; // undefined = no frame read yet, distinct from a null read
    let frames = 0;
    const read = () => {
      const now = measureTarget(target);
      frames += 1;
      const still = prev !== undefined && sameRect(prev, now);
      if (now && !still) setSeen({ step, rect: now });
      if ((still && frames >= TRACK_MIN_FRAMES) || frames >= TRACK_MAX_FRAMES) {
        frame.current = null;
        // Absence is recorded only as the loop lets go: a target missing on one frame may still
        // arrive on the next, and this is the value that passes the step over.
        if (!now) setSeen({ step, rect: null });
        return;
      }
      prev = now;
      frame.current = requestAnimationFrame(read);
    };
    frame.current = requestAnimationFrame(read);
  }, [step]);

  useLayoutEffect(() => {
    track();
    return () => {
      if (frame.current != null) { cancelAnimationFrame(frame.current); frame.current = null; }
    };
  }, [track]);

  // A run already in flight is LEFT ALONE: it calls measureTarget afresh every frame, so it
  // converges on the new geometry by itself. Restarting it here would starve it — a drag-resize
  // fires an event per frame, and each restart resets the floor before the loop can take two
  // consecutive reads, so nothing new would be published for the whole drag.
  const onGeometryChange = useCallback(() => { if (frame.current == null) track(); }, [track]);

  useEffect(() => {
    if (!running) return;
    window.addEventListener('resize', onGeometryChange);
    eventBus.on('viewport-changed', onGeometryChange);
    return () => {
      window.removeEventListener('resize', onGeometryChange);
      eventBus.off('viewport-changed', onGeometryChange);
    };
  }, [running, onGeometryChange, eventBus]);

  // Two more ways a target moves, neither of which fires `resize` or emits `viewport-changed`:
  // Ctrl +/- rescales the menu and every chrome surface with it, and the phone card's own state
  // decides whether the targets ON it are in the DOM at all. Without this the spotlight sits at
  // the old scale, or keeps pointing at a card the visitor has since put away.
  useEffect(() => { onGeometryChange(); }, [uiZoom, menuCollapsed, onGeometryChange]);

  // What the bubble shows: a targetless step the moment it becomes current (there is nothing to
  // wait for), a targeted one on the first frame its OWN measurement carries a rect. Every later
  // read of the same step lands here too, which is how the spotlight and the bubble follow a
  // target that is still moving.
  useEffect(() => {
    if (!running) { setShown(null); return; }
    if (!step) return;
    if (!step.target) { setShown((cur) => (cur?.step === step ? cur : { step, rect: null })); return; }
    if (seen?.step === step && seen.rect) setShown(seen);
  }, [running, step, seen]);

  useEffect(() => {
    if (!running) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') skip(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [running, skip]);

  // Doing the thing a step describes counts as pressing Next. The condition is ARMED ONLY FROM THE
  // UNSATISFIED SIDE: a later step's programmatic `menu` action leaves the store in exactly the
  // state one of these asks for, so a step that opens with its condition already true must wait for
  // the visitor to act rather than advancing on arrival. Armed per step object, so the arming can
  // never carry across a step change.
  useEffect(() => {
    if (!running || !step?.advanceWhen) return;
    if (armed.current !== step) { if (!satisfied) armed.current = step; return; }
    if (satisfied) { armed.current = null; advanceFrom(step); }
  }, [running, step, satisfied, advanceFrom]);

  // A step whose OWN measurement has landed and come back absent has nothing to point at, so it is
  // passed over rather than drawn against the origin. The last step finishes, so a map with no
  // targets at all ends the tour instead of cycling.
  useEffect(() => {
    if (running && step && seen?.step === step && !seen.rect) next();
  }, [running, step, seen, next]);

  // The bubble renders under the chrome `zoom`, so its coordinates are CSS px inside that zoomed
  // subtree while a measured rect is VISUAL px: place it in visual px (what actually occupies
  // screen), then divide the zoom back out. A targetless step has nothing to anchor to and centres
  // instead.
  const lit = shown?.rect ? litBox(shown.rect) : null;
  const placed = lit && shown
    ? placeBubble(
        lit,
        { width: BUBBLE_W * chrome, height: BUBBLE_H * chrome },
        shown.step.side,
        GAP,
        { width: window.innerWidth, height: window.innerHeight },
      )
    : null;

  // A step change either MOVES the card or does not, and that decides which of the two transitions
  // it gets. Landing somewhere else is a new card: the old one leaves the control it was describing
  // as the new one pops at another, which is the whole of what the visitor sees. Landing on the
  // same pixels (the two centred steps at the start) keeps the card and crosses its CONTENTS over,
  // because an exit and an entrance in one place accomplish nothing visible.
  //
  // Derived during render (React's pattern for state that follows another value) rather than from
  // an effect: the card's key is needed in the same commit the step change renders in. `lastPos`
  // still holds the outgoing card's place at that point, since the effect below runs after.
  const posKey = shown ? (placed ? `${Math.round(placed.left)},${Math.round(placed.top)}` : 'centre') : null;
  useLayoutEffect(() => { lastPos.current = posKey; }, [posKey]);
  if (shown && cardTag.step !== shown.step) {
    const moved = cardTag.step != null && lastPos.current !== posKey;
    setCardTag({ id: cardTag.id + (moved ? 1 : 0), step: shown.step });
  }

  // The incoming copy's natural height, which is the card's target height. It is measured off the
  // copy rather than off the card because the card's own box is the ANIMATED value; and it is the
  // incoming copy alone, because the outgoing one is out of the flow (`popLayout`) from the first
  // frame: the flow height never changes again, so nothing snaps when the outgoing copy finally
  // unmounts.
  useLayoutEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const measure = () => { const h = el.offsetHeight; if (h > 0) setContentH({ card: cardTag.id, h }); };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [shown?.step, cardTag.id, t]);

  if (!running || !step) return null;

  const dim = <TourDim lit={lit} reduced={!!reduced} chrome={chrome} />;

  if (!shown) return dim;

  // The controls belong to the step on the card, not to `step`: until a target has been measured
  // the current index is already one ahead, and Next pressed in that window must advance from what
  // was read.
  const shownIndex = indexOf(shown.step);
  const shownIsLast = shownIndex === total - 1;

  // A step that points at nothing is centred on screen, so its copy has no left edge to align to
  // and reads as a masthead: the logo, the title and the body all centre. A step that points at a
  // control keeps its copy left-aligned, against the edge nearest what it is describing.
  const centred = placed == null;
  const align = centred ? 'center' : 'left';
  const position: CSSProperties = placed
    ? { left: placed.left / chrome, top: placed.top / chrome }
    : { left: '50%', top: '50%' };

  const bubble: CSSProperties = {
    position: 'fixed',
    width: BUBBLE_W,
    // BUBBLE_W is what the placement is told the card occupies, so the padding has to be inside it:
    // under content-box the card is 40px wider than that and creeps back over the spotlight.
    boxSizing: 'border-box',
    background: colors.white,
    borderRadius: radii.lg,
    padding: '18px 20px 14px',
    boxShadow: shadows.s2,
    fontFamily: font.family,
    zIndex: z.tour + 1,
  };

  return (
    <>
      {dim}
      {/* A card that MOVES is a new card, entering and exiting the way every other panel surface
          here does (SpokeShell, RestoreBubble): springs.bouncy in, exitTransition out, so it
          arrives with life and is put away cleanly. Both are on screen for the length of the exit,
          which is the point — one leaves the control it was describing as the next pops at another.
          A card born at its own anchor sized to its own copy needs nothing animated into place. */}
      <AnimatePresence>
        <motion.div
          key={cardTag.id}
          ref={focusCard}
          role="dialog"
          // No aria-modal: the app under the dim is fully operable (that is how pressing the real
          // phone advances a step), and there is no focus trap. Claiming modality would tell a screen
          // reader to hide an app its user can still drive.
          aria-label={t(shown.step.titleKey)}
          tabIndex={-1}
          style={{ ...bubble, ...position, zoom: chrome, outline: 'none' }}
          // The centring translate rides in the template rather than in `x`/`y`: framer owns the
          // transform for the entrance scale, and a percentage translate composes with it.
          // ALWAYS a template, even when there is nothing to prepend. Without one, framer collapses
          // the style to `transform: none` the moment it believes the spring is done — and
          // `springs.bouncy` is underdamped, so it does that while the scale is still ringing a
          // fraction under 1, snapping the card (and the logo in it) to full size and back. The
          // template keeps a real matrix on the element the whole way down; translateZ(0) also keeps
          // it on its own layer, so the raster never re-snaps either.
          transformTemplate={(_, generated) => (centred
            ? `translate(-50%, -50%) ${generated} translateZ(0)`
            : `${generated} translateZ(0)`)}
          initial={reduced ? false : { scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { scale: 0.4, opacity: 0, transition: exitTransition }}
          transition={reduced ? { duration: 0 } : { ...springs.bouncy, ...scaleRest }}
        >
          {/* A step change that KEEPS the card crosses its copy over in place, and the card GROWS or
              SHRINKS to the incoming copy while it does. The height is animated to a measured value
              rather than left to the flow: `popLayout` puts the outgoing copy out of the flow at
              once, so the flow height is the incoming copy's from the first frame and would
              otherwise change in one step, under a copy that is still fading.
              The clip holds a taller outgoing copy inside the shrinking card. It is also why the
              copy only FADES: anything that offsets it would be cut off by that same clip.
              `initial={false}` on both: a card that has just MOUNTED is already its own entrance,
              so neither its copy nor its height may play a second one. */}
          <motion.div
            style={{ position: 'relative', overflow: 'hidden' }}
            initial={false}
            animate={contentH?.card === cardTag.id ? { height: contentH.h } : {}}
            transition={reduced ? { duration: 0 } : springs.stiff}
          >
            <AnimatePresence initial={false} mode="popLayout">
              <motion.div
                key={shown.step.id}
                initial={reduced ? false : { opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={reduced ? { opacity: 0, transition: { duration: 0 } } : { opacity: 0, transition: exitTransition }}
                transition={reduced ? { duration: 0 } : springs.gentle}
              >
                {/* The measured element is this plain box rather than the motion element around it:
                    AnimatePresence reads its children's `ref` prop, which React 18 does not carry. */}
                <div ref={setContentNode}>
                  {shown.step.brand && (
                    <div style={{ marginBottom: 12, display: 'flex', justifyContent: centred ? 'center' : 'flex-start' }}>
                      <BrandLockup size={54} logoOnly />
                    </div>
                  )}
                  <div style={{ ...modalTitle, textAlign: align, lineHeight: 1.15, marginBottom: 6 }}>
                    <StepTitle text={t(shown.step.titleKey)} name={t('app.name')} />
                  </div>
                  {/* brownText, not textSecondary: this text is normal-size, and textSecondary sits
                      below the 4.5:1 AA floor on white (see legal/a11y.test.tsx). */}
                  <div style={{ ...font.body, color: colors.brownText }}>{t(shown.step.bodyKey)}</div>
                </div>
              </motion.div>
            </AnimatePresence>
          </motion.div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 16 }}>
            <button
              type="button"
              onClick={skip}
              style={{ border: 'none', background: 'transparent', cursor: cursors.clickable, fontFamily: font.family, fontWeight: 800, fontSize: 13, color: colors.brownText, padding: 0 }}
            >{t('tour.skip')}</button>
            <span style={{ fontFamily: font.family, fontWeight: 700, fontSize: 13, color: colors.brownText }}>
              {t('tour.progress', { n: shownIndex + 1, total })}
            </span>
            <motion.button
              type="button"
              onClick={() => advanceFrom(shown.step)}
              {...pressable}
              style={{ border: 'none', background: colors.tileYellow, color: colors.frameDark, cursor: cursors.clickable, fontFamily: font.family, fontWeight: 800, fontSize: 13, padding: '6px 16px', borderRadius: radii.pill }}
            >{shownIsLast ? t('tour.start') : t('tour.next')}</motion.button>
          </div>
        </motion.div>
      </AnimatePresence>
    </>
  );
}
