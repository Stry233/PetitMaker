import { framerMotion, NO_MOTION } from '../design/motion';
import { helpAttributes, type HelpTarget } from './help-target';
import { SUPPORTS_CSS_MIN } from '../../core/runtime/edition';
import type { CSSProperties, ReactNode } from 'react';
import { createContext, useCallback, useContext, useEffect, useRef, useLayoutEffect, useState } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig, useIsPresent, type Transition } from 'framer-motion';
import { cozyOverlay, springs, exitTransition } from '../design/styles';
import { cozyPanel } from '../design/window-skin';
import { useChromeScale, useViewportSize, useWeightVars } from '../design/scale';
import { useOverlayLock } from '../hooks/useOverlayLock';
import { SurfaceOwner, useSurfaceScope, focusableWithin } from './surface-scope';

/**
 * Shared cozy modal boilerplate — the ONE place that owns the dimmed backdrop,
 * the cream card, the enter/exit choreography, and the chrome-zoom +
 * overlay-lock plumbing, so no modal hand-rolls them.
 *
 * Sizing. Viewport shares are taken from the MEASURED window (`useViewportSize`), never from `vh`:
 * mobile browsers define `vh` by the largest viewport, the one with their bars hidden, so a `vh`
 * cap hangs past the visible bottom while the bars show. Every share divides the chrome `zoom`
 * back out, since `zoom` multiplies it.
 *  - `width` / `height`: a NUMBER is used as-is (px; `zoom` scales it). A STRING
 *    is passed straight through.
 *  - `maxVwPct` + numeric `width` → responsive `min(<width>px, <pct of the window's width>px)`.
 *  - `maxVhPct` + numeric `height` → responsive `min(<height>px, <pct of the window's height>px)`.
 *  - `maxVh` → `maxHeight` at that share of the window's height (a cap without a fixed height).
 * `cardStyle` is spread LAST so a modal can layer on padding / flex / relative
 * positioning (Export's 2-col layout, Help's clipped scroll frame, …).
 */
/** PREVIEW MODE: a shell mounted as a PICTURE of itself (the Help Center's figures). Under this
 *  context the shell is passive and self-contained: no overlay lock, no shell-stack membership, no
 *  focus capture; the backdrop positions absolutely inside the provider's frame instead of over the
 *  window (no blur, no dock padding, no overlay z); the card drops its own chrome `zoom` (the
 *  frame's ancestor card already carries one — nested zooms square) and its viewport-unit caps,
 *  which are meaningless inside a small frame. */
export const ModalPreviewContext = createContext(false);

type ModalShellChildren = ReactNode | ((exiting: boolean) => ReactNode);

// Card-sized travel needs a tween: spring overshoot grows with the distance between sections.
export const SIZE_MORPH_TWEEN: Transition = { ...framerMotion('modal.resize'), type: 'tween' };

