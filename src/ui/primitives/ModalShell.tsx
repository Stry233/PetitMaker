import { framerMotion, NO_MOTION } from '../design/motion';
import { helpAttributes, type HelpTarget } from './help-target';
import { SUPPORTS_CSS_MIN } from '../../platform/build/edition';
import type { CSSProperties, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotionConfig, useIsPresent, type Transition } from 'framer-motion';
import { cozyOverlay, visuallyHidden } from '../design/styles';
import { cozyPanel } from '../design/window-skin';
import { useChromeScale, useDenseScript, useDevicePixelRatio, useViewportSize } from '../design/scale';
import { weightVars } from '../design/text-weight';
import { useOverlayLock } from './use-overlay-lock';
import { useOpenCount } from './use-open-count';
import { SurfaceOwner, useSurfaceScope, focusableWithin } from './surface-scope';
import { useUiPreview } from '../design/preview';

/**
 * Shared modal boilerplate: the dimmed backdrop, the cream card, the enter and exit choreography, and
 * the chrome-zoom and overlay-lock plumbing.
 *
 * `width` / `height`: a number is px (`zoom` scales it); a string passes through. `cap` bounds the
 * card at shares of the measured window (`useViewportSize`), never `vh`, which mobile browsers size
 * with their bars hidden; each share divides the chrome `zoom` back out and holds under `motionSize`.
 * Inside a pictured subtree (`design/preview.tsx`) the shell is passive: no overlay lock, surface
 * ownership or focus capture; the backdrop stands in the figure, and the card drops its own `zoom`
 * (nested zooms multiply) and its window caps. `cardStyle` is spread last.
 */

type ModalShellChildren = ReactNode | ((exiting: boolean) => ReactNode);

// Card-sized travel needs a tween: spring overshoot grows with the distance between sections.
const SIZE_MORPH_TWEEN: Transition = { ...framerMotion('modal.resize'), type: 'tween' };

/** The card's largest size as percent shares of the measured window: `w` of its width, `h` of its height. */
export interface WindowCap { w?: number; h?: number }

/** The window sizes the app's windows share: a width in the card's px and a cap. A window's own
 *  `width`, `height` and `cap` override its preset's. */
const WINDOW_SIZES = {
  /** A confirmation card. */
  confirm: { width: 420, cap: { w: 94, h: 90 } },
  /** A reading or settings window that sizes its own width. */
  panel: { cap: { w: 94, h: 92 } },
  /** A column of prose, such as release notes: about as wide as About's document reader, so its lines
   *  hold under about 85 Latin characters or 40 CJK ones. */
  document: { width: 600, cap: { w: 94, h: 92 } },
  /** The two-pane export workspace. */
  workspace: { width: 980, height: 848, cap: { w: 94, h: 92 } },
  /** The keyboard board, which zooms its keys to the room it is given. */
  board: { cap: { w: 88, h: 86 } },
  /** The Help Center: a catalogue beside a reading column. */
  reader: { width: 1080, height: 720, cap: { w: 96, h: 92 } },
} as const satisfies Record<string, Pick<ModalShellProps, 'width' | 'height' | 'cap'>>;

export type WindowSize = keyof typeof WINDOW_SIZES;

export interface ModalShellProps {
  /** A shared size preset (`WINDOW_SIZES`); explicit size props win over it. */
  size?: WindowSize;
  /** False for a surface only its own control closes: no backdrop press and no Escape dismiss it. */
  dismissible?: boolean;
  helpTarget?: HelpTarget;
  open: boolean;
  onClose: () => void;
  /** Starts optional content work once the card's entrance has settled. */
  onEntered?: () => void;
  width?: number | string;
  height?: number | string;
  cap?: WindowCap;
  /** Morphing card (AboutModal's A↔B window). When provided, the card's width
   *  and height become Framer-animated values animating to these numbers, so a
   *  view whose size differs from the previous one makes the whole card morph
   *  as one motion while its content cross-fades inside (the card already clips
   *  via `overflow:hidden` in `cardStyle`). Size rides on `initial` too, so the
   *  first open mounts at these values instead of tweening to them from the
   *  content's own width. `cap` still applies as a hard CSS cap on top. Omit
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
  /** Style overrides merged onto the backdrop, after `cozyOverlay`. Omit for the plain
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
  /** The id of the element that describes the dialog. */
  ariaDescribedBy?: string;
  /** The card's test id. */
  testId?: string;
  /** Draws the card in css px at zoom 1 rather than at the chrome zoom, for a surface that must read at
   *  its own size whatever the interface's scale (the portrait guard on a phone). */
  unzoomed?: boolean;
  /** Strips the shell down to chrome only (backdrop, card, sizing, motion): no `shellStack`
   *  membership, no Escape handling, no focus trap, no opener-focus capture/restore. Pair with
   *  `lockOverlay={false}` and a click-through `backdropStyle` for a state that is not yet a
   *  decision. */
  passive?: boolean;
  /** Node — or a render function receiving the live `exiting` flag so a nested
   *  `AnimatePresence` can suppress its own exits during a shell close. */
  children: ModalShellChildren;
}

