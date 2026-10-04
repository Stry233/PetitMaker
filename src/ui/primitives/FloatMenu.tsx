import { helpAttributes, inheritedHelpTarget } from './help-target';
import { Fragment, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { ClickCatcher } from './ClickCatcher';
import { useUiPreview } from './ui-preview';
import { routeSurfaceKeyDown, SurfaceOwner, useSurfaceScope } from './surface-scope';
import { useFloatingPosition } from './use-floating-position';
import { useDenseScript, useDevicePixelRatio } from '../design/scale';
import { colors, cursors, font, radii, shadows, springs, UNAVAILABLE, z } from '../design/styles';
import { ACTIVE, INK, INSET, LINE, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE, PLATE_INK } from '../design/tokens';
import { roleFont, weightVars } from '../design/text-weight';

const ANCHOR_GAP = 6;
const MAX_HEIGHT = 320;
const CARD_PADDING = 6;
export const FLOAT_MENU_CONTENT_RADIUS = radii.lg - PANEL_EDGE_WIDTH - CARD_PADDING;

export interface FloatMenuItem {
  id: string;
  label: ReactNode;
  /** The muted note at the row's far end: a speed, a price, a shape. */
  sub?: ReactNode;
  disabled?: boolean;
  /** Draws a divider ABOVE this row. */
  separated?: boolean;
}

interface FloatMenuProps {
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
  const pictured = useUiPreview();
  const menuId = useId();
  const weights = weightVars(zoom, useDevicePixelRatio(), useDenseScript());
  const { ref: cardRef, placement, style } = useFloatingPosition({ open: open && !pictured, anchor: rowRef, zoom, width: 'anchor', maxHeight: MAX_HEIGHT, gap: ANCHOR_GAP });
  const scope = useSurfaceScope({ open: open && !pictured && !!placement, root: cardRef, trigger: rowRef, onClose, focus: body ? 'contain' : 'menu' });

  const card = (box: CSSProperties, origin: string) => (
    <motion.div
      ref={cardRef}
      id={menuId}
      tabIndex={-1}
      {...helpAttributes(inheritedHelpTarget(rowRef.current))}
      role={body ? 'group' : 'menu'}
      aria-label={ariaLabel}
      onKeyDown={pictured ? undefined : routeSurfaceKeyDown}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springs.stiff}
      style={{ ...cardStyle, ...box, transformOrigin: origin }}
    >
      {header ? <div style={headStyle}>{header}</div> : null}
      <SurfaceOwner.Provider value={scope}>{body}</SurfaceOwner.Provider>
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
        aria-controls={open ? menuId : undefined}
        onKeyDown={(event) => { if (!open && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); onOpen(); } }}
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
      {open && !pictured ? createPortal(
        <>
          <ClickCatcher onDismiss={onClose} zIndex={z.popover} />
          <div style={{ ...layerStyle, zoom, ...weights }}>
            {card(style, placement?.above ? 'bottom center' : 'top center')}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
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
  ...roleFont('menu'),
  cursor: cursors.clickable,
};

const rowValue: CSSProperties = {
  flex: '1 1 auto',
  minWidth: 0,
  display: 'block',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const layerStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: z.popover,
  pointerEvents: 'none',
};

/** Placement caps include padding and border. */
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
  padding: CARD_PADDING,
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
