import { framerMotion, NO_MOTION } from '../design/motion';
import { helpAttributes, type HelpTarget } from './help-target';
import { SUPPORTS_CSS_MIN } from '../../platform/build/edition';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import { WindowPartsProvider } from './Window';
import { SurfaceZoomProvider } from '../design/scale';
import { createContext, memo, useCallback, useContext, useEffect, useId, useRef, useLayoutEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence, useReducedMotionConfig, useIsPresent, type MotionProps } from 'framer-motion';
import { cozyOverlay, visuallyHidden } from '../design/styles';
import { cozyPanel, WINDOW_ICON_BUTTON } from '../design/window-skin';
import { useViewportSize } from '../design/scale';
import { useGlidingChromeLift } from './chrome-layer';
import { useLayoutShape } from '../design/input-mode';
import { useOverlayLock } from './use-overlay-lock';
import { useOpenCount } from './use-open-count';
import { SurfaceOwner, useSurfaceScope, focusableWithin } from './surface-scope';
import { useUiPreview } from '../design/preview';
import { useMorph } from './morph';

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

/** The room a card capped at `capW` percent of a window `windowW` wide gives its content at chrome
 *  zoom `chrome`, in card px, its padding and border `frameX` across. */
export function cappedRoom(capW: number, windowW: number, chrome: number, frameX: number): number {
  return (capW / 100 * windowW) / chrome - frameX;
}

/** The width cap of a window that sizes its own width (`size="panel"`), in percent of the window. */
export const PANEL_CAP_W = WINDOW_SIZES.panel.cap.w;

/** The preset every window but a confirmation takes on an upright screen, in window px: the full width
 *  less `side` at each edge, between `top` and `bottom` off the window's edges. A window that names a
 *  height fills that span; any other stands centred in it at most that tall. */
const PORTRAIT_WINDOW = { side: 8, top: 48, bottom: 16 } as const;

/** The widest a window's card may stand, in its own css px, or null for a window without a width cap. */
const WindowRoom = createContext<{ room: number | null; fixed: number | null; settled: number | null }>({ room: null, fixed: null, settled: null });

/** The room `ModalShell` gives the card it draws: the upright preset's width, or the width cap. A
 *  window that sizes its card to its own layout reads this rather than measuring that card. */
export function useWindowRoom(): number | null {
  return useContext(WindowRoom).room;
}

/** The card's inner width, in card px with its padding and border taken off, while the upright preset
 *  fixes it to the window; null while the card follows its content. A width in the window's own
 *  `cardStyle` overrides the preset and makes this value wrong. A view that sets its own px width
 *  takes this one when it is set, or it stands narrower than the card. */
export function useWindowFixedWidth(): number | null {
  return useContext(WindowRoom).fixed;
}

/** The inner width, in card px, a card morphing between sizes (`motionSize`) is landing at, which a
 *  layout choice reads in place of the width the card passes through on its way; null for a card
 *  that does not morph. */
export function useWindowSettledWidth(): number | null {
  return useContext(WindowRoom).settled;
}

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
  /** Morphing card (ShareWindow's sections). When provided, the card's width
   *  and height become Framer-animated values animating to these numbers, so a
   *  view whose size differs from the previous one makes the whole card morph
   *  as one motion while its content cross-fades inside (the card already clips
   *  via `overflow:hidden` in `cardStyle`). Size rides on `initial` too, so the
   *  first open mounts at these values instead of tweening to them from the
   *  content's own width. `cap` still applies as a hard CSS cap on top. Omit
   *  for a static card (every other modal). */
  motionSize?: { width: number; height: number };
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
  /** Strips the shell down to chrome only (backdrop, card, sizing, motion): no `shellStack`
   *  membership, no Escape handling, no focus trap, no opener-focus capture/restore. Pair with
   *  `lockOverlay={false}` and a click-through `backdropStyle` for a state that is not yet a
   *  decision. */
  passive?: boolean;
  /** Node — or a render function receiving the live `exiting` flag so a nested
   *  `AnimatePresence` can suppress its own exits during a shell close. */
  children: ModalShellChildren;
}

