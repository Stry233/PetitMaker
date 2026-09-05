/**
 * Shared single-choice dropdown. The open card portals to `body` so ancestor zoom and stacking
 * contexts cannot clip it, anchors in viewport coordinates, and opens above when needed. Escape and
 * outside presses close and consume the event. UI previews render the card inline with no global
 * listeners. Item lists use menu radio semantics; caller-defined bodies use a labelled group.
 */
import { Fragment, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ClickCatcher, clampLeft } from './ClickCatcher';
import { useUiPreview } from './ui-preview';
import { colors, cursors, font, radii, shadows, springs, UNAVAILABLE, z } from '../design/styles';
import { ACTIVE, INK, INSET, LINE, PANEL_EDGE, PLATE, PLATE_INK } from '../design/tokens';
import { roleFont } from '../design/text-weight';

/** The air between the row and the card, and the margin the card keeps off every window edge. */
const ANCHOR_GAP = 6;
const EDGE_MARGIN = 8;
/** Below this much room under the row the card stands above it instead. */
const ROOM_FLOOR = 120;
/** The tallest a list gets before it scrolls inside itself. */
const MAX_HEIGHT = 320;

export interface FloatMenuItem {
  id: string;
  label: ReactNode;
  /** The muted note at the row's far end: a speed, a price, a shape. */
  sub?: ReactNode;
  disabled?: boolean;
  /** Draws a divider ABOVE this row. */
  separated?: boolean;
}

export interface FloatMenuProps {
  /** The closed row's content: the current value, in the caller's own words. */
  row: ReactNode;
  /** The list, where the list really is one choice per row. */
  items?: readonly FloatMenuItem[];
  /**
   * The card's contents, INSTEAD of `items`, for the one list shape a row of `menuitem` buttons
   * cannot hold: a row carrying a second control of its own. A button cannot nest in a button, so a
   * list whose rows have their own action (the panel's past jobs, where the row opens the ticket and
   * a square beside it rolls the job back) builds its own rows and takes the card, the layer, the
   * anchor, the clamp and both ways out from here.
   */
  body?: ReactNode;
  /** The host owns this. The menu asks to open and to close; it never decides. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onPick?: (id: string) => void;
  /** Which row is current. */
  activeId?: string;
  /** A cap over the list. */
  header?: ReactNode;
  /** The css `zoom` the CARD should draw at, matching whatever the row stands under. */
  zoom?: number;
  'aria-label'?: string;
  'data-testid'?: string;
}

