/**
 * A card's Show me on the live interface: each step poses what it is about (a mode, the view, the
 * save-and-share window), rings the controls it names with one masked dim, and stands a callout
 * beside them. The dim takes every press but those on the ring, which reach the real controls; a
 * step whose action is on the map stands no dim, so the whole interface takes presses and keys. A
 * step that waits for the visitor moves on by itself once they have done it (`deck.ts:ShowStep.done`),
 * and Next moves on regardless. A step whose controls do not arrive is passed over, and so is one
 * for the other input mode; one that rings nothing stands its callout near the top of the screen.
 * Back to the tips beside the callout's Next, the last step's Done and Escape return to the card, and the store's move out of
 * the Show me gives back whatever the steps borrowed and the visitor built (`state/slices/shell.ts:tourPhase`).
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { flushSync } from 'react-dom';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { useEditorStore } from '../../../state/store';
import { viewportSize } from '../../../platform/device/viewport-space';
import { useReadingT } from '../../design/reading';
import { useCurrentInputMode } from '../../design/input-mode';
import { readTourWatch, useTourWatch, type TourWatch } from '../../session/tour-watch';
import { escapeOnMap } from '../../../editor/commands/commands';
import { framerMotion, NO_MOTION } from '../../design/motion';
import { useGlidingChromeScale, useViewportSize } from '../../design/scale';
import { radii, z } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { skin } from '../../design/window-skin';
import { ACCENT, OVERLAY_DIM, PANEL_EDGE } from '../../design/tokens';
import { ActionButton } from '../../primitives/ActionButton';
import { useGlidingChromeLift } from '../../primitives/chrome-layer';
import { NOTICE_CONTROL } from '../../primitives/NoticeBar';
import { useOverlayLock } from '../../primitives/use-overlay-lock';
import { useSurfaceScope } from '../../primitives/surface-scope';
import { useObservedSize } from '../../primitives/use-observed-size';
import { onMorph, pageUndrawn, useMorph } from '../../primitives/morph';
import { measureTargets } from './measure';
import { placeBeside, VIEWPORT_MARGIN, type Box } from './place-beside';
import type { ShowStep, TourCard } from './deck';

/** Visual-pixel padding between a ringed control and its ring. */
const LIT_INSET = 8;
/** The callout's width in its own px, and its gap from the ring. */
const CALLOUT_W = 300;
const GAP = 16;
/** Reads before stability may end tracking, and the most frames a target still moving is followed. */
const TRACK_MIN_FRAMES = 3;
const TRACK_MAX_FRAMES = 30;
/** A target not yet on screen is waited for while the page is still changing: the step is passed
 *  over once nothing has come or gone in the document for the quiet time, and at the latest after
 *  the bound, in ms. */
const ABSENT_QUIET_MS = 600;
const ABSENT_MAX_MS = 4000;
/** Past a third of the viewport's diagonal the eye saccades to the new place, so the ring cuts there
 *  instead of gliding. */
const GLIDE_MAX_TRAVEL = 1 / 3;

/** The spotlight's corner radius in screen px: `radii.lg` at the chrome zoom like the control it
 *  traces, held to half the box so a small target does not read as a pill. */
export function spotlightRx(w: number, h: number, chrome: number): number {
  return Math.max(2, Math.min(radii.lg * chrome, w / 2, h / 2));
}

const sameBox = (a: Box | null, b: Box | null): boolean => (!a || !b ? a === b
  : a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height);
const litBox = (b: Box): Box => ({ left: b.left - LIT_INSET, top: b.top - LIT_INSET, width: b.width + 2 * LIT_INSET, height: b.height + 2 * LIT_INSET });

function movedFar(from: Box, to: Box): boolean {
  const dx = (from.left + from.width / 2) - (to.left + to.width / 2);
  const dy = (from.top + from.height / 2) - (to.top + to.height / 2);
  const { width, height } = viewportSize();
  return Math.hypot(dx, dy) > Math.hypot(width, height) * GLIDE_MAX_TRAVEL;
}

const HOLE_MASK_ID = 'petit-tour-hole';

/** The dim with the lit hole cut out of it, as an SVG mask (a box-shadow spill would exceed the
 *  compositor's texture limit above DPR 2), and the ring around the hole; with `clear`, the ring
 *  alone. It takes no press: `TourBlock` does. */