/** One-unit exit: a modal with a nested `AnimatePresence` (e.g. AboutModal's A↔B drill-in) must
 *  not run its inner element exits while the whole shell is closing, or the content fades or slides
 *  on its own timeline and floats free of the card. Rendered inside the shell's `AnimatePresence`,
 *  this reads the outer presence (framer re-renders the exiting subtree with `isPresent=false` the
 *  moment the shell starts its exit) and hands the `exiting` flag to a render-prop `children`, so
 *  a nested tree can gate its `exit` on it. */
function ShellChildren({ children }: { children: ModalShellChildren }) {
  const exiting = !useIsPresent();
  return <>{typeof children === 'function' ? children(exiting) : children}</>;
}

/** A static `width` or `height` held under its cap (`capPx`, css px in the card's zoom): a number
 *  is px, a string passes through. */
function resolveDim(px: number | string | undefined, capPx: number | undefined): number | string | undefined {
  if (typeof px === 'string' || px == null || capPx == null) return px;
  if (!SUPPORTS_CSS_MIN) return Math.min(px, capPx);
  return `min(${px}px, ${capPx}px)`;
}

// Visually hidden but still in the tab order, so the sentinel trap can catch focus.
const sentinelStyle = visuallyHidden;

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

export function ModalShell({ size, ...props }: ModalShellProps) {
  const preset: Pick<ModalShellProps, 'width' | 'height' | 'cap'> = size ? WINDOW_SIZES[size] : {};
  return <ModalShellBody {...preset} {...props} cap={props.cap ?? preset.cap} />;
}

function ModalShellBody({
  helpTarget, open, onClose: onCloseProp, onEntered, width, height, cap, motionSize, sizeInstant,
  sizeSpring, cardStyle, backdropStyle, lockOverlay = true, ariaLabel, ariaLabelledBy, ariaDescribedBy, testId, unzoomed = false,
  passive: passiveProp = false, dismissible = true, children,
}: ModalShellProps) {
  const onClose = useCallback(() => { if (dismissible) onCloseProp(); }, [dismissible, onCloseProp]);
  const preview = useUiPreview();
  const passive = passiveProp || preview;
  useOverlayLock(open && lockOverlay && !preview); // suppress map keyboard shortcuts while the modal is foregrounded (see `lockOverlay`)
  const liveChrome = useChromeScale();
  const chrome = unzoomed ? 1 : liveChrome;
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
  const weights = weightVars(chrome, useDevicePixelRatio(), useDenseScript());
  const prefersReduced = useReducedMotionConfig();
  useEffect(() => {
    if (open && prefersReduced) onEntered?.();
  }, [open, prefersReduced, onEntered]);

  // Each opening is a fresh session for the content, so a window's own state never carries over.
  const session = useOpenCount(open);

  const cardRef = useRef<HTMLDivElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const scope = useSurfaceScope({ open: open && !passive, root: cardRef, onClose, focus: 'contain' });
  const focusableItems = () => cardRef.current ? focusableWithin(cardRef.current) : [];

  // Caps bound the live window only: a pictured card stands in a figure, not the viewport.
  const capW = !preview && cap?.w != null ? (cap.w / 100 * windowW) / chrome - frame.x : undefined;
  const capH = !preview && cap?.h != null ? (cap.h / 100 * windowH) / chrome - frame.y : undefined;
  const resolvedWidth = resolveDim(width, capW);
  const resolvedHeight = resolveDim(height, capH);

  // One-unit exit. Opacity lives on the backdrop, not the card: the dim, the
  // card, and all card content then fade together (child opacity multiplies
  // down from the backdrop, so a single fade authority = perfect lockstep).
  // The card layers only scale/drop on top — giving it its own opacity too
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
        exit: { opacity: 0, transition: framerMotion('surface.leave') },
        transition: framerMotion('surface.arrive'),
      };

  // Morphing card: when `motionSize` is set the card's width+height ride on `animate` (and on
  // `initial`, so the first open mounts at the size rather than tweening to it) and animate on
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
        exit: { scale: 0.92, y: 10, transition: framerMotion('surface.leave') },
        transition: motionSize
          ? { default: framerMotion('surface.arrive'), width: sizeTransition, height: sizeTransition }
          : framerMotion('surface.arrive'),
      };

  const card: CSSProperties = {
    ...cozyPanel,
    zoom: preview ? 1 : chrome,
    ...weights,
    // With `motionSize`, framer owns width/height on `animate` — omit the static
    // ones so they don't fight the animated values (maxHeight still caps).
    ...(motionSize == null && resolvedWidth != null ? { width: resolvedWidth } : {}),
    ...(motionSize == null && resolvedHeight != null ? { height: resolvedHeight } : {}),
    ...(capH != null ? { maxHeight: `${capH}px` } : {}),
    ...(capW != null ? { maxWidth: `${capW}px` } : {}),
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

  const tree = (
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
            aria-describedby={ariaDescribedBy}
            data-testid={testId}
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
            <SurfaceOwner.Provider value={scope}><ShellChildren key={session}>{children}</ShellChildren></SurfaceOwner.Provider>
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
  // The shell stands on the document body, so a window opened from inside another window's zoomed card
  // is drawn at its own chrome zoom rather than at both multiplied. A pictured shell stays in its figure.
  return preview || typeof document === 'undefined' ? tree : createPortal(tree, document.body);
}
