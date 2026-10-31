/**
 * The tour's window: one card at a time with its reel, words and way on, then the recap. An upright
 * screen stands it as a sheet along the window's foot with the reel above the words; a wide one as a
 * card near the foot with the reel at its left, its dots taking their own row where the card is
 * narrow or the window short, so its buttons never crowd. Back keeps its place on the first card as an
 * empty slot, so Next never moves. Escape and a press outside skip, as on any window. Moving between
 * cards, only the reel and the words cross over; the dots, the buttons and Skip stand still.
 */
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode, type Ref } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig, type TargetAndTransition } from 'framer-motion';
import { useLocale } from '../../../i18n/context';
import { useKeybinds } from '../../../state/keymap/store';
import { effectiveCombo } from '../../../state/keymap/resolve';
import { prettyCombo } from '../../../platform/input/combo';
import { prefetchIntoCache } from '../../../platform/async/http-cache';
import { SUPPORTS_TOUR_REELS } from '../../../platform/build/edition';
import { asksToSaveData } from '../../../platform/device/device-quality';
import { useEditorStore } from '../../../state/store';
import { editsInFlight, onEditsInFlightChange } from '../../../state/edits-in-flight';
import { showMeOpenable } from '../../../state/slices/shell';
import { useReadingT } from '../../design/reading';
import { useUiPreview } from '../../design/preview';
import { useCurrentInputMode, useLayoutShape, useTouchMode } from '../../design/input-mode';
import { useViewportSize } from '../../design/scale';
import { framerMotion, outMotion } from '../../design/motion';
import { MOTIONS } from '../../design/motion/registry';
import { useTransition } from '../../design/motion/use-motion';
import { cursors, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { skin, WINDOW_ICON_BUTTON, windowFooterTertiary, windowTitle } from '../../design/window-skin';
import { ActionButton } from '../../primitives/ActionButton';
import { ModalShell } from '../../primitives/ModalShell';
import { useGlidingChromeLift } from '../../primitives/chrome-layer';
import { useHeightTransition } from '../../primitives/use-height-transition';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useScrollFade } from '../../primitives/scroll-fade';
import { useSwapClip } from '../../primitives/use-swap-clip';
import { useHandoffShift } from '../../session/splash-handoff';
import { useLeavingView } from '../modals/WindowStep';
import { playedReel, REEL_ASPECT, REEL_SIZE, reelFiles, reelForm } from './reels';
import { REEL_SLIDE_VAR, reelEnlargement, reelRadius, TourReel } from './TourReel';
import { TourRecap } from './TourRecap';
import { SWIPE_PART_ATTR, SWIPE_VAR, useSwipeTurn } from './use-swipe-turn';
import type { KeyHint, TourCard } from './deck';
import type { TourController } from './use-tour';

/** The wide card's reel width in card px. */
const REEL_WIDE_W: Record<'mouse' | 'touch', number> = { mouse: 448, touch: 400 };
/** The widest the wide card stands, and its margin from the window's sides and foot, in window px. */
const CARD_MAX_W = 960;
const CARD_MARGIN = 12;
/** The upright sheet's padding top and foot, and at each side, in card px. */
const SHEET_PAD_Y = 38;
const SHEET_PAD_X = 20;
/** Below this card width, or this window height, the dots take their own row. */
const DOTS_ROW_W = 900;
const SHORT_WINDOW_H = 500;
/** The share of a wide window's height the reel may take, so the words beside it keep their room. */
const WIDE_REEL_SHARE = 0.5;
/** The map an upright sheet leaves showing above it, in window px. */
const TALL_MAP_ROOM = 48;
/** The upright reel takes the height the sheet's words, bars and buttons leave it, up to this share of
 *  the window's height and the sheet's width at its aspect; only below the least, in card px, do the
 *  words scroll under their fade. */
const TALL_REEL_SHARE = 0.46;
const TALL_REEL_LEAST = 96;
/** Upright, below this window width the summary's tiles stand three across. */
const NARROW_WINDOW_W = 500;

/** The live window's layout for the deck: the form its reels are in and its sizes in card px, at the
 *  window's own zoom (`ModalShell` draws its card at `useGlidingChromeLift(WINDOW_ICON_BUTTON)`).
 *  `rest` is how tall an upright sheet stands without its reel's clip, which the clip takes what is
 *  left of the window from. */
