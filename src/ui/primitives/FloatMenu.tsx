import { helpAttributes, inheritedHelpTarget } from './help-target';
import { Fragment, useEffect, useId, useRef, type CSSProperties, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import { useUiPreview } from '../design/preview';
import { routeSurfaceKeyDown, SurfaceOwner, useSurfaceScope } from './surface-scope';
import { useFloatingPosition } from './use-floating-position';
import { useDenseScript, useDevicePixelRatio } from '../design/scale';
import { cursors, font, radii, shadows, UNAVAILABLE, z } from '../design/styles';
import { ACTIVE, INK, INSET, LINE, PANEL_EDGE, PANEL_EDGE_WIDTH, PLATE, PLATE_INK, MUTED } from '../design/tokens';
import { roleFont, weightVars } from '../design/text-weight';
import { framerMotion } from '../design/motion';
import { ChevronIcon } from './line-glyphs';
import { hoverFillMotion } from './hover-fill';

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
  /** Draws a divider above this row. */
  separated?: boolean;
  /** Extra attributes for the row, such as its help target. */
  attrs?: Record<string, string>;
}

interface FloatMenuProps {
  /** The closed row's content: the current value, in the caller's own words. */
  row: ReactNode;
  /** The list, where the list really is one choice per row. */
  items?: readonly FloatMenuItem[];
  /**
   * The card's contents, instead of `items`, for the one list shape a row of `menuitem` buttons
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
  /** The css `zoom` the card should draw at, matching whatever the row stands under. */
  zoom?: number;
  /**
   * An element of the caller's own to hang the card from, in place of the menu's row: a field whose
   * suggestions the list offers, a control drawn in its window's own style. The card takes its width
   * unless `width` names one, and a press on it never counts as outside.
   */
  anchor?: RefObject<HTMLElement | null>;
  /** The card's width in css px with `anchor`; the anchor's own width otherwise. */
  width?: number;
  /** Leaves focus where it is (a field the reader keeps typing into) instead of taking it into the
   *  list; the caller moves `highlightId` with the keys. */
  keepFocus?: boolean;
  /** The row the caller's keys stand on, drawn as the hovered row. */
  highlightId?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  /**
   * A control of the caller's that opens the menu, in place of the closed row: the card hangs from
   * it, sized to its widest row and aligned to the control's `align` edge, and its rows are actions
   * (`menuitem`) rather than one choice among them. `onMap` marks a card standing on the map, which
   * wears its edge and no shadow.
   */
  trigger?: { ref: RefObject<HTMLElement>; align?: 'start' | 'center' | 'end'; gap?: number; minWidth?: number; onMap?: boolean };
}

export function FloatMenu({
  row, items = [], body, open, onOpen, onClose, onPick, activeId, header, zoom = 1,
  anchor, width, keepFocus = false, highlightId,
  'aria-label': ariaLabel, 'data-testid': testId, trigger,
}: FloatMenuProps) {
  const ownRow = useRef<HTMLButtonElement>(null);
  const rowRef = trigger?.ref ?? anchor ?? ownRow;
  const across = trigger?.align === 'end' ? 'right' : trigger?.align === 'start' ? 'left' : 'center';
  const pictured = useUiPreview();
  const menuId = useId();
  const weights = weightVars(zoom, useDevicePixelRatio(), useDenseScript());
  const { ref: cardRef, placement, style } = useFloatingPosition({
    open: open && !pictured, anchor: rowRef, zoom, maxHeight: MAX_HEIGHT,
    ...(trigger ? { align: trigger.align ?? 'start', gap: trigger.gap ?? ANCHOR_GAP } : { width: width ?? ('anchor' as const), gap: ANCHOR_GAP }),
  });
  // The row the caller's keys reach stays in view in a list longer than the card.
  useEffect(() => {
    if (!open || highlightId === undefined) return;
    const rows = cardRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [];
    Array.from(rows).find((row) => row.dataset.itemId === highlightId)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlightId, cardRef]);
  const scope = useSurfaceScope({ open: open && !pictured && !!placement, root: cardRef, trigger: rowRef, onClose, focus: keepFocus ? 'none' : body ? 'contain' : 'menu', outside: true });

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
      transition={framerMotion('surface.arrive')}
      style={{ ...cardStyle, ...(trigger?.minWidth ? { minWidth: trigger.minWidth } : {}), ...(trigger?.onMap ? { boxShadow: 'none' } : {}), ...box, transformOrigin: origin }}
    >
      {header ? <div style={headStyle}>{header}</div> : null}
      <SurfaceOwner.Provider value={scope}>{body}</SurfaceOwner.Provider>
      {items.map((item) => (
        <Fragment key={item.id}>
          {item.separated ? <div style={dividerStyle} /> : null}
          <motion.button
            type="button"
            {...item.attrs}
            data-item-id={item.id}
            {...(trigger ? { role: 'menuitem' } : { role: 'menuitemradio', 'aria-checked': item.id === activeId })}
            disabled={item.disabled}
            onClick={() => { onPick?.(item.id); onClose(); }}
            {...(keepFocus ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() } : {})}
            {...hoverFillMotion({
              fill: item.id === highlightId && item.id !== activeId ? floatMenuHoverFill(false) : floatMenuItemFill(item.id === activeId),
              hoverFill: item.disabled ? undefined : floatMenuHoverFill(item.id === activeId),
            })}
            transition={framerMotion('surface.arrive')}
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
      {trigger || anchor ? null : <button
        ref={ownRow}
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
      </button>}
      {open && pictured ? (
        <div style={{ position: 'relative', marginTop: ANCHOR_GAP }}>
          {card({ position: 'static', maxHeight: MAX_HEIGHT }, `top ${across}`)}
        </div>
      ) : null}
      {open && !pictured ? createPortal(
        <>
          <div style={{ ...layerStyle, zoom, ...weights }}>
            {card(style, `${placement?.above ? 'bottom' : 'top'} ${across}`)}
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
    <motion.span
      aria-hidden
      animate={{ rotate: open ? 180 : 0 }}
      transition={framerMotion('surface.arrive')}
      style={{ display: 'flex', color: MUTED, flex: '0 0 auto' }}
    >
      <ChevronIcon size={13} />
    </motion.span>
  );
}

export function floatMenuItemStyle(active: boolean, disabled = false): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    width: '100%',
    textAlign: 'left',
    border: 'none',
    borderRadius: radii.md,
    padding: '8px 14px',
    fontFamily: font.family,
    ...roleFont('menu'),
    color: active ? INK : PLATE_INK,
    cursor: disabled ? cursors.blocked : cursors.clickable,
    opacity: disabled ? UNAVAILABLE : 1,
  };
}

/** A row's resting fill, Framer's to draw (`hover-fill.ts`). An inactive row matches the card rather
 *  than being transparent, so a hover tints from a colour instead of flashing in. */
export function floatMenuItemFill(active: boolean): string {
  return active ? ACTIVE : PLATE;
}

/** What a row's hover tints to: one step down the cream ramp from the plate it stands on, so the
 *  row under the pointer comes forward. The current row has no hover state to move to. */
export function floatMenuHoverFill(active: boolean): string {
  return active ? ACTIVE : INSET;
}

const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
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
  color: MUTED,
  padding: '6px 10px 2px',
  flex: '0 0 auto',
};

const subStyle: CSSProperties = {
  marginLeft: 'auto',
  ...roleFont('caption'),
  fontFamily: font.family,
  color: MUTED,
};

const dividerStyle: CSSProperties = {
  height: 1,
  background: LINE,
  margin: '4px 10px',
  flex: '0 0 auto',
};
