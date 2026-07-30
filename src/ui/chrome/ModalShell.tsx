import type { CSSProperties, ReactNode } from 'react';
import { createContext, useContext, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig, useIsPresent, type Transition } from 'framer-motion';
import { cozyOverlay, cozyPanel, springs, exitTransition } from '../styles';
import { useChromeScale } from '../menu/scale';
import { useOverlayLock } from '../hooks/useOverlayLock';

/**
 * Shared cozy modal boilerplate — the ONE place that owns the dimmed backdrop,
 * the cream card, the enter/exit choreography, and the chrome-zoom +
 * overlay-lock plumbing, so no modal hand-rolls them.
 *
 * Sizing (all vw/vh lengths divide the chrome `zoom` back out, since `zoom`
 * multiplies them):
 *  - `width` / `height`: a NUMBER is used as-is (px; `zoom` scales it). A STRING
 *    is passed straight through.
 *  - `maxVwPct` + numeric `width` → responsive `min(<width>px, calc(<pct>vw / zoom))`.
 *  - `maxVhPct` + numeric `height` → responsive `min(<height>px, calc(<pct>vh / zoom))`.
 *  - `maxVh` → `maxHeight: <maxVh / zoom>vh` (a cap without a fixed height).
 * `cardStyle` is spread LAST so a modal can layer on padding / flex / relative
 * positioning (Export's 2-col layout, Help's clipped scroll frame, …).
 */
/** ONE-UNIT EXIT (see the render body): a modal with a nested `AnimatePresence`
 * (e.g. AboutModal's A↔B drill-in) must NOT run its inner element exits while
 * the whole shell is closing — otherwise the content fades/slides on its own
 * timeline and floats free of the card ("window background disappears before
 * the content"). `ModalExitingContext` carries the live shell-closing signal
 * DOWN into the card subtree (it flips true the moment the shell starts its
 * exit, because framer re-renders the exiting subtree with `isPresent=false`),
 * so a nested tree can gate its `exit` on it. Consume it either via
 * `useModalExiting()` or the render-prop `children` form `(exiting) => …`. */
const ModalExitingContext = createContext(false);
export function useModalExiting(): boolean {
  return useContext(ModalExitingContext);
}

export type ModalShellChildren = ReactNode | ((exiting: boolean) => ReactNode);

export interface ModalShellProps {
  open: boolean;
  onClose: () => void;
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
   *  AND height become Framer-animated values springing to these numbers, so a
   *  view whose size differs from the previous one makes the whole card morph
   *  as one motion while its content cross-fades inside (the card already clips
   *  via `overflow:hidden` in `cardStyle`). Size is put on `animate` only (never
   *  `initial`) so the FIRST open never morphs — framer starts the card at these
   *  values. `maxVh` still applies as a hard CSS cap on top. Omit for a static
   *  card (every other modal). */
  motionSize?: { width: number; height: number };
  /** Snap the size change instantly (no spring) — used by the consumer for the
   *  first post-mount measurement, before any real morph should animate. Reduced
   *  motion also forces instant regardless. */
  sizeInstant?: boolean;
  /** The morph spring for width/height (defaults to `springs.stiff`). Scale/y
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

/** Renders the card's children INSIDE the shell's `AnimatePresence`, so it can
 *  read the outer presence and publish the `exiting` flag to descendants. */
function ShellChildren({ children }: { children: ModalShellChildren }) {
  const exiting = !useIsPresent();
  return (
    <ModalExitingContext.Provider value={exiting}>
      {typeof children === 'function' ? children(exiting) : children}
    </ModalExitingContext.Provider>
  );
}

// Module-level open-shell stack: every mounted+open ModalShell
// pushes a stable token here; only the TOP token's instance consumes Escape, so
// a stacked modal (e.g. About opened over Settings) closes ONE layer per press
// instead of both at once. Overlay-click is already per-instance (each shell
// renders its own backdrop), so it needs no equivalent — this mirrors that
// "topmost only" behavior for the keyboard path.
const shellStack: symbol[] = [];

function resolveDim(
  px: number | string | undefined,
  pct: number | undefined,
  chrome: number,
  axis: 'vw' | 'vh',
): number | string | undefined {
  if (typeof px === 'string') return px;
  if (px == null) return undefined;
  if (pct == null) return px; // plain number — the card's `zoom` scales it
  return `min(${px}px, calc(${pct}${axis} / ${chrome}))`;
}

// Elements a Tab press can land on — used both to bound the focus trap and to
// find the trap's own first/last real target (sentinels excluded below).
const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

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

export function ModalShell({ open, onClose, width, height, maxVwPct, maxVhPct, maxVh, maxVw, motionSize, sizeInstant, sizeSpring, cardStyle, backdropStyle, lockOverlay = true, ariaLabel, ariaLabelledBy, passive = false, children }: ModalShellProps) {
  useOverlayLock(open && lockOverlay); // suppress map keyboard shortcuts while the modal is foregrounded (see `lockOverlay`)
  const chrome = useChromeScale();
  const prefersReduced = useReducedMotionConfig();

  const cardRef = useRef<HTMLDivElement>(null);
  const startSentinelRef = useRef<HTMLDivElement>(null);
  const endSentinelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const shellId = useRef<symbol>(Symbol('modal-shell'));

  // Keep the latest `onClose` in a ref so the Escape effect can read it without
  // re-subscribing (which would pop+re-push this shell onto `shellStack` on
  // every parent re-render and steal "topmost" from a modal stacked above it).
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape closes the modal — but ONLY the topmost open shell.
  // Every current ModalShell consumer (About, Settings, Help, NewProject,
  // Export, ExportJson, Import) treats `onClose` as a plain dismiss — none
  // guards it against an in-flight async action — so a shared handler here is
  // safe for all seven, with one caveat (ExportModal mid-export). Keyed on
  // `open`+`passive`, not on `onClose` identity, so a consumer whose `passive`
  // flips mid-`open` joins or leaves the stack at that flip, not only at mount.
  useEffect(() => {
    if (!open || passive) return;
    const id = shellId.current;
    shellStack.push(id);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (shellStack[shellStack.length - 1] !== id) return; // not the top layer
      onCloseRef.current();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      const idx = shellStack.lastIndexOf(id);
      if (idx !== -1) shellStack.splice(idx, 1);
    };
  }, [open, passive]);