export interface ModalShellProps {
  helpTarget?: HelpTarget;
  open: boolean;
  onClose: () => void;
  /** Starts optional content work once the card's entrance has settled. */
  onEntered?: () => void;
  width?: number | string;
  height?: number | string;
  maxVwPct?: number;
  maxVhPct?: number;
  maxVh?: number;
  /** Hard `max-width` cap in vw units, chrome-zoom-normalized like `maxVh`, and like `maxVh`
   *  applied UNCONDITIONALLY — so it works alongside `motionSize`, unlike `maxVwPct`, which only
   *  feeds the static `width` that `motionSize` bypasses. */
  maxVw?: number;
  /** MORPHING CARD (AboutModal's A↔B window). When provided, the card's width
   *  AND height become Framer-animated values animating to these numbers, so a
   *  view whose size differs from the previous one makes the whole card morph
   *  as one motion while its content cross-fades inside (the card already clips
   *  via `overflow:hidden` in `cardStyle`). Size rides on `initial` too, so the
   *  FIRST open mounts at these values instead of tweening to them from the
   *  content's own width. `maxVh` still applies as a hard CSS cap on top. Omit
   *  for a static card (every other modal). */
  motionSize?: { width: number; height: number };
  /** Snap the size change instantly (no animation) — used by the consumer for the
   *  first post-mount measurement, before any real morph should animate. Reduced
   *  motion also forces instant regardless. */
  sizeInstant?: boolean;
  /** The morph transition for width/height (defaults to `SIZE_MORPH_TWEEN`). Scale/y
   *  keep their own `springs.stiff` entrance regardless. */
  sizeSpring?: Transition;
  cardStyle?: CSSProperties;
  /** Style overrides merged onto the BACKDROP, after `cozyOverlay`. Omit for the plain
   *  dim/blur/click-to-close backdrop. */
  backdropStyle?: CSSProperties;
  /** Whether this shell suppresses global map keyboard shortcuts (`useOverlayLock`) while open.
   *  Defaults to `true`, i.e. the whole `open` span. */
  lockOverlay?: boolean;
  /** Accessible name for the dialog. Pass one of `ariaLabel` (a literal string,
   *  e.g. the modal's translated title) or `ariaLabelledBy` (the id of a
   *  visible heading inside the card). Threaded onto `role="dialog"`. */
  ariaLabel?: string;
  ariaLabelledBy?: string;
  /** Strips the shell down to chrome only (backdrop, card, sizing, motion): no `shellStack`
   *  membership, no Escape handling, no focus trap, no opener-focus capture/restore. Pair with
   *  `lockOverlay={false}` and a click-through `backdropStyle` for a state that is not yet a
   *  decision. */
  passive?: boolean;
  /** Node — or a render function receiving the live `exiting` flag so a nested
   *  `AnimatePresence` can suppress its own exits during a shell close. */
  children: ModalShellChildren;
}

/** ONE-UNIT EXIT: a modal with a nested `AnimatePresence` (e.g. AboutModal's A↔B drill-in) must
 *  NOT run its inner element exits while the whole shell is closing, or the content fades or slides
 *  on its own timeline and floats free of the card. Rendered INSIDE the shell's `AnimatePresence`,
 *  this reads the outer presence (framer re-renders the exiting subtree with `isPresent=false` the
 *  moment the shell starts its exit) and hands the `exiting` flag to a render-prop `children`, so
 *  a nested tree can gate its `exit` on it. */
function ShellChildren({ children }: { children: ModalShellChildren }) {
  const exiting = !useIsPresent();
  return <>{typeof children === 'function' ? children(exiting) : children}</>;
}

function resolveDim(
  px: number | string | undefined,
  pct: number | undefined,
  chrome: number,
  windowPx: number,
  frame: number,
): number | string | undefined {
  if (typeof px === 'string') return px;
  if (px == null) return undefined;
  if (pct == null) return px; // plain number — the card's `zoom` scales it
  if (!SUPPORTS_CSS_MIN) return Math.min(px, (pct / 100 * windowPx) / chrome - frame);
  return `min(${px}px, ${(pct / 100 * windowPx) / chrome - frame}px)`;
}