function TourDim({ lit, reduced, chrome, following, clear }: { lit: Box | null; reduced: boolean; chrome: number; following: boolean; clear: boolean }) {
  const from = useRef<Box | null>(null);
  // Read on every frame of the chrome's morph, the ring follows its target with no glide of its own.
  const cut = reduced || following || (lit != null && from.current != null && movedFar(from.current, lit));
  useLayoutEffect(() => { from.current = lit; });
  const ring = lit && { left: lit.left - 1.5, top: lit.top - 1.5, width: lit.width + 3, height: lit.height + 3 };
  const rect = (b: Box, rest: Record<string, unknown>) => (cut
    ? <rect x={b.left} y={b.top} width={b.width} height={b.height} {...rest} />
    : <motion.rect initial={false} animate={{ attrX: b.left, attrY: b.top, width: b.width, height: b.height }} transition={framerMotion('tour.spotlight.move')} {...rest} />);
  return (
    <svg style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: z.tour }} width="100%" height="100%" aria-hidden data-testid="tour-dim">
      {!clear && (
        <>
          <defs>
            <mask id={HOLE_MASK_ID}>
              <rect x="0" y="0" width="100%" height="100%" fill="white" />
              {lit && rect(lit, { rx: spotlightRx(lit.width, lit.height, chrome), fill: 'black' })}
            </mask>
          </defs>
          <rect x="0" y="0" width="100%" height="100%" fill={OVERLAY_DIM} mask={`url(#${HOLE_MASK_ID})`} />
        </>
      )}
      {ring && rect(ring, { rx: spotlightRx(ring.width, ring.height, chrome), fill: 'none', stroke: ACCENT, strokeWidth: 3 })}
    </svg>
  );
}

/** What takes the presses around the lit box, leaving the box itself to the controls it rings: four
 *  bands, or the whole screen while nothing is lit. */
function TourBlock({ lit }: { lit: Box | null }) {
  const band = (style: CSSProperties) => <div aria-hidden data-testid="tour-block" style={{ position: 'fixed', zIndex: z.tour, ...style }} />;
  if (!lit) return band({ inset: 0 });
  const right = lit.left + lit.width;
  const bottom = lit.top + lit.height;
  return (
    <>
      {band({ left: 0, right: 0, top: 0, height: Math.max(0, lit.top) })}
      {band({ left: 0, right: 0, top: bottom, bottom: 0 })}
      {band({ left: 0, width: Math.max(0, lit.left), top: lit.top, height: lit.height })}
      {band({ left: right, right: 0, top: lit.top, height: lit.height })}
    </>
  );
}

/** A step's measurement, stamped with the step it was taken for. */
interface Seen { step: ShowStep; box: Box | null; done: boolean }

/** A try of one step, at its index: the interface right after the step's pose (or as the step last
 *  started afresh), the last reading, whether the visitor's hand has acted yet (until it has, the
 *  cameras it started from follow any glide still running) and whether Fit ran. */
interface Attempt { step: ShowStep; index: number; from: TourWatch; last: TourWatch; engaged: boolean; fit: boolean }