export function FloatMenu({
  row, items = [], body, open, onOpen, onClose, onPick, activeId, header, zoom = 1,
  'aria-label': ariaLabel, 'data-testid': testId,
}: FloatMenuProps) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);
  // A PICTURED menu holds still: `PreviewFrame`'s `inert`/`pointer-events` containment is a
  // property of the real DOM tree, so a body-level portal and a window listener both stand OUTSIDE
  // it — an invisible catcher over the live app, an Escape eaten app-wide. Pictured, no listener is
  // attached and the open card renders in flow under its row instead of in the portal layer.
  const pictured = useUiPreview();

  // Measured in a LAYOUT effect: the card is positioned from the row's rect, and reading it after
  // paint would show one frame of the card at the top-left corner of the window.
  useLayoutEffect(() => {
    if (!open || pictured) { setPlace(null); return undefined; }
    const measure = () => { if (rowRef.current) setPlace(placeCard(rowRef.current.getBoundingClientRect(), zoom)); };
    measure();
    // The anchor moves with the page, and a card left behind is a card pointing at nothing.
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, zoom, pictured]);

  // Capture at the window, which is earlier than every keydown listener the app registers, and the
  // press is STOPPED: the menu is what the Escape was aimed at, and the surface behind it keeps
  // standing until the next one.
  useLayoutEffect(() => {
    if (!open || pictured) return undefined;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose, pictured]);

  const card = (box: CSSProperties, origin: string) => (
    <motion.div
      // A CARD OF `menuitem` ROWS IS A MENU; a card the caller filled itself is not. The
      // rows a `body` brings carry a second control of their own (that is what `body` is
      // for), so calling it a menu would promise every child is a menuitem and leave a
      // screen reader announcing an empty one. A labelled GROUP is what it is.
      role={body ? 'group' : 'menu'}
      aria-label={ariaLabel}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springs.stiff}
      style={{ ...cardStyle, ...box, transformOrigin: origin }}
    >
      {header ? <div style={headStyle}>{header}</div> : null}
      {body}
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separated ? <div style={dividerStyle} /> : null}
          <motion.button
            type="button"
            role="menuitemradio"
            aria-checked={item.id === activeId}
            disabled={item.disabled}
            onClick={() => { onPick?.(item.id); onClose(); }}
            whileHover={item.disabled ? undefined : { backgroundColor: hoverFill(item.id === activeId) }}
            transition={springs.stiff}
            style={floatMenuItemStyle(item.id === activeId, item.disabled)}
          >
            <span>{item.label}</span>
            {item.sub != null ? <span style={subStyle}>{item.sub}</span> : null}
          </motion.button>
        </Fragment>
      ))}
    </motion.div>
  );

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        data-testid={testId}
        aria-haspopup={body ? true : 'menu'}
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => (open ? onClose() : onOpen())}
        style={rowStyle}
      >
        <span style={rowValue}>{row}</span>
        <Chevron open={open} />
      </button>
      {open && pictured ? (
        <div style={{ position: 'relative', marginTop: ANCHOR_GAP }}>
          {card({ position: 'static', maxHeight: MAX_HEIGHT }, 'top center')}
        </div>
      ) : null}
      {open && place ? createPortal(
        <>
          <ClickCatcher onDismiss={onClose} zIndex={z.popover} />
          <div style={{ ...layerStyle, zoom }}>
            {card(place.box, place.above ? 'bottom center' : 'top center')}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}

/** Where the card stands, in the layer's own (zoom-divided) coordinates. */
interface Placement { box: CSSProperties; above: boolean }

/**
 * The card under its row, or above it where the window has no room below. Widths and offsets are
 * clamped in VISUAL px — what actually occupies screen is the css length times the zoom — and then
 * divided back into the zoomed layer's coordinates.
 */
function placeCard(anchor: DOMRect, zoom: number): Placement {
  // THE AIR IS A DESIGNED LENGTH, so it is spent in the CARD's own px and converted like every
  // other one. Added to a visual rect and divided with it, it came out at ANCHOR_GAP SCREEN px
  // whatever the interface scale — 8 frame px of air at uiZoom 0.6 and 2.7 at 1.8, the card three
  // times tighter to its row at the top of the range than at the bottom. Here it is the room test's
  // own term, which is measured in visual px, so the gap is scaled INTO it.
  const gapVisual = ANCHOR_GAP * zoom;
  const below = window.innerHeight - anchor.bottom - gapVisual - EDGE_MARGIN;
  const above = anchor.top - gapVisual - EDGE_MARGIN;
  const flip = below < ROOM_FLOOR && above > below;
  const room = Math.max(ROOM_FLOOR, flip ? above : below);
  const width = anchor.width;
  const left = clampLeft(anchor.left, width / zoom, zoom, EDGE_MARGIN);
  const maxHeight = Math.min(MAX_HEIGHT * zoom, room);
  return {
    above: flip,
    box: {
      left: left / zoom,
      width: width / zoom,
      maxHeight: maxHeight / zoom,
      // A flipped card grows UPWARD from the row, so its FOOT is what is pinned and the height cap
      // above keeps its head inside the window. Pinning the top instead would make the card's own
      // length decide where it starts, which moves it every time the list changes.
      ...(flip
        ? { bottom: (window.innerHeight - anchor.top) / zoom + ANCHOR_GAP }
        : { top: anchor.bottom / zoom + ANCHOR_GAP }),
    },
  };
}

/** The chevron that turns over when the list opens. */
function Chevron({ open }: { open: boolean }) {
  return (
    <motion.svg
      aria-hidden
      viewBox="0 0 24 24"
      width={13}
      height={13}
      animate={{ rotate: open ? 180 : 0 }}
      transition={springs.stiff}
      style={{ color: colors.brownText, flex: '0 0 auto' }}
    >
      <path d="M 6 9 L 12 15.4 L 18 9" fill="none" stroke="currentColor" strokeWidth={3.6} strokeLinecap="round" strokeLinejoin="round" />
    </motion.svg>
  );
}

/**
 * One row of the list. The ACTIVE fill is the whole of the current-row mark: no tick, no rule, no
 * second colour, since the app already answers "this is the chosen one" in that one yellow.
 *
 * AND NO SECOND WEIGHT EITHER, which is the same rule and was being broken by the line below it: the
 * active row took the `menu` rung and every other row the `label` rung one step lighter, so a list
 * of providers stood a full weight under the same names on the setup screen's own confirmed row, and
 * "which is chosen" was said twice while "these are all choices" was said at two ranks. `menu` is
 * the rung for exactly this — the chosen row of a menu — and every row here is a choice being named.
 */
export function floatMenuItemStyle(active: boolean, disabled = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 9,
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderRadius: radii.md,
    padding: '9px 14px',
    fontFamily: font.family,
    ...roleFont('menu'),
    // An inactive row matches the card rather than being transparent, so a hover tints from a
    // colour instead of flashing in.
    backgroundColor: active ? ACTIVE : PLATE,
    color: active ? INK : PLATE_INK,
    cursor: disabled ? cursors.blocked : cursors.clickable,
    opacity: disabled ? UNAVAILABLE : 1,
  };
}