// Visually hidden but still in the tab order — `display:none`/`visibility:
// hidden` would remove a node from tab order entirely, which would defeat
// the sentinel trap.
const sentinelStyle: CSSProperties = {
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

const NONE_SETTLED: ReadonlySet<unknown> = new Set();

/** Whether a ModalShell's card has settled for `resetKey` since `open` last turned on: pass
 *  `onEntered` to the shell. A key reached for the first time (a section whose card morphs to its
 *  own size) waits for that resize to complete, which calls `onEntered` again; a key that has
 *  settled once stays settled until the window closes, so returning to it keeps its built work.
 *  Under reduced motion the card is settled as soon as it is open. `hasSettled` answers for any key,
 *  for a hidden section whose own state must not follow the one on screen. */
export function useModalEntered(open: boolean, resetKey: unknown = null): { entered: boolean; onEntered: () => void; hasSettled: (key: unknown) => boolean } {
  const reduced = useReducedMotionConfig() === true;
  const [settled, setSettled] = useState<ReadonlySet<unknown>>(NONE_SETTLED);
  const keyRef = useRef(resetKey);
  keyRef.current = resetKey;
  const onEntered = useCallback(() => setSettled((keys) => (keys.has(keyRef.current) ? keys : new Set(keys).add(keyRef.current))), []);
  useEffect(() => { if (!open) setSettled(NONE_SETTLED); }, [open]);
  const hasSettled = useCallback((key: unknown) => open && (reduced || settled.has(key)), [open, reduced, settled]);
  return { entered: hasSettled(resetKey), onEntered, hasSettled };
}

export function ModalShell({ helpTarget, open, onClose, onEntered, width, height, maxVwPct, maxVhPct, maxVh, maxVw, motionSize, sizeInstant, sizeSpring, cardStyle, backdropStyle, lockOverlay = true, ariaLabel, ariaLabelledBy, passive: passiveProp = false, children }: ModalShellProps) {
  const preview = useContext(ModalPreviewContext);
  const passive = passiveProp || preview;
  useOverlayLock(open && lockOverlay && !preview); // suppress map keyboard shortcuts while the modal is foregrounded (see `lockOverlay`)
  const chrome = useChromeScale();
  const { w: windowW, h: windowH } = useViewportSize();
  // The caps bound the whole card. A content-box card grows by its padding and border on top of a
  // cap, so that frame is measured once the card stands and taken off; a border-box card needs none.
  const [frame, setFrame] = useState({ x: 0, y: 0 });
  useLayoutEffect(() => {
    const el = cardRef.current;
    if (!el) return;
    const cs = getComputedStyle(el);
    const sum = (...lengths: string[]) => lengths.reduce((total, v) => total + (parseFloat(v) || 0), 0);
    const next = cs.boxSizing === 'border-box'
      ? { x: 0, y: 0 }
      : {
        x: sum(cs.paddingLeft, cs.paddingRight, cs.borderLeftWidth, cs.borderRightWidth),
        y: sum(cs.paddingTop, cs.paddingBottom, cs.borderTopWidth, cs.borderBottomWidth),
      };
    setFrame((f) => (f.x === next.x && f.y === next.y ? f : next));
  }, [open, cardStyle]);
  // Published on the card, the one element that carries the surface's `zoom` — so the weights and
  // the zoom they were resolved for cannot come apart. Every token and label inside inherits them.
  const weights = useWeightVars();
  const prefersReduced = useReducedMotionConfig();
  useEffect(() => {
    if (open && prefersReduced) onEntered?.();
  }, [open, prefersReduced, onEntered]);

  const cardRef = useRef<HTMLDivElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const scope = useSurfaceScope({ open: open && !passive, root: cardRef, onClose, focus: 'contain' });
  const focusableItems = () => cardRef.current ? focusableWithin(cardRef.current) : [];

  const resolvedWidth = resolveDim(width, maxVwPct, chrome, windowW, frame.x);
  const resolvedHeight = resolveDim(height, maxVhPct, chrome, windowH, frame.y);

  // ONE-UNIT EXIT. Opacity lives on the BACKDROP, not the card: the dim, the
  // card, and ALL card content then fade together (child opacity multiplies
  // down from the backdrop, so a single fade authority = perfect lockstep).
  // The card layers ONLY scale/drop on top — giving it its own opacity too
  // would fade it faster than the dim (squared) and desync the exit. The
  // backdrop is a motion element sharing the card's exit timing so the dim
  // never hard-cuts while the card is still fading.
  const overlayMotion = prefersReduced
    ? {
        initial: { opacity: 1 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: NO_MOTION },
        transition: NO_MOTION,
      }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: exitTransition },
        transition: springs.stiff,
      };

  // MORPHING CARD: when `motionSize` is set the card's width+height ride on `animate` (and on
  // `initial`, so the first open mounts AT the size rather than tweening to it) and animate on
  // `sizeSpring` (a calm tween by default — `SIZE_MORPH_TWEEN`'s comment has why).
  // `sizeInstant` (first measurement) and reduced motion collapse that transition
  // to a hard cut. `default` still owns scale/y so the entrance stays crisp
  // regardless of how the size morph is timed.
  const sizeAnim = motionSize ? { width: motionSize.width, height: motionSize.height } : {};
  const instantSize = sizeInstant || prefersReduced;
  const sizeTransition: Transition = instantSize ? NO_MOTION : (sizeSpring ?? SIZE_MORPH_TWEEN);

  const cardMotion = prefersReduced
    ? {
        initial: false as const,
        animate: sizeAnim,
        exit: {},
        transition: NO_MOTION,
      }
    : {
        // The size rides on `initial` as well as `animate`: a key present only on `animate` starts
        // from the DOM's own value at mount, which for a card is its content's auto width, and the
        // first open would tween from that to the declared size while the entrance is in flight.
        initial: { scale: 0.92, y: 10, ...sizeAnim },
        animate: { scale: 1, y: 0, ...sizeAnim },
        exit: { scale: 0.92, y: 10, transition: exitTransition },
        transition: motionSize
          ? { default: springs.stiff, width: sizeTransition, height: sizeTransition }
          : springs.stiff,
      };

  const card: CSSProperties = {
    ...cozyPanel,
    zoom: preview ? 1 : chrome,
    ...weights,
    // With `motionSize`, framer owns width/height on `animate` — omit the static
    // ones so they don't fight the animated values (maxHeight still caps).
    ...(motionSize == null && resolvedWidth != null ? { width: resolvedWidth } : {}),
    ...(motionSize == null && resolvedHeight != null ? { height: resolvedHeight } : {}),
    ...(!preview && maxVh != null ? { maxHeight: `${(maxVh / 100 * windowH) / chrome - frame.y}px` } : {}),
    ...(!preview && maxVw != null ? { maxWidth: `${(maxVw / 100 * windowW) / chrome - frame.x}px` } : {}),
    ...cardStyle,
  };

  const previewBackdrop: CSSProperties = preview
    ? {
        position: 'absolute',
        zIndex: 'auto',
        paddingLeft: 0,
        paddingRight: 0,
        backdropFilter: 'none',
        WebkitBackdropFilter: 'none',
      }
    : {};

  return (
    <AnimatePresence>
      {open && (
        <motion.div {...helpAttributes(helpTarget)} style={{ ...cozyOverlay, ...previewBackdrop, ...backdropStyle }} onClick={onClose} {...overlayMotion}>
          <motion.div
            ref={cardRef}
            style={card}
            {...helpAttributes(helpTarget)}
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
            onAnimationComplete={onEntered ? (target) => {
              if (open && typeof target === 'object' && 'scale' in target && target.scale === 1) onEntered();
            } : undefined}
          >
            {/* Minimal sentinel-div focus trap: reaching either end of the
                real content by Tab/Shift+Tab wraps to the other end, so
                keyboard focus can never escape the modal into the page
                behind it. Omitted entirely when `passive`: a focusable
                `aria-hidden` node with nothing to redirect to is invalid ARIA,
                and a passive view has no content it needs to trap focus in. */}
            {!passive && (
              <div
                ref={startSentinelRef}
                tabIndex={0}
                style={sentinelStyle}
                data-testid="modal-trap-start"
                aria-hidden="true"
                onFocus={() => {
                  const items = focusableItems();
                  items[items.length - 1]?.focus();
                }}
              />
            )}
            <SurfaceOwner.Provider value={scope}><ShellChildren>{children}</ShellChildren></SurfaceOwner.Provider>
            {!passive && (
              <div
                ref={endSentinelRef}
                tabIndex={0}
                style={sentinelStyle}
                data-testid="modal-trap-end"
                aria-hidden="true"
                onFocus={() => {
                  const items = focusableItems();
                  items[0]?.focus();
                }}
              />
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
