/*
 * The parts a window inside `ModalShell` is laid out from: the card frame, a title row with Back and
 * Close at its ends, a body that takes the remaining height, and a footer with the way out on the
 * left and the confirming action on the right. The card never scrolls: the head and the footer keep
 * their height and the body alone scrolls, so Close and the actions stay in the card at any height,
 * until the card is so short that the body would show next to nothing: then the footer joins the end
 * of the body and scrolls with it. Scrolling the body tucks the title down to a smaller size, but only
 * where that body is the window's whole width: a column beside another leaves the title as it is.
 */
import {
  createContext, forwardRef, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type HTMLAttributes, type ReactNode, type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import {
  animate, motion, motionValue, useReducedMotionConfig, useTransform, type AnimationPlaybackControls, type MotionValue,
} from 'framer-motion';
import { framerMotion } from '../design/motion';
import { WINDOW_ICON_BUTTON, skin, windowCard, windowIconButton, windowTitle } from '../design/window-skin';
import { TouchReach } from './TouchReach';
import { BackIcon, CloseIcon } from './line-glyphs';
import { useInteractionProfiles } from '../design/input-mode';
import { useNameReveal } from './use-name-reveal';
import { ScrollArea } from './ScrollArea';
import type { ScrollChange, ScrollGeometry } from './scroll-geometry';

/** The card padding at each side every window shares, in css px. */
export const WINDOW_PADDING_X = 24;
/** The card padding every window shares, in css px (top, sides, bottom). */
const WINDOW_PADDING = `24px ${WINDOW_PADDING_X}px 20px`;
/** The glyph inside a window header's icon buttons, in css px. */
const WINDOW_GLYPH = 18;
/** The gap between the footer's actions, in css px. */
const WINDOW_FOOTER_GAP = 8;

/** The card frame: the window plate, the shared padding and a column the parts stack in. Spread into
 *  `ModalShell`'s `cardStyle`, then add what the window itself needs. */
export const windowFrame: CSSProperties = {
  ...windowCard,
  padding: WINDOW_PADDING,
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

/** A box between the card and its body (a step, a glide box, a page) that hands the card's capped
 *  height down to the body, so the body rather than the card gives way. */
export const windowColumn: CSSProperties = { display: 'flex', flexDirection: 'column', flex: '1 1 auto', minHeight: 0 };

/** How far the body's scroll clip stands outside its content, in css px, so a focus ring or a pressed
 *  control's lift at the content's edge is not cut. */
const BODY_BLEED = 6;

/** The least height, in css px, a scrolling body must show beside a footer that stands apart: about two
 *  rows. Under it the footer joins the body's end and scrolls with it, and stands apart again only once
 *  the body would show `BODY_SLACK` more, so a height near the line never flips it back and forth. */
const BODY_LEAST = 88;
const BODY_SLACK = 16;
/** The card height, in its own px, under which a window's head starts tucked: a phone held sideways. */
const SHORT_CARD = 520;
/** How far the body scrolls, in css px, while the title tucks from its full size to `TITLE_TUCKED`. */
const TUCK_RANGE = 56;
/** The title's size once tucked, as a share of its full size. */
const TITLE_TUCKED = 0.74;
/** How much of the card's top padding the tucked head takes back, in css px, and the least height its
 *  title row keeps once tucked. */
const HEAD_TUCK = 12;
const TUCKED_ROW = 32;
/** The least room, in css px, a second column and its gap take beside a body: a body leaving the card's
 *  content at least this much of its width is a column, whose scroll does not tuck the title. */
const BESIDE_LEAST = 120;

/**
 * What one card's head, body and footer share: how far the body has scrolled into the title's tuck
 * (0 to 1), and where the footer stands. `ModalShell` provides it per card; outside one (a pictured
 * window) there is none and each part stands as it is.
 */
interface WindowParts {
  tuck: MotionValue<number>;
  /** The card, whose content width tells a body spanning it from a column beside another. */
  card: RefObject<HTMLElement | null>;
  /** The card is short (`SHORT_CARD`), so the head stands tucked from the start. */
  short: boolean;
  /** The body's slot the footer joins, its shown and its content height in css px, and whether the
   *  footer is in it. */
  slot: HTMLElement | null;
  setSlot: (el: HTMLElement | null) => void;
  body: BodyRoom;
  setBody: (room: BodyRoom) => void;
  joined: boolean;
  setJoined: (joined: boolean) => void;
  /** Hears the id of the title heading `WindowHeader` stands in the card, and when it leaves. */
  nameTitle?: (id: string, shown: boolean) => void;
}

interface BodyRoom { shown: number; content: number }

const WindowPartsContext = createContext<WindowParts | null>(null);

const NO_ROOM: BodyRoom = { shown: 0, content: 0 };

/** One card's shared parts state, for `ModalShell` to stand around the window it holds, given the
 *  card and the height in its own px it may take. */
export function WindowPartsProvider({ card, room, nameTitle, children }: {
  card: RefObject<HTMLElement | null>; room: number; nameTitle?: (id: string, shown: boolean) => void; children: ReactNode;
}) {
  const tuck = useMemo(() => motionValue(0), []);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [body, setBodyRoom] = useState<BodyRoom>(NO_ROOM);
  const setBody = useCallback((next: BodyRoom) => setBodyRoom((was) => (was.shown === next.shown && was.content === next.content ? was : next)), []);
  const [joined, setJoined] = useState(false);
  const short = room < SHORT_CARD;
  const value = useMemo(() => ({ tuck, card, short, slot, setSlot, body, setBody, joined, setJoined, nameTitle }),
    [tuck, card, short, slot, body, setBody, joined, nameTitle]);
  return <WindowPartsContext.Provider value={value}>{children}</WindowPartsContext.Provider>;
}

/** Whether `body`, a window body's viewport with its clip `bleed` outside its box, spans the card's
 *  content rather than standing as a column beside another. Unmeasured (no layout) counts as spanning. */
function spansCard(body: HTMLElement, card: HTMLElement, bleed: number): boolean {
  const cs = getComputedStyle(card);
  const content = card.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
  return content - (body.offsetWidth - 2 * bleed) < BESIDE_LEAST;
}

/**
 * The window's one scrolling region, between a head and a footer that never scroll. It takes the
 * height the card leaves, scrolls when its content needs more and fades the edge it hides; the fade is
 * an overlay rather than a mask, so menus and bubbles opened inside are not cut by it.
 */
export const WindowBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  /** The outer box: its flex share and margins. */
  style?: CSSProperties;
  /** The scrolled content's own layout. */
  contentStyle?: CSSProperties;
  /** The colour under the fade, the card's plate unless the body stands on another. */
  surface?: string;
  /** How far the clip stands outside the content, in css px: wider for rows that reach farther out of
   *  their boxes, 0 where the content carries its own padding to the card's edge. */
  bleed?: number;
  /** Hears the scroller's geometry as it lays out and scrolls. */
  onGeometry?: (geometry: ScrollGeometry) => void;
}>(function WindowBody({ children, style, contentStyle, surface = skin.plate, bleed = BODY_BLEED, onGeometry, ...props }, ref) {
  const parts = useContext(WindowPartsContext);
  const outer = useRef<HTMLDivElement | null>(null);
  const setRefs = useCallback((el: HTMLDivElement | null) => {
    outer.current = el;
    if (typeof ref === 'function') ref(el); else if (ref) ref.current = el;
  }, [ref]);
  const tuck = parts?.tuck;
  const reduced = useReducedMotionConfig() === true;
  const spans = useRef<boolean | null>(null);
  const settling = useRef<AnimationPlaybackControls | null>(null);
  useLayoutEffect(() => () => settling.current?.stop(), []);
  const setBody = parts?.setBody;
  // The title tucks with this body's scroll only while it is shown and spans the card; a column's
  // scroll leaves it full. Scrolling follows the finger; a body that arrives, shows again or turns
  // into a column glides the title to the size its scroll gives, on the card's own resize motion.
  const tuckTo = (g: ScrollGeometry, change: ScrollChange) => {
    const el = outer.current;
    if (!tuck || !el || (g.width === 0 && g.height === 0)) return;
    // The card's ref lands after a first body's mount, so a body read before it reads again later.
    if (change !== 'scroll' || spans.current === null) {
      const card = parts?.card.current;
      spans.current = card ? spansCard(el, card, bleed) : null;
    }
    const target = spans.current === false ? 0 : Math.min(1, Math.max(0, g.top / TUCK_RANGE));
    if (change === 'scroll' && !settling.current) { tuck.set(target); return; }
    if (Math.abs(tuck.get() - target) < 1e-3 && !settling.current) return;
    settling.current?.stop();
    settling.current = null;
    if (reduced) { tuck.set(target); return; }
    const run = animate(tuck, target, { ...framerMotion('modal.resize'), onComplete: () => { if (settling.current === run) settling.current = null; } });
    settling.current = run;
  };
  // Its shown and content heights in its local px, which the footer reads to stand apart or join it.
  const hear = (g: ScrollGeometry, change: ScrollChange) => {
    tuckTo(g, change);
    setBody?.({ shown: g.height, content: g.scrollHeight });
    onGeometry?.(g);
  };
  return (
    <ScrollArea ref={setRefs} gutter="auto" fade="both" surface={surface} data-window-body=""
      style={{ flex: '1 1 auto', minHeight: 0, margin: -bleed, ...style }}
      contentStyle={{ padding: bleed, ...contentStyle }} onGeometry={hear} {...props}>
      {children}
      {parts && <div ref={parts.setSlot} data-window-foot-slot="" />}
    </ScrollArea>
  );
});

const titleRow: CSSProperties = { position: 'relative', display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 40 };
/** The head's title and aside: centred on the edge buttons' line, wrapping the aside under the title. */
const asideRow: CSSProperties = { display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px 24px', minHeight: Number(windowIconButton.height) };
const edgeButton: CSSProperties = { ...windowIconButton, position: 'absolute', top: 0, bottom: 0, marginBlock: 'auto' };

interface HeaderAction {
  /** The accessible name and tooltip, already translated. */
  label: string;
  onPress: () => void;
  'data-testid'?: string;
}

/**
 * The title row. Back stands at the start and Close at the end, both centred on the title's line;
 * `reserve` keeps the title clear of them when it wraps. With `aside` the title stands at the start
 * and the aside at the end before Close, dropping under the title when the row cannot hold both.
 * The title is the window's one h2, which names a card given no name of its own.
 */
export function WindowHeader({ title, titleId, back, close, reserve = false, style, children, aside }: {
  title: ReactNode;
  titleId?: string;
  back?: HeaderAction;
  close?: HeaderAction;
  /** Pads the row by one icon button on both sides, so a long title never runs under Back or Close. */
  reserve?: boolean;
  style?: CSSProperties;
  /** Anything that stands after the title on its line, such as a tag. */
  children?: ReactNode;
  /** A control of the whole window that stands in its head, such as a switch the window obeys. */
  aside?: ReactNode;
}) {
  const ownId = useId();
  const id = titleId ?? ownId;
  const nameTitle = useContext(WindowPartsContext)?.nameTitle;
  useLayoutEffect(() => {
    if (!nameTitle) return undefined;
    nameTitle(id, true);
    return () => nameTitle(id, false);
  }, [nameTitle, id]);
  if (aside) {
    return (
      <TuckedRow style={{ display: 'flex', alignItems: 'flex-start', gap: 12, flex: 'none', ...style }}>
        {back && <WindowBack {...back} />}
        <div style={{ ...asideRow, flex: '1 1 auto', minWidth: 0 }}>
          <TuckedTitle id={id} align="start">{title}{children}</TuckedTitle>
          {aside}
        </div>
        {close && <WindowClose {...close} />}
      </TuckedRow>
    );
  }
  const pad = reserve ? { paddingInline: Number(windowIconButton.width) + 10 } : null;
  return (
    <TuckedRow style={{ ...titleRow, flex: 'none', ...pad, ...style }}>
      {back && <WindowBack {...back} style={{ ...edgeButton, insetInlineStart: 0 }} />}
      <TuckedTitle id={id}>{title}{children}</TuckedTitle>
      {close && <WindowClose {...close} style={{ ...edgeButton, insetInlineEnd: 0 }} />}
    </TuckedRow>
  );
}

/** Whether this render stands inside a window's card. */
export function useInWindow(): boolean {
  return useContext(WindowPartsContext) !== null;
}

/** The card this render stands in, or null outside a window. */
export function useWindowCard(): RefObject<HTMLElement | null> | null {
  return useContext(WindowPartsContext)?.card ?? null;
}

/** Whether the card is short (`SHORT_CARD`), as a phone held sideways is, so a window can draw its own
 *  head rows tighter, as the title row tucks. */
export function useShortWindow(): boolean {
  return useContext(WindowPartsContext)?.short ?? false;
}

const NO_TUCK = motionValue(0);
const TUCKED = motionValue(1);

/** How far the head stands tucked: by the body's scroll, or wholly on a short card. */
function useTuck(): MotionValue<number> {
  const parts = useContext(WindowPartsContext);
  return parts ? (parts.short ? TUCKED : parts.tuck) : NO_TUCK;
}

/** The title row, taking back part of the card's top padding as the body scrolls (`HEAD_TUCK`). */
function TuckedRow({ style, children }: { style: CSSProperties; children: ReactNode }) {
  const tuck = useTuck();
  const marginTop = useTransform(tuck, [0, 1], [0, -HEAD_TUCK]);
  const minHeight = useTransform(tuck, [0, 1], [Number(style.minHeight ?? 0), Math.min(Number(style.minHeight ?? 0), TUCKED_ROW)]);
  return <motion.div style={{ ...style, marginTop, minHeight }}>{children}</motion.div>;
}

/** The title, its size following the body's scroll from full to `TITLE_TUCKED`, so a title that wraps
 *  gives its lines back to the body. It follows the finger; only `WindowBody`'s settle plays. */
function TuckedTitle({ id, align, children }: { id: string; align?: 'start'; children: ReactNode }) {
  const tuck = useTuck();
  const full = Number(windowTitle.fontSize);
  const fontSize = useTransform(tuck, [0, 1], [full, full * TITLE_TUCKED]);
  return <motion.h2 id={id} data-window-title="" style={{ ...windowTitle, margin: 0, ...(align ? { textAlign: align } : null), fontSize }}>{children}</motion.h2>;
}

type EdgeButtonProps = HeaderAction & { style?: CSSProperties };

/** A header edge button: a glyph-only tile named by `label`, at the window glyph size. */
const WindowEdgeButton = forwardRef<HTMLButtonElement, EdgeButtonProps & { glyph: ReactNode }>(
  function WindowEdgeButton({ label, onPress, style, glyph, 'data-testid': testId }, ref) {
    const tile = useInteractionProfiles().tile;
    const name = useNameReveal(label, 'below');
    return (
      <motion.button ref={ref} type="button" {...tile} {...name.bind} aria-label={label}
        data-testid={testId} style={{ position: 'relative', ...windowIconButton, ...style }} onClick={onPress}>
        {glyph}
        <TouchReach w={WINDOW_ICON_BUTTON} h={WINDOW_ICON_BUTTON} />
        {name.bubble}
      </motion.button>
    );
  },
);

/** The header's Back on its own, for a window whose head is not a title row (Help): the caller places
 *  it, at the same size and glyph as `WindowHeader`'s Back. */
export const WindowBack = forwardRef<HTMLButtonElement, EdgeButtonProps>(
  function WindowBack(props, ref) { return <WindowEdgeButton ref={ref} {...props} glyph={<BackIcon size={WINDOW_GLYPH} />} />; },
);

/** The header's Close on its own, for a window whose head is a picture rather than a title row (About):
 *  the caller places it, at the same size and glyph as every other window's Close. */
export function WindowClose(props: EdgeButtonProps) {
  return <WindowEdgeButton {...props} glyph={<CloseIcon size={WINDOW_GLYPH} />} />;
}

/**
 * The footer row: `tertiary` at the start on its own, then the way out (`cancel`) and the confirming
 * action (`primary`) at the end, in that order in every window. A row too wide for the card wraps
 * rather than pushing an action out of it.
 */
export function WindowFooter({ cancel, primary, tertiary, style }: {
  cancel?: ReactNode;
  primary?: ReactNode;
  tertiary?: ReactNode;
  style?: CSSProperties;
}) {
  const parts = useContext(WindowPartsContext);
  const row = useRef<HTMLDivElement | null>(null);
  // The footer's outer height while it stands apart, kept while it is joined so the choice stays put.
  const height = useRef(0);
  const joined = !!parts?.joined && !!parts.slot;
  useLayoutEffect(() => {
    if (!parts) return;
    const el = row.current;
    if (el && !parts.joined) {
      const cs = getComputedStyle(el);
      height.current = el.offsetHeight + (parseFloat(cs.marginTop) || 0) + (parseFloat(cs.marginBottom) || 0);
    }
    // The body as it would stand with the footer apart, read the same in both states. Only a body that
    // scrolls gives the footer its end: one that holds all it has keeps the footer at the card's foot.
    const foot = parts.joined ? height.current : 0;
    const shown = parts.body.shown - foot;
    const scrolls = parts.body.content - foot > shown + 1;
    const next = parts.body.shown > 0 && scrolls && shown < (parts.joined ? BODY_LEAST + BODY_SLACK : BODY_LEAST);
    if (next !== parts.joined) parts.setJoined(next);
  });
  const content = (
    <div ref={row} data-window-footer={joined ? 'joined' : 'apart'}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: WINDOW_FOOTER_GAP, flex: 'none', ...style }}>
      {tertiary ? <div style={{ marginInlineEnd: 'auto', display: 'flex' }}>{tertiary}</div> : null}
      {cancel}
      {primary}
    </div>
  );
  return joined ? createPortal(content, parts!.slot!) : content;
}