/** What a row's hover tints to: one step down the cream ramp from the plate it stands on, so the
 *  row under the pointer comes forward. The current row has no hover state to move to. */
function hoverFill(active: boolean): string {
  return active ? ACTIVE : INSET;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 9,
  width: '100%',
  textAlign: 'left',
  background: INSET,
  color: PLATE_INK,
  border: 'none',
  borderRadius: radii.md,
  padding: '10px 12px',
  fontFamily: font.family,
  // The CLOSED row shows the value that is chosen, so it is the same rung as the chosen row inside
  // the card. Drawn at `label` it read a step under the pills and the footer beside it.
  ...roleFont('menu'),
  cursor: cursors.clickable,
};

/** The row's own content area: it FILLS the row (`flex: 1`) rather than being pushed left by an auto
 *  margin, so a caller whose row has a far-right datum of its own (a count, a shortcut) can put one
 *  there with a flex child of this box. BLOCK, not inline: a plain string still ellipsizes here
 *  (block + hidden + nowrap is what draws the ellipsis at all), and an inline box under a scaled font
 *  would be baseline-aligned to the host's unscaled strut. */
const rowValue: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

/** The layer: the whole viewport at the popover rung, taking NO pointer event of its own, so the
 *  card is the only thing in it a press can land on. The dismissing press lands on the
 *  `ClickCatcher` a rung below, which is what closes the menu. */
const layerStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: z.popover,
  pointerEvents: 'none',
};

/**
 * The card. BORDER-BOX, and that is what makes the placement below mean what it says: the card is
 * given the ROW's width and the room the window has left, and its own padding and border are inside
 * both. Content-box put them outside instead — the card came out 14px wider than the row it hangs
 * from, so its right corners stood past the row and past the clamp that is supposed to hold them off
 * the window's edge, and 14px taller than the room, so its bottom corners were cut off by the window
 * itself. A rounded card with two of its corners clipped square is how that read on the glass.
 */
const cardStyle: CSSProperties = {
  position: 'fixed',
  boxSizing: 'border-box',
  pointerEvents: 'auto',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  background: PLATE,
  border: PANEL_EDGE,
  borderRadius: radii.lg,
  padding: 6,
  boxShadow: shadows.menu,
  overflowY: 'auto',
};

const headStyle: CSSProperties = {
  ...roleFont('subhead'),
  fontFamily: font.family,
  color: colors.brownText,
  padding: '6px 10px 2px',
  flex: '0 0 auto',
};

const subStyle: CSSProperties = {
  marginLeft: 'auto',
  ...roleFont('caption'),
  fontFamily: font.family,
  color: colors.brownText,
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: LINE,
  margin: '4px 10px',
  flex: '0 0 auto',
};