/** One-unit exit: a modal with a nested `AnimatePresence` (HelpModal's page turns) must
 *  not run its inner element exits while the whole shell is closing, or the content fades or slides
 *  on its own timeline and floats free of the card. Rendered inside the shell's `AnimatePresence`,
 *  this reads the outer presence (framer re-renders the exiting subtree with `isPresent=false` the
 *  moment the shell starts its exit) and hands the `exiting` flag to a render-prop `children`, so
 *  a nested tree can gate its `exit` on it. Memoised: the card re-renders on each frame of a scale glide
 *  and the content does not depend on it. */
const ShellChildren = memo(function ShellChildren({ children }: { children: ModalShellChildren }) {
  const exiting = !useIsPresent();
  return <>{typeof children === 'function' ? children(exiting) : children}</>;
});

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
 *  own size) waits for that resize to complete, which calls `onEntered` again, or for the next commit
 *  where the card does not move (an upright card fills the window whatever size is asked); a key that has
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
  return <ModalShellBody {...preset} {...props} cap={props.cap ?? preset.cap} fillsUpright={size !== 'confirm'} />;
}

function ModalShellBody({ fillsUpright,
  helpTarget, open, onClose: onCloseProp, onEntered, width, height, cap, motionSize,
  cardStyle, backdropStyle, lockOverlay = true, ariaLabel, ariaLabelledBy, ariaDescribedBy, testId,
  passive: passiveProp = false, dismissible = true, children,
}: ModalShellProps & { fillsUpright: boolean }) {
  const onClose = useCallback(() => { if (dismissible) onCloseProp(); }, [dismissible, onCloseProp]);
  const preview = useUiPreview();
  const passive = passiveProp || preview;
  useOverlayLock(open && lockOverlay && !preview); // suppress map keyboard shortcuts while the modal is foregrounded (see `lockOverlay`)
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

  const tree = (
    <AnimatePresence>
      {open && (
        <ModalCard key="card" {...{
          helpTarget, open, onClose, onEntered, width, height, cap, cardStyle, backdropStyle,
          ariaLabel, ariaLabelledBy, ariaDescribedBy, testId, preview, passive, fillsUpright, cardRef, startSentinelRef,
          endSentinelRef, focusableItems, scope, session, overlayMotion, prefersReduced, motionSize, children,
        }} />
      )}
    </AnimatePresence>
  );
  // The shell stands on the document body, so a window opened from inside another window's zoomed card
  // is drawn at its own chrome zoom rather than at both multiplied. A pictured shell stays in its figure.
  return preview || typeof document === 'undefined' ? tree : createPortal(tree, document.body);
}

/** The open window: everything that reads the scale and the window size, mounted only while the window
 *  stands (or leaves), so a closed window hears no resize or scale change. */
