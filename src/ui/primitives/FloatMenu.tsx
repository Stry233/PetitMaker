import { helpAttributes, inheritedHelpTarget } from './help-target';
import { Fragment, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type RefObject } from 'react';
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
import { ActionButton } from './ActionButton';
import { ScrollArea } from './ScrollArea';
import { Spinner } from './Spinner';
import { CONTROL_CLEARANCE } from './use-scroll-row';
import { FIELD_INPUT_CLASS, FIELD_WRAP_CLASS } from '../design/focus-source';

const ANCHOR_GAP = 6;
const MAX_HEIGHT = 320;
const CARD_PADDING = 6;
/** The corner of a box inside the card, concentric with the card's own. */
const CONTENT_RADIUS = radii.lg - PANEL_EDGE_WIDTH - CARD_PADDING;

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
  /** What a search matches the row by besides its id, where its label is not plain text. */
  text?: string;
}

/** A field over the list that narrows its rows to what is typed. Every string is already translated. */
interface FloatMenuSearch {
  /** The field's name and placeholder. */
  label: string;
  /** Said when the typed text matches no row. */
  noMatches: string;
  /** Said when the list is empty and nothing is typed; `noMatches` otherwise. */
  empty?: string;
  /** Offers the typed text as a choice of its own when no row's id is it: the label of that row. */
  manual?: (typed: string) => ReactNode;
  'data-testid'?: string;
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
  /** A field that filters the list, and with `manual` takes a choice the list lacks. */
  search?: FloatMenuSearch;
  /** The list is still arriving: a spinner stands in the search field, or over an empty list. */
  loading?: boolean;
  /** A muted note between the search field and the list. */
  note?: ReactNode;
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

/**
 * The one dropdown: a closed row (or the caller's own trigger or anchor) and a card on the body's
 * layer, drawn at the zoom its row stands under (a window's touch lift, the frame's, the chrome's), so
 * a caller never sizes it. Rows are one choice each; `search` adds a field that filters them and can
 * take a typed choice, `loading` and `note` say what the list is waiting on.
 */
export function FloatMenu({
  row, items = [], body, open, onOpen, onClose, onPick, activeId, header, search, loading = false, note,
  anchor, width, keepFocus = false, highlightId,
  'aria-label': ariaLabel, 'data-testid': testId, trigger,
}: FloatMenuProps) {
  const ownRow = useRef<HTMLButtonElement>(null);
  const rowRef = trigger?.ref ?? anchor ?? ownRow;
  const across = trigger?.align === 'end' ? 'right' : trigger?.align === 'start' ? 'left' : 'center';
  const pictured = useUiPreview();
  const menuId = useId();
  const [query, setQuery] = useState('');
  if (!open && query !== '') setQuery('');
  const searchBody = search ? (
    <SearchList search={search} items={items} activeId={activeId} loading={loading} note={note} ariaLabel={ariaLabel}
      query={query} onQuery={setQuery} onPick={(id) => { onPick?.(id); onClose(); }} />
  ) : null;
  const cardBody = searchBody ?? body;
  // The card draws at the zoom its row stands under (a window's touch lift, the frame's, the chrome's),
  // read off the row as it is placed.
  const { ref: cardRef, piece, placement, rung, style, zoom } = useFloatingPosition({
    open: open && !pictured, anchor: rowRef, zoom: 'anchor', maxHeight: MAX_HEIGHT,
    ...(trigger ? { align: trigger.align ?? 'start', gap: trigger.gap ?? ANCHOR_GAP } : { width: width ?? ('anchor' as const), gap: ANCHOR_GAP }),
  });
  const weights = weightVars(zoom, useDevicePixelRatio(), useDenseScript());
  // The row the caller's keys reach stays in view in a list longer than the card.
  useEffect(() => {
    if (!open || highlightId === undefined) return;
    const rows = cardRef.current?.querySelectorAll<HTMLElement>('[data-item-id]') ?? [];
    Array.from(rows).find((row) => row.dataset.itemId === highlightId)?.scrollIntoView?.({ block: 'nearest' });
  }, [open, highlightId, cardRef]);
  const scope = useSurfaceScope({ open: open && !pictured && !!placement, root: cardRef, trigger: rowRef, onClose, focus: keepFocus ? 'none' : cardBody ? 'contain' : 'menu', outside: true });

  const card = (box: CSSProperties, origin: string) => (
    <motion.div
      ref={cardRef}
      {...piece}
      id={menuId}
      tabIndex={-1}
      {...helpAttributes(inheritedHelpTarget(rowRef.current))}
      role={cardBody ? 'group' : 'menu'}
      aria-label={ariaLabel}
      onKeyDown={pictured ? undefined : routeSurfaceKeyDown}
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={framerMotion('surface.arrive')}
      style={{ ...cardStyle, ...(trigger?.minWidth ? { minWidth: trigger.minWidth } : {}), ...(trigger?.onMap ? { boxShadow: 'none' } : {}), ...box, transformOrigin: origin }}
    >
      {header ? <div style={headStyle}>{header}</div> : null}
      <SurfaceOwner.Provider value={scope}>{cardBody}</SurfaceOwner.Provider>
      {searchBody ? null : items.map((item) => (
        <Fragment key={item.id}>
          {item.separated ? <div style={dividerStyle} /> : null}
          <MenuRow item={item} active={item.id === activeId} highlighted={item.id === highlightId} action={!!trigger}
            keepFocus={keepFocus} onPick={() => { onPick?.(item.id); onClose(); }} />
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
        aria-haspopup={cardBody ? true : 'menu'}
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
          <div style={{ ...layerStyle, zIndex: layerRung(rung), zoom, ...weights }}>
            {card(style, `${placement?.above ? 'bottom' : 'top'} ${across}`)}
          </div>
        </>,
        document.body,
      ) : null}
    </>
  );
}

/** One row of the list: a choice (`menuitemradio`), or with `action` a command (`menuitem`). */
function MenuRow({ item, active, highlighted = false, action = false, keepFocus = false, wraps = false, onPick }: {
  item: FloatMenuItem; active: boolean; highlighted?: boolean; action?: boolean; keepFocus?: boolean;
  /** Breaks a long unspaced label (a model id) rather than overflowing the card. */
  wraps?: boolean;
  onPick: () => void;
}) {
  return (
    <ActionButton
      {...item.attrs}
      data-item-id={item.id}
      {...(action ? { role: 'menuitem' } : { role: 'menuitemradio', 'aria-checked': active })}
      interaction="row"
      disabled={item.disabled}
      dim="caller"
      onClick={onPick}
      {...(keepFocus ? { onMouseDown: (event: React.MouseEvent) => event.preventDefault() } : {})}
      fill={highlighted && !active ? floatMenuHoverFill(false) : floatMenuItemFill(active)}
      {...(item.disabled ? {} : { hoverFill: floatMenuHoverFill(active) })}
      fillTransition={framerMotion('surface.arrive')}
      style={{ ...floatMenuItemStyle(active, item.disabled), flexShrink: 0, ...(wraps ? { overflowWrap: 'anywhere' } : null) }}
    >
      <span style={{ minWidth: 0 }}>{item.label}</span>
      {item.sub != null ? <span style={subStyle}>{item.sub}</span> : null}
    </ActionButton>
  );
}

/** The card's contents with a search field: the field, the note, and the narrowed list in its own
 *  scroller, so the field stays put while the rows scroll. Arrow keys, Home and End walk the field and
 *  the rows; Enter takes the exact id, the typed choice, or the one row left. */
function SearchList({ search, items, activeId, loading, note, ariaLabel, query, onQuery, onPick }: {
  search: FloatMenuSearch; items: readonly FloatMenuItem[]; activeId?: string; loading: boolean; note?: ReactNode;
  ariaLabel?: string; query: string; onQuery: (query: string) => void; onPick: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const typed = query.trim();
  const needle = typed.toLocaleLowerCase();
  const matches = items.filter((item) => `${item.id} ${item.text ?? (typeof item.label === 'string' ? item.label : '')}`.toLocaleLowerCase().includes(needle));
  const manual = search.manual && typed !== '' && !items.some(({ id }) => id === typed) ? { id: typed, label: search.manual(typed) } : null;
  const choices = manual ? [...matches, manual] : matches;
  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    if (event.target instanceof HTMLInputElement && ['Home', 'End'].includes(event.key)) return;
    const controls = Array.from(box.current?.querySelectorAll<HTMLElement>('input, button:not(:disabled)') ?? []);
    const at = controls.indexOf(document.activeElement as HTMLElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? controls.length - 1
      : (at + (event.key === 'ArrowDown' ? 1 : -1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next]?.focus();
  };
  return (
    <div ref={box} onKeyDown={navigate} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 6 }}>
      <label className={FIELD_WRAP_CLASS} style={searchFieldStyle}>
        <input
          type="search"
          data-testid={search['data-testid']}
          className={FIELD_INPUT_CLASS}
          aria-label={search.label}
          placeholder={search.label}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          enterKeyHint="done"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.keyCode === 229) return;
            event.preventDefault();
            const exact = items.find(({ id }) => id === typed);
            const id = exact?.id ?? manual?.id ?? (matches.length === 1 ? matches[0]?.id : undefined);
            if (id) onPick(id);
          }}
          style={searchInputStyle}
        />
        {loading && <Spinner size={13} />}
      </label>
      {note ? <p style={{ ...noteStyle, padding: '0 8px' }}>{note}</p> : null}
      <ScrollArea role="menu" aria-label={ariaLabel} gutter="stable" fade="both" style={{ flex: '1 1 auto' }}
        contentStyle={{ display: 'flex', flexDirection: 'column', gap: 2, padding: CONTROL_CLEARANCE }}>
        {choices.map((item) => (
          <MenuRow key={item.id} item={item} active={item.id === activeId} wraps onPick={() => onPick(item.id)} />
        ))}
        {choices.length === 0 && !loading && (
          <p role="status" style={{ ...noteStyle, padding: '8px 14px' }}>
            {typed === '' && search.empty ? search.empty : search.noMatches}
          </p>
        )}
      </ScrollArea>
    </div>
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

/** The menu's layer: the popover rung, or one step over the window that holds its anchor where that
 *  window stands higher (Help), the one offset that orders a surface over its own owner. */
function layerRung(rung: number): number {
  return Math.max(z.popover, rung + 1);
}

const layerStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
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

/** The search field: an inset box the list's rows line up with, its corner following the card's. */
const searchFieldStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
  background: INSET, borderRadius: CONTENT_RADIUS, padding: '10px 12px',
  borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent',
};

const searchInputStyle: CSSProperties = {
  flex: 1, minWidth: 0, background: 'none', border: 'none', outline: 'none',
  ...roleFont('field'), fontFamily: font.family, color: PLATE_INK, letterSpacing: 0,
  cursor: cursors.text,
};

const noteStyle: CSSProperties = {
  ...roleFont('note'), fontFamily: font.family, color: MUTED, lineHeight: 1.45, margin: 0,
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