export function useDeckLayout(rest = 0) {
  const inputMode = useCurrentInputMode();
  const shape = useLayoutShape();
  const { zoom } = useGlidingChromeLift(WINDOW_ICON_BUTTON);
  const { w, h } = useViewportSize();
  const form = reelForm(inputMode, shape);
  const tall = shape === 'portrait';
  const hand = inputMode === 'touch' ? 'touch' : 'mouse';
  const cardW = tall ? w / zoom : Math.min(CARD_MAX_W, w - 2 * CARD_MARGIN) / zoom;
  const maxH = (tall ? h - TALL_MAP_ROOM : h - 2 * CARD_MARGIN) / zoom;
  const reelH = tall
    ? Math.max(TALL_REEL_LEAST, Math.min((h * TALL_REEL_SHARE) / zoom, (cardW - 2 * SHEET_PAD_X) / REEL_ASPECT[form], maxH - rest))
    : Math.min(REEL_WIDE_W[hand] / REEL_ASPECT[form], (h * WIDE_REEL_SHARE) / zoom);
  const reelW = reelH * REEL_ASPECT[form];
  const dotsRow = !tall && (cardW * zoom < DOTS_ROW_W || h < SHORT_WINDOW_H);
  const enlarged = reelEnlargement({ w, h }, zoom, { w: reelW, h: reelH }, REEL_SIZE[form]);
  return { form, tall, zoom, cardW, maxH, reelW, reelH, enlarged, dotsRow, short: h < SHORT_WINDOW_H, narrow: w < NARROW_WINDOW_W };
}

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <span style={{
      ...roleFont('chip'), minWidth: 22, height: 24, padding: '0 6px', boxSizing: 'border-box', borderRadius: radii.sm,
      background: skin.plate, color: skin.plateInk, border: `1.5px solid ${skin.plateInk}`, borderBottomWidth: 3,
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>{children}</span>
  );
}