function ModalCard({ helpTarget, open, onClose, onEntered, width, height, cap, cardStyle, backdropStyle,
  ariaLabel, ariaLabelledBy, ariaDescribedBy, testId, preview, passive, fillsUpright, cardRef, startSentinelRef, endSentinelRef,
  focusableItems, scope, session, overlayMotion, prefersReduced, motionSize, children,
}: Pick<ModalShellProps, 'helpTarget' | 'open' | 'onEntered' | 'width' | 'height' | 'cap'
  | 'cardStyle' | 'backdropStyle' | 'ariaLabel' | 'ariaLabelledBy' | 'ariaDescribedBy' | 'testId' | 'motionSize' | 'children'> & {
  onClose: () => void;
  preview: boolean;
  passive: boolean;
  fillsUpright: boolean;
  cardRef: RefObject<HTMLDivElement>;
  startSentinelRef: RefObject<HTMLDivElement>;
  endSentinelRef: RefObject<HTMLDivElement>;
  focusableItems: () => HTMLElement[];
  scope: ReturnType<typeof useSurfaceScope>;
  session: number;
  overlayMotion: Pick<MotionProps, 'initial' | 'animate' | 'exit' | 'transition'>;
  prefersReduced: boolean | null;
}) {
  // In touch mode a window draws at least at the zoom that brings its header icon controls to a
  // fingertip. Published on the card, the one element that carries the surface's `zoom`, with the
  // weights resolved for it; every token and label inside inherits them.
  const { zoom: chrome, weights } = useGlidingChromeLift(preview ? undefined : WINDOW_ICON_BUTTON);
  // A piece of the chrome's morph, so an input-mode switch carries the card to its new size: its
  // outline exactly, though its content re-flows to another shape.
  const morph = useMorph(`window-${useId()}`, 'card');
  const fills = useLayoutShape() === 'portrait' && !preview && fillsUpright;
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
  }, [open, cardStyle, cardRef]);

  // Caps bound the live window only: a pictured card stands in a figure, not the viewport.
  const fillW = (windowW - 2 * PORTRAIT_WINDOW.side) / chrome - frame.x;
  const fillH = (windowH - PORTRAIT_WINDOW.top - PORTRAIT_WINDOW.bottom) / chrome - frame.y;
  const capRoom = cap?.w != null ? cappedRoom(cap.w, windowW, chrome, frame.x) : undefined;
  const capW = fills ? fillW : !preview ? capRoom : undefined;
  const capH = fills ? fillH : !preview && cap?.h != null ? (cap.h / 100 * windowH) / chrome - frame.y : undefined;
  const tall = height != null || motionSize != null;
  const resolvedWidth = fills ? fillW : resolveDim(width, capW);
  const resolvedHeight = fills ? (tall ? fillH : undefined) : resolveDim(height, capH);
  const sized = fills && motionSize ? { width: fillW, height: fillH } : motionSize;
  // A pictured window has no caps but chooses its layout for the window its figure poses.
  const room = capW ?? capRoom ?? null;
  // The height the card may take, in its own px, which decides whether its head starts tucked.
  const partsRoom = capH ?? fillH;
  const fixedWidth = fills ? fillW : null;
  const settledWidth = sized ? Math.min(sized.width, capW ?? Infinity) : null;
  const roomValue = useMemo(() => ({ room, fixed: fixedWidth, settled: settledWidth }), [room, fixedWidth, settledWidth]);

  // A `motionSize` change the card does not follow (an upright card fills the window whatever size
  // is asked) starts no animation, so no completion reports it: the card has entered for it at once.
  const entrance = useRef(false);
  const asked = motionSize ? `${motionSize.width}x${motionSize.height}` : '';
  const drawn = sized ? `${sized.width}x${sized.height}` : '';
  const lastAsk = useRef({ asked, drawn });
  useEffect(() => {
    const last = lastAsk.current;
    lastAsk.current = { asked, drawn };
    if (last.asked !== asked && last.drawn === drawn && entrance.current) onEntered?.();
  }, [asked, drawn, onEntered]);

  // Morphing card: with `motionSize` the card's width and height ride on `animate` (and on `initial`,
  // so the first open mounts at the size rather than tweening to it) on `modal.resize`, while
  // `surface.arrive` keeps scale and y.
  const sizeAnim = sized ? { width: sized.width, height: sized.height } : {};
  const sizeTransition = framerMotion('modal.resize');

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
        transition: sized
          ? { default: framerMotion('surface.arrive'), width: sizeTransition, height: sizeTransition }
          : framerMotion('surface.arrive'),
      };

  const card: CSSProperties = {
    ...cozyPanel,
    zoom: preview ? 1 : chrome,
    ...weights,
    // With `motionSize`, framer owns width/height on `animate` — omit the static
    // ones so they don't fight the animated values (maxHeight still caps).
    ...(sized == null && resolvedWidth != null ? { width: resolvedWidth } : {}),
    ...(sized == null && resolvedHeight != null ? { height: resolvedHeight } : {}),
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

  const uprightBackdrop: CSSProperties = fills
    ? {
        paddingTop: PORTRAIT_WINDOW.top, paddingBottom: PORTRAIT_WINDOW.bottom,
        paddingLeft: PORTRAIT_WINDOW.side, paddingRight: PORTRAIT_WINDOW.side,
      }
    : {};

  return (
    <motion.div {...helpAttributes(helpTarget)} style={{ ...cozyOverlay, ...uprightBackdrop, ...previewBackdrop, ...backdropStyle }}
      onClick={onClose} {...overlayMotion}>
      <motion.div
        ref={cardRef}
        style={card}
        {...morph}
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
          if (open && typeof target === 'object' && 'scale' in target && target.scale === 1) { entrance.current = true; onEntered(); }
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
        <SurfaceOwner.Provider value={scope}>
          <WindowRoom.Provider value={roomValue}>
            <SurfaceZoomProvider value={chrome}>
              <WindowPartsProvider key={session} card={cardRef} room={partsRoom}><ShellChildren>{children}</ShellChildren></WindowPartsProvider>
            </SurfaceZoomProvider>
          </WindowRoom.Provider>
        </SurfaceOwner.Provider>
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
  );
}