  // Focus restoration to the "opener": capture whatever had focus at the
  // moment the modal opened, and give it back when the modal closes. Every
  // current ModalShell consumer drives this via `open` flipping back to false
  // while the component stays mounted (Export/ExportJson/Import read `open`
  // from the store; About/Settings/Help/NewProject read a `showX` App state
  // flag). All seven stay mounted because ModalShell's exit animation needs
  // the tree alive — conditional rendering (`{showX && <XModal .../>}`) would
  // unmount mid-close and hard-cut the exit. The cleanup below still unwinds
  // correctly if a future consumer unmounts instead of flipping `open`. Gated
  // on `passive` like the Escape effect above: a passive span never captures,
  // so it has nothing to hand back, and focus moved during one stays put.
  useEffect(() => {
    if (!open || passive) return;
    openerRef.current = (document.activeElement as HTMLElement) ?? null;
    return () => {
      openerRef.current?.focus?.();
      openerRef.current = null;
    };
  }, [open, passive]);

  const focusableItems = (): HTMLElement[] => {
    const card = cardRef.current;
    if (!card) return [];
    return Array.from(card.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
      (el) => el !== startSentinelRef.current && el !== endSentinelRef.current,
    );
  };

  const resolvedWidth = resolveDim(width, maxVwPct, chrome, 'vw');
  const resolvedHeight = resolveDim(height, maxVhPct, chrome, 'vh');

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
        exit: { opacity: 0, transition: { duration: 0 } },
        transition: { duration: 0 },
      }
    : {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0, transition: exitTransition },
        transition: springs.stiff,
      };

  // MORPHING CARD: when `motionSize` is set the card's width+height ride on
  // `animate` (never `initial`, so the first open doesn't morph) and spring with
  // `sizeSpring`. `sizeInstant` (first measurement) and reduced motion collapse
  // that spring to a hard cut. `default` still owns scale/y so the entrance
  // stays crisp even if the morph spring is gentler.
  const sizeAnim = motionSize ? { width: motionSize.width, height: motionSize.height } : {};
  const instantSize = sizeInstant || prefersReduced;
  const sizeTransition: Transition = instantSize ? { duration: 0 } : (sizeSpring ?? springs.stiff);

  const cardMotion = prefersReduced
    ? {
        initial: false as const,
        animate: sizeAnim,
        exit: {},
        transition: { duration: 0 },
      }
    : {
        initial: { scale: 0.92, y: 10 },
        animate: { scale: 1, y: 0, ...sizeAnim },
        exit: { scale: 0.92, y: 10, transition: exitTransition },
        transition: motionSize
          ? { default: springs.stiff, width: sizeTransition, height: sizeTransition }
          : springs.stiff,
      };

  const card: CSSProperties = {
    ...cozyPanel,
    zoom: chrome,
    // With `motionSize`, framer owns width/height on `animate` — omit the static
    // ones so they don't fight the animated values (maxHeight still caps).
    ...(motionSize == null && resolvedWidth != null ? { width: resolvedWidth } : {}),
    ...(motionSize == null && resolvedHeight != null ? { height: resolvedHeight } : {}),
    ...(maxVh != null ? { maxHeight: `${maxVh / chrome}vh` } : {}),
    ...(maxVw != null ? { maxWidth: `${maxVw / chrome}vw` } : {}),
    ...cardStyle,
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div style={{ ...cozyOverlay, ...backdropStyle }} onClick={onClose} {...overlayMotion}>
          <motion.div
            ref={cardRef}
            style={card}
            role="dialog"
            aria-modal="true"
            aria-label={ariaLabel}
            aria-labelledby={ariaLabelledBy}
            onClick={(e) => e.stopPropagation()}
            {...cardMotion}
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
            <ShellChildren>{children}</ShellChildren>
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