/** A card's keys at their live bindings; a hint whose command has no key is left out. */
function KeyHints({ hints, standIn = false }: { hints: readonly KeyHint[]; standIn?: boolean }) {
  const t = useReadingT();
  const overrides = useKeybinds((s) => s.overrides);
  const shown = hints.map((hint) => ({ hint, combos: hint.commands.map((id) => prettyCombo(effectiveCombo(overrides, id))) }))
    .filter(({ combos }) => combos.every(Boolean));
  if (shown.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px' }} data-testid={standIn ? undefined : 'tour-keys'}>
      {shown.map(({ hint, combos }) => (
        <span key={hint.labelKey} style={{ ...roleFont('chip'), color: skin.plateInk, display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <KeyCap>{combos.join(' ')}</KeyCap>
          {t(hint.labelKey)}
        </span>
      ))}
    </div>
  );
}

/** A dot's room either side of its mark, a dot's drawn size and the line it widens into for the card
 *  shown, in card px. */
const DOT_ROOM = 7;
const DOT = 8;
const DOT_LINE = 22;

/** Where the run stands among its cards; each dot goes to its card. The dot of the card shown widens
 *  into a short line as the one left shrinks back into a dot, the row and the dots beside them gliding. */
function Dots({ count, at, onGo }: { count: number; at: number; onGo: (i: number) => void }) {
  const t = useReadingT();
  const settle = useTransition('control.settle');
  return (
    <div role="group" aria-label={t('tour.dots')} style={{ display: 'flex', flex: 'none' }}>
      {Array.from({ length: count }, (_, i) => (
        <ActionButton
          key={i}
          interaction="tile"
          aria-label={t('tour.dot', { n: i + 1, total: count })}
          aria-current={i === at ? 'step' : undefined}
          onClick={() => onGo(i)}
          style={{ height: 24, padding: `0 ${DOT_ROOM}px`, border: 'none', background: 'transparent', cursor: cursors.clickable, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          {/* Its width is in the row's own px, which hold under the card's zoom. */}
          <motion.span
            data-tour-dot
            initial={false}
            animate={{ width: i === at ? DOT_LINE : DOT, backgroundColor: i === at ? skin.plateInk : i < at ? skin.muted : skin.track }}
            transition={settle}
            style={{ display: 'block', height: DOT, borderRadius: radii.sm }}
          />
        </ActionButton>
      ))}
    </div>
  );
}

/** The way the run last went: forward (Next, a later dot, the summary) or back. */
type Way = 1 | -1;

/** How far a part travels as it crosses over, in card px, and how long the words follow the reel. */
const CROSS_TRAVEL = MOTIONS['tour.copy.swap'].amplitude;
const WORDS_LAG = MOTIONS['tour.copy.swap'].stagger;

const crossingPart: CSSProperties = { gridArea: '1 / 1', display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 };

/** How a part travels: the whole part, or (`'inside'`) only what its reel's frame shows, through
 *  `REEL_SLIDE_VAR`, so the frame stands still. */
type Travel = 'part' | 'inside';

/** A crossing's offset `px` on the part, as its travel takes it. */
function travelTo(travel: Travel, px: number): TargetAndTransition {
  return travel === 'part' ? { x: px } : { [REEL_SLIDE_VAR]: `${px}px` };
}

/** One part of a crossing; popLayout measures the leaving one through its ref. A part that `swipes`
 *  follows a finger's swipe (`use-swipe-turn.ts`): the words move, the reel slides what it shows. */
type CrossingPartProps = { way: Way; lag: number; travel: Travel; swipes: boolean; style?: CSSProperties; onArrived: () => void; children: ReactNode };
const CrossingPart = forwardRef<HTMLDivElement, CrossingPartProps>(
  function CrossingPart({ way, lag, travel, swipes, style, onArrived, children }, ref) {
    const reduced = useReducedMotionConfig();
    const leaving = useLeavingView();
    // AnimatePresence hands a leaving part its latest `custom`: the way the run went to replace it.
    const variants = {
      before: (w: Way) => ({ opacity: 0, ...travelTo(travel, w * CROSS_TRAVEL) }),
      shown: { opacity: 1, ...travelTo(travel, 0), transition: reduced ? framerMotion('tour.copy.swap', true) : { ...framerMotion('tour.copy.swap'), delay: lag } },
      after: (w: Way) => ({ opacity: 0, ...travelTo(travel, -w * CROSS_TRAVEL), transition: reduced ? framerMotion('tour.copy.swap', true) : outMotion('tour.copy.swap') }),
    };
    return (
      <motion.div ref={ref} {...leaving} custom={way} variants={variants} initial={reduced ? false : 'before'} animate="shown" exit="after"
        onAnimationComplete={(name) => { if (name === 'shown') onArrived(); }}
        {...(swipes ? { [SWIPE_PART_ATTR]: '' } : null)}
        style={{ ...crossingPart, ...(swipes && travel === 'part' ? { translate: `var(${SWIPE_VAR}, 0px)` } : null), ...style }}>
        {children}
      </motion.div>
    );
  },
);

/**
 * A place in the card where one card's part (its reel, its words, or the whole screen for the summary)
 * crosses over to the next one's: the leaving part travels out the way the run went and leaves the
 * flow, so the card glides straight to the arriving part's height, as the arriving part travels in
 * from the other side. While a crossing plays the place clips its foot, so a taller leaving part
 * never stands over what follows, and its sides run on into the card's margin as they fade. The
 * reel's parts stand still and slide only what their rounded frames show, so no corner is cut, over
 * `under`, which keeps the frame's ground opaque as the two fade across each other.
 */
function Crossing({ id, way, lag = 0, travel = 'part', swipes = false, under, boxRef, style, partStyle, children }: {
  id: string;
  way: Way;
  lag?: number;
  travel?: Travel;
  swipes?: boolean;
  under?: ReactNode;
  boxRef?: Ref<HTMLDivElement>;
  style?: CSSProperties;
  partStyle?: CSSProperties;
  children: ReactNode;
}) {
  const { clip, settle } = useSwapClip(id, { fromRest: true, axes: 'block' });
  return (
    <div ref={boxRef} style={{ position: 'relative', display: 'grid', gridTemplateRows: 'minmax(0, 1fr)', minWidth: 0, minHeight: 0, ...style, ...clip }}>
      {under}
      <AnimatePresence mode="popLayout" initial={false} custom={way}>
        <CrossingPart key={id} way={way} lag={lag} travel={travel} swipes={swipes} style={partStyle} onArrived={settle}>{children}</CrossingPart>
      </AnimatePresence>
    </div>
  );
}

/** One card's words and keys; `corner` holds room beside the title. A `standIn` only takes the room
 *  the card's words take (`WordsRoom`). */
function CardBody({ card, corner, standIn = false }: { card: TourCard; corner?: ReactNode; standIn?: boolean }) {
  const t = useReadingT();
  const touch = useTouchMode();
  const ref = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(ref, 'y');
  // A stand-in only holds room, so its title is no heading: the deck keeps one heading per card shown.
  const Title = standIn ? 'div' : 'h2';
  // The words give way first where the window is short: they scroll under an edge fade, the buttons below them stay.
  // A scroller takes the touch-action of no ancestor, so in touch mode it leaves the sideways pan to the card's swipe itself.
  return (
    <div ref={standIn ? undefined : ref} data-tour-words={standIn ? undefined : ''} style={{
      display: 'flex', flexDirection: 'column', gap: 8, flex: '0 1 auto', minWidth: 0, minHeight: 0, overflowY: 'auto', ...(standIn ? null : fade),
      ...(touch ? { touchAction: 'pan-y' } : null),
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
        <Title style={{ ...windowTitle, textAlign: 'start', margin: 0, lineHeight: 1.2 }}>{t(card.titleKey)}</Title>
        {corner}
      </div>
      <p style={{ ...roleFont('body'), color: skin.muted, margin: 0, lineHeight: 1.45 }}>{t(card.bodyKey)}</p>
      {!touch && <KeyHints hints={card.keys} standIn={standIn} />}
    </div>
  );
}

/** The first match for `selector` under `root` outside a leaving part: the screen or card arriving. */
function arriving(root: HTMLElement | null, selector: string): HTMLElement | null {
  if (!root) return null;
  const all = root.querySelectorAll<HTMLElement>(selector);
  for (let i = 0; i < all.length; i++) if (!all[i]!.closest('[data-leaving]')) return all[i]!;
  return null;
}

export function TourDeck({ tour, open }: { tour: TourController; open: boolean }) {
  const t = useReadingT();
  const locale = useLocale();
  const [rest, setRest] = useState(0);
  const layout = useDeckLayout(rest);
  const handoff = useHandoffShift();
  const { phase, cards } = tour;
  const index = phase.kind === 'deck' ? phase.card : 0;
  const card = cards[index] ?? cards[0]!;
  const recap = phase.kind === 'recap';
  // The summary stands after the last card, so reaching it is a move forward and leaving it one back.
  const at = recap ? cards.length : index;
  const [move, setMove] = useState<{ at: number; way: Way }>({ at, way: 1 });
  let way = move.way;
  if (move.at !== at) {
    way = at > move.at ? 1 : -1;
    setMove({ at, way });
  }
  const files = useMemo(() => reelFiles(locale, layout.form, card.kind), [locale, layout.form, card.kind]);
  const nextFiles = useMemo(() => {
    const next = cards[index + 1];
    return next ? reelFiles(locale, layout.form, next.kind) : null;
  }, [cards, index, locale, layout.form]);
  // Once this card's reel plays, the next card's is fetched into the cache its own `<video>` reads.
  const prefetchNext = (): void => {
    if (!SUPPORTS_TOUR_REELS || !nextFiles || asksToSaveData()) return;
    const clip = playedReel(nextFiles);
    if (clip) void prefetchIntoCache(clip);
    if (nextFiles.poster) void prefetchIntoCache(nextFiles.poster);
  };
  const bodyRef = useRef<HTMLDivElement>(null);
  useHeightTransition(bodyRef, { motionId: 'tour.card.resize', resetKey: `${layout.form}:${phase.kind}` });
  // How tall the sheet's content stands without the clip, at its natural height (the words unscrolled).
  // The words and the reel are watched as well as the screen: a capped body stands still while they
  // change. A part leaving in a crossing is no longer the card's.
  useObservedSize(() => {
    const el = bodyRef.current;
    return [el, arriving(el, '[data-tour-screen]'), arriving(el, '[data-tour-words]'), arriving(el, '[data-testid="tour-reel"]')];
  }, () => {
    const el = bodyRef.current;
    const screen = arriving(el, '[data-tour-screen]');
    if (!screen) return;
    // While the reel stands enlarged, its place in the card keeps the clip's height in a stand-in.
    const clip = arriving(screen, '[data-testid="tour-reel-clip"]') ?? arriving(screen, '[data-tour-reel-stand-in]');
    const words = arriving(screen, '[data-tour-words]');
    const hidden = words ? words.scrollHeight - words.clientHeight : 0;
    // Each size read rounds to a whole px, so a px more keeps fractional words from scrolling by one.
    setRest(SHEET_PAD_Y + screen.scrollHeight + hidden - (clip?.offsetHeight ?? 0) + 1);
  }, [open, index, layout.form, phase.kind]);
  const pictured = useUiPreview();
  // In touch mode a swipe across a card turns it as Next and Back do; the summary and a picture take none.
  const touch = useTouchMode();
  const reduced = useReducedMotionConfig() === true;
  const swipe = useSwipeTurn({
    enabled: touch && !pictured && phase.kind === 'deck', forward: true, backward: index > 0, zoom: layout.zoom, reduced, onNext: tour.next, onBack: tour.back,
  });
  // Focus moves to the way on of each screen as it arrives (a card's Next, the summary's Start
  // building), so Enter walks the deck; it is taken off the incoming screen, never the one leaving.
  // Between cards Next stands still, so it is given focus again as each card arrives. A picture takes none.
  const focusScreen = useCallback((el: HTMLDivElement | null) => {
    if (el && !pictured) el.querySelector<HTMLElement>('[data-tour-way-on]')?.focus({ preventScroll: true });
  }, [pictured]);
  const nextRef = useRef<HTMLButtonElement>(null);
  const onCard = phase.kind === 'deck' ? phase.card : null;
  useEffect(() => {
    if (onCard !== null && !pictured) nextRef.current?.focus({ preventScroll: true });
  }, [onCard, pictured]);

  const sheet: CSSProperties = layout.tall
    ? { width: layout.cardW, maxWidth: 'none', maxHeight: layout.maxH, borderRadius: `${radii.panel}px ${radii.panel}px 0 0`, padding: `18px ${SHEET_PAD_X}px 20px`, borderBottom: 'none' }
    : { width: layout.cardW, maxWidth: 'none', maxHeight: layout.maxH, padding: recap ? '28px 32px 24px' : 18 };
  // Opened under the loading screen, the window rises into place with the app as the screen lifts.
  const backdrop: CSSProperties = layout.tall
    ? { alignItems: 'flex-end', padding: 0, ...handoff }
    : { alignItems: recap ? 'center' : 'flex-end', paddingBottom: recap ? 0 : layout.short ? CARD_MARGIN : 28, ...handoff };

  const back = (
    <ActionButton
      appearance="tertiary"
      onClick={tour.back}
      aria-hidden={index === 0 || undefined}
      tabIndex={index === 0 ? -1 : undefined}
      style={{ visibility: index === 0 ? 'hidden' : 'visible', padding: '10px 14px' }}
    >{t('tour.back')}</ActionButton>
  );
  const nextButton = (
    <ActionButton ref={nextRef} data-tour-way-on appearance="primary" onClick={tour.next} style={layout.tall ? { flex: '1 1 auto' } : { flex: 'none', minWidth: 104 }}>
      {t('tour.next')}
    </ActionButton>
  );
  const dots = <Dots count={cards.length} at={index} onGo={tour.go} />;
  const skipStyle: CSSProperties = { padding: '6px 10px', flex: 'none' };
  const skip = (
    <ActionButton appearance="tertiary" onClick={tour.finish} style={skipStyle}>{t('tour.skip')}</ActionButton>
  );
  // Beside a wide card's title Skip stands over the words rather than in them, so it stays as they
  // cross over; the words keep its room with an unseen box drawn as it is. Not a button, so the
  // window holds one Skip to find and press.
  const skipRoom = (
    <span aria-hidden style={{ ...windowFooterTertiary, ...skipStyle, display: 'inline-block', visibility: 'hidden' }}>{t('tour.skip')}</span>
  );
  const gap = layout.tall ? 12 : 10;
  const showMe = card.show?.length ? <ShowMeButton onPress={tour.showMe} /> : null;
  // The frame's ground under both cards' reels; the parts stand over it in their own order.
  const reelGround = files ? (
    <div aria-hidden style={{
      position: 'absolute', top: 0, left: layout.tall ? `calc(50% - ${layout.reelW / 2}px)` : 0,
      width: layout.reelW, height: layout.reelH, borderRadius: reelRadius(layout.reelW, layout.reelH), background: skin.inset,
    }} />
  ) : null;
  const reel = (
    <Crossing id={card.kind} way={way} travel="inside" swipes under={reelGround} style={{ flex: 'none' }} partStyle={{ position: 'relative' }}>
      <TourReel files={files} width={layout.reelW} height={layout.reelH} centred={layout.tall}
        enlarge={pictured ? null : layout.enlarged} onPlaying={prefetchNext} />
    </Crossing>
  );
  // Every card's words stand unseen under the crossing, so its place takes the tallest card's room and
  // no card's words move the dots and buttons under them.
  const wordsRoom = (
    <div aria-hidden {...{ inert: '' }} data-tour-words-room style={{ gridArea: '1 / 1', display: 'grid', minWidth: 0, minHeight: 0, visibility: 'hidden', pointerEvents: 'none' }}>
      {cards.map((c) => (
        <div key={c.kind} style={{ gridArea: '1 / 1', display: 'flex', flexDirection: 'column', gap, minWidth: 0, minHeight: 0 }}>
          <CardBody card={c} corner={layout.tall ? undefined : skipRoom} standIn />
          {c.show?.length ? <ShowMeButton onPress={tour.showMe} standIn /> : null}
        </div>
      ))}
    </div>
  );
  const words = (
    <Crossing id={card.kind} way={way} lag={WORDS_LAG} swipes under={wordsRoom} style={{ flex: '0 1 auto' }} partStyle={{ gap }}>
      <CardBody card={card} corner={layout.tall ? undefined : skipRoom} />
      {showMe}
    </Crossing>
  );

  return (
    <ModalShell
      size="panel"
      open={open}
      onClose={tour.finish}
      helpTarget={{ page: 'tour' }}
      ariaLabel={recap ? t('tour.recap_title') : t('tour.label')}
      testId="tour-deck"
      backdropStyle={backdrop}
      cardStyle={{ ...sheet, boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
    >
      {/* The cards and the summary cross over as screens; between cards only the reel and the words do. */}
      <Crossing id={recap ? 'recap' : 'deck'} way={way} boxRef={bodyRef} style={{ flex: '0 1 auto' }}>
        {/* It never grows past its content: `rest` reads its height, and a screen stretched to a body still
            gliding, or left taller than its content, would hand the reel that room a px a frame. */}
        <div ref={focusScreen} data-tour-screen {...swipe} style={{ display: 'flex', flexDirection: 'column', gap: 12, flex: '0 1 auto', minWidth: 0, minHeight: 0, ...swipe.style }}>
          {recap ? <TourRecap tour={tour} layout={layout} /> : layout.tall ? (
            <>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8 }}>{skip}</div>
              {reel}
              {words}
              <div style={{ display: 'flex', justifyContent: 'center' }}>{dots}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{back}{nextButton}</div>
            </>
          ) : (
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start', minHeight: 0 }}>
              {reel}
              <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', gap: 10, flex: '1 1 auto', minWidth: 0, minHeight: 0, alignSelf: 'stretch' }}>
                {words}
                <div style={{ position: 'absolute', top: 0, insetInlineEnd: 0 }}>{skip}</div>
                <div style={{ flex: '1 1 auto' }} />
                {layout.dotsRow && dots}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {!layout.dotsRow && dots}
                  <div style={{ flex: '1 1 auto' }} />
                  {back}
                  {nextButton}
                </div>
              </div>
            </div>
          )}
        </div>
      </Crossing>
    </ModalShell>
  );
}

function ShowMeButton({ onPress, standIn = false }: { onPress: () => void; standIn?: boolean }) {
  const t = useReadingT();
  const landing = useSyncExternalStore(onEditsInFlightChange, editsInFlight);
  const openable = useEditorStore((s) => showMeOpenable(s, landing));
  return (
    <ActionButton appearance="secondary" unavailable={!openable} onClick={onPress} style={{ alignSelf: 'flex-start', padding: '8px 18px' }} data-testid={standIn ? undefined : 'tour-show-me'}>
      {t('tour.show_me')}
    </ActionButton>
  );
}