export function ShowMe({ card, step: index, onStepOn, onBack }: {
  card: TourCard;
  step: number;
  /** Moves on from step `index`, or back to the card after the last. */
  onStepOn: (index: number) => void;
  onBack: () => void;
}) {
  const t = useReadingT();
  const inputMode = useCurrentInputMode();
  const steps = card.show ?? [];
  const at = steps[index] ?? null;
  const forInput = (s: ShowStep) => !s.input || s.input === inputMode;
  // A step for the other input mode is passed over as it comes up.
  const step = at && forInput(at) ? at : null;
  const offered = steps.filter(forInput);
  const trying = !!step?.done;
  const reduced = useReducedMotionConfig() === true;
  const chrome = useGlidingChromeScale();
  const { zoom, weights } = useGlidingChromeLift(NOTICE_CONTROL);
  const { w: viewportW, h: viewportH } = useViewportSize();
  const poseTour = useEditorStore((s) => s.poseTour);
  const eventBus = useEditorStore((s) => s.eventBus);
  const uiZoom = useEditorStore((s) => s.uiZoom);
  const [seen, setSeen] = useState<Seen | null>(null);
  const frame = useRef<number | null>(null);
  /** The chrome's morph pass the targets are followed through, or 0 with none running. */
  const morphPass = useRef(0);
  const [following, setFollowing] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const [calloutH, setCalloutH] = useState(160);

  // A try leaves the keyboard to the map, so its keys move, zoom and switch as they always do.
  useOverlayLock(!trying);
  // The step's pose lands before its targets are measured, which is what puts its bar in the DOM.
  // Its try belongs to it alone and starts from what the pose showed: no change the pose makes is
  // read against the step before it.
  const attempt = useRef<Attempt | null>(null);
  useLayoutEffect(() => {
    attempt.current = null;
    if (step?.pose) poseTour(step.pose);
    if (step?.done) {
      const from = readTourWatch();
      attempt.current = { step, index, from, last: from, engaged: false, fit: false };
    }
  }, [step, index, poseTour]);
  useLayoutEffect(() => { if (at && !step) onStepOn(index); }, [at, step, onStepOn, index]);

  // One read per frame until two agree or the cap, the ring following a target still animating in;
  // a target not yet shown is waited for while the document still changes (a bar or a chunk arriving).
  const track = useCallback(() => {
    if (frame.current != null) cancelAnimationFrame(frame.current);
    if (!step) return;
    let prev: Box | null | undefined;
    let frames = 0;
    const began = performance.now();
    let changedAt = began;
    const arrivals = typeof MutationObserver === 'undefined' ? null : new MutationObserver(() => { changedAt = performance.now(); });
    arrivals?.observe(document.body, { childList: true, subtree: true });
    const stop = (): void => { frame.current = null; arrivals?.disconnect(); };
    const read = (): void => {
      // Between the morph's measure and its play the new arrangement stands undrawn: wait for the frame
      // that draws its pieces where they stood.
      if (pageUndrawn()) { frame.current = requestAnimationFrame(read); return; }
      const now = measureTargets(step.ring) ?? (step.or ? measureTargets(step.or) : null);
      frames += 1;
      const still = prev !== undefined && sameBox(prev, now);
      const at = performance.now();
      const absentFor = now ? 0 : Math.min(at - changedAt, at - began);
      const given = now ? (still && frames >= TRACK_MIN_FRAMES) || frames >= TRACK_MAX_FRAMES
        : absentFor >= ABSENT_QUIET_MS || at - began >= ABSENT_MAX_MS;
      const done = !morphPass.current && given;
      if (now && !still) setSeen({ step, box: now, done });
      if (done) {
        stop();
        if (!now) setSeen({ step, box: null, done: true });
        else setSeen((s) => (s?.step === step ? { ...s, done: true } : s));
        return;
      }
      prev = now;
      frame.current = requestAnimationFrame(read);
    };
    frame.current = requestAnimationFrame(read);
    stopTrack.current = stop;
  }, [step]);
  const stopTrack = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    setSeen((s) => (s?.step === step ? s : null));
    track();
    return () => { if (frame.current != null) cancelAnimationFrame(frame.current); stopTrack.current(); };
  }, [track, step]);
  const onGeometry = useCallback(() => { if (frame.current == null) track(); }, [track]);
  /** `event` is the hand's input (`undefined` for a key), `false` a change it did not make, and
   *  `'fit'` Fit run by its button or its key. */
  const check = (event?: PointerEvent | WheelEvent | false | 'fit'): void => {
    const a = attempt.current;
    if (!a?.step.done) return;
    const now = readTourWatch();
    if (event === 'fit') a.fit = true;
    if (event !== false) {
      a.engaged = true;
    } else if (!a.engaged) {
      a.from = { ...a.from, camera2d: now.camera2d, fit2d: now.fit2d, camera3d: now.camera3d };
    }
    // A view whose camera stood only after the hand acted (the 3D scene building) starts from its first reading.
    if (!a.from.camera2d && now.camera2d) a.from = { ...a.from, camera2d: now.camera2d, fit2d: now.fit2d };
    if (!a.from.camera3d && now.camera3d) a.from = { ...a.from, camera3d: now.camera3d };
    if (a.step.rebase?.(a.last, now)) a.from = now;
    a.last = now;
    if (pressing() || now.building || !a.step.done(a.from, now, { fit: a.fit })) return;
    attempt.current = null;
    onStepOn(a.index);
  };
  // What a try changes can move its controls too (a folded row unfolding, a bar arriving).
  const pressing = useTourWatch(trying, { changed: () => { check(false); onGeometry(); }, input: (e) => check(e), fit: () => check('fit') });
  useEffect(() => {
    window.addEventListener('resize', onGeometry);
    eventBus.on('viewport-changed', onGeometry);
    return () => { window.removeEventListener('resize', onGeometry); eventBus.off('viewport-changed', onGeometry); };
  }, [onGeometry, eventBus]);
  useEffect(() => { onGeometry(); }, [uiZoom, onGeometry]);
  // A switch or a turn re-arranges the chrome without a resize: the ring and the callout follow their
  // targets on every frame of the morph until it settles, the callout carried from its old size as a
  // piece of the morph, and the way back too.
  useEffect(() => onMorph((run) => {
    const pass = ++morphPass.current;
    setFollowing(true);
    // The pass draws its pieces where they stood before this frame paints: the ring is read there in
    // the same frame, so it never stands a frame on the arrangement the window left.
    queueMicrotask(() => {
      if (!step || pageUndrawn() || morphPass.current !== pass) return;
      const box = measureTargets(step.ring) ?? (step.or ? measureTargets(step.or) : null);
      if (box) flushSync(() => setSeen((s) => (s?.step === step ? { ...s, box } : s)));
    });
    track();
    void run.settled.then(() => {
      if (morphPass.current !== pass) return;
      morphPass.current = 0;
      setFollowing(false);
      track();
    });
  }), [track, step]);
  const calloutPiece = useMorph('tour-callout');

  // A step whose controls never showed is passed over, the last one ending the Show me. A step on the
  // map stands without its ring (no control for it, as touch has none to turn or zoom by).
  const measured = !!step && !!seen && seen.step === step;
  const missing = step != null && step.ring.length > 0 && !step.map && measured && seen!.done && seen!.box === null;
  useEffect(() => { if (missing) onStepOn(index); }, [missing, onStepOn, index]);

  const ready = step != null && (step.ring.length === 0 || (measured && (seen!.box !== null || (!!step.map && seen!.done))));
  // It is the foreground surface once its step stands, over any window the step opened, so Escape
  // returns to the card; during a try, Escape the map has a use for (a carried card, an armed item,
  // a selection, a gesture being drawn) goes to the map. A pointing step holds the keyboard too, Tab
  // staying within the callout, the ring and the way back; a try leaves it to the map.
  const onEscape = (): void => { if (!trying || !escapeOnMap()) onBack(); };
  useSurfaceScope({ open: ready, root, onClose: onEscape, focus: trying ? 'none' : 'contain' });
  const calloutRef = useRef<HTMLDivElement>(null);
  useObservedSize(() => calloutRef.current, ([el]) => { if (el!.offsetHeight > 0) setCalloutH(el!.offsetHeight); }, [index, ready]);

  const lit = step && ready && seen?.step === step && seen.box ? litBox(seen.box) : null;
  if (!step) return null;
  const viewport = { width: viewportW, height: viewportH };
  const placed = lit ? placeBeside(lit, { width: CALLOUT_W * zoom, height: calloutH * zoom }, step.side, GAP, viewport) : null;
  const position: CSSProperties = placed
    ? { left: placed.left / zoom, top: placed.top / zoom }
    : { left: (viewportW / 2) / zoom - CALLOUT_W / 2, top: Math.max(VIEWPORT_MARGIN, viewportH * 0.18) / zoom };
  const last = offered[offered.length - 1] === step;
  const count = t('tour.progress', { n: offered.indexOf(step) + 1, total: offered.length });
  const text = t(step.textKey);

  return (
    <div ref={root}>
      <TourDim lit={lit} reduced={reduced} chrome={chrome} following={following} clear={!!step.map} />
      {!step.map && <TourBlock lit={lit} />}
      {ready && (
        <motion.div
          key={`${card.kind}:${step.id}`}
          ref={calloutRef}
          {...calloutPiece}
          role="dialog"
          aria-label={text}
          data-testid="tour-callout"
          initial={reduced ? false : { opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={reduced ? NO_MOTION : framerMotion('tour.card.pop')}
          style={{
            position: 'fixed', ...position, zIndex: z.tour, zoom, ...weights, width: CALLOUT_W, boxSizing: 'border-box',
            maxHeight: (viewportH - 2 * VIEWPORT_MARGIN) / zoom, overflowY: 'auto',
            background: skin.plate, border: PANEL_EDGE, borderRadius: radii.lg, padding: '14px 16px',
            display: 'flex', flexDirection: 'column', gap: 10, color: skin.ink,
          }}
        >
          <span style={{ ...roleFont('head'), lineHeight: 1.4 }}>{text}</span>
          {/* The count, then the way back and the way on; the buttons take a row of their own where the words need it. */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, minHeight: 36 }}>
            <span style={{ ...roleFont('chip'), color: skin.muted }}>{count}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginInlineStart: 'auto' }}>
              <ActionButton appearance="tertiary" onClick={onBack} style={{ flex: 'none', padding: '8px 10px' }}>
                {t('tour.back_to_tips')}
              </ActionButton>
              <ActionButton appearance="primary" autoFocus={!trying} onClick={() => onStepOn(index)} style={{ flex: 'none', padding: '8px 18px' }}>
                {last ? t('tour.done') : t('tour.next')}
              </ActionButton>
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}
