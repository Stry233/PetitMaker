import { framerMotion } from '../../design/motion';
/**
 * Non-blocking arrival notice with map art, name, and actions. Additional arrival facts rotate one
 * line at a time; reduced motion keeps the information changes but removes cross-fades. The card
 * glides to changed content size and uses `TimedButton` for automatic acknowledgement. Manual actions
 * decline a saved-map offer, while timeout leaves that separate offer untouched.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { iconUrl } from '../../../assets/icon-urls';
import { useT } from '../../../i18n/context';
import { timedHint } from '../timed-hint';
import { useEditorStore } from '../../../state/store';
import type { Arrival, ArrivalLine } from '../../session/arrival-bus';
import { setArrivalStanding, subscribeArrival } from '../../session/arrival-bus';
import { declineRestoreOffer } from '../../session/restore-offer';
import { shellEngaged, useShellEngaged, useVisitorEngaged } from '../../session/engagement';
import type { MapTemplate } from '../../../core/model/types';
import { useChromeLayer } from '../../primitives/chrome-layer';
import { NOTICE_CONTROL, useNoticeZoom } from '../../primitives/NoticeBar';
import { roleFont } from '../../design/text-weight';
import { btnReset, font, radii, z } from '../../design/styles';
import { TimedButton } from '../../primitives/TimedButton';
import { useGlidingChromeScale, useViewportSize } from '../../design/scale';
import { useSizeGlide } from '../../primitives/use-size-glide';
import { useObservedSize } from '../../primitives/use-observed-size';
import { useRootCssVars } from '../../primitives/use-root-css-vars';
import { tourSettled } from '../tour/use-tour';
import { usePlanetName } from '../modals/planet/use-planet-library';
import { ARRIVAL_AIR, ARRIVAL_ROW, ARRIVAL_ROW_VAR, arrivalTop, bandCentre, bandMaxWidth, fromChromePx, toastRow, uprightArrivalTop } from './toast-band';
import { ARRIVAL_LEAD_KEY, arrivalLines, arrivalNoticeOpens } from './arrival-gate';
import { PANEL_EDGE, PLATE, FRAME_INK, MUTED, SURFACE_SECONDARY } from '../../design/tokens';
import { useInteractionProfiles, useLayoutShape, useTouchMode } from '../../design/input-mode';
import { useMorph } from '../../primitives/morph';

/** Seconds the final line remains visible. */
const ARRIVAL_AFTER_S = 8;

/** How long each eyebrow line holds before the next takes the row, in ms. */
const EYEBROW_SWAP_MS = 3000;

/** The crossfade from one eyebrow line to the next: the house's settle curve, at the length a line
 *  needs to change. A tween rather than a spring, since nothing is moving and a spring's tail on an
 *  opacity reads as a line that cannot decide. */
const CROSSFADE = framerMotion('notice.crossfade');

/** The planet's art, in css px. */
const ART = 48;

/** The eyebrow's and the name's line heights, in css px: the words stand two lines tall. */
const EYEBROW_LINE = 16;
const NAME_LINE = 24;

/** The upright card's measures (mockup D4): one row of art, words and answers that a phone's width
 *  holds, the eyebrow and the name giving way to an ellipsis before anything wraps. The art stands as
 *  tall as the two lines of words beside it, as the wide card's does. */
const COMPACT = { art: EYEBROW_LINE + NAME_LINE, gap: 8, answersGap: 8, padding: '8px 8px 8px 10px', answerPadX: 10 } as const;

/** The empty sequence, as one value: a fresh array each render would restart the cycle's timers. */
const NO_LINES: readonly ArrivalLine[] = [];


/** Where the notice stands, its band places written in chrome px and converted to its own by `ratio`
 *  (`toast-band.ts:fromChromePx`). */
function containerStyle(ratio: number, maxWidth: string, upright: boolean): CSSProperties {
  return {
    position: 'fixed',
    top: fromChromePx(arrivalTop(toastRow(ratio)), ratio),
    // The toast band's own centring (`Toast.tsx`): over the work, clear of a docked panel's strip.
    left: bandCentre(ratio, upright),
    transform: 'translateX(-50%)',
    // Held at its words' width: from `left: 50%` a fitted box would only have the half window to
    // its right, which a notice drawn above the chrome's zoom can outgrow.
    // Never past the window, less a margin each side: a long language wraps the answers under the words.
    width: 'max-content',
    maxWidth,
    zIndex: z.notice,
    display: 'flex',
    justifyContent: 'center',
    pointerEvents: 'none',
  };
}

/** Upright, the notice stands under the top row at its words' width, centred like the band and
 *  never past the frame's side margins or into a docked panel's strip (`bandMaxWidth`). */
function uprightContainerStyle(ratio: number, maxWidth: string): CSSProperties {
  return {
    ...containerStyle(ratio, maxWidth, true),
    top: fromChromePx(uprightArrivalTop(toastRow(ratio)), ratio),
  };
}

/** While the box is gliding it is narrower or wider than what stands in it, and the content must
 *  not re-lay itself out over those few hundred ms. The words keep their settled size (`flexShrink: 0`
 *  below) and the row clips. */
const glidingStyle: CSSProperties = { overflow: 'hidden' };

const cardStyle: CSSProperties = {
  background: PLATE,
  color: FRAME_INK,
  fontFamily: font.family,
  padding: '12px 16px',
  borderRadius: radii.card,
  // A card standing on the map meets it with the panel hairline and casts nothing (`tokens.ts`).
  border: PANEL_EDGE,
  boxShadow: 'none',
  display: 'flex',
  alignItems: 'center',
  columnGap: 14,
  pointerEvents: 'auto',
  flexWrap: 'wrap',
  rowGap: 12,
  // Held to the band's width, which a long name's own width would otherwise push it past.
  minWidth: 0,
};

/**
 * The picture and the words, the box the resize animates. A row of its own: a ref on the presence
 * card itself draws a React warning, and clipping here puts the moving edge inside the card's
 * padding. Every width change is the eyebrow's, so the clip only eats the tail of a crossfading line.
 * The answers stand outside the row, carried by the card's edge, so a growing card never slices the
 * second button and the OK's outer countdown ring has nothing to cut it.
 */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  // Never wider than the card can stand, so a long name truncates rather than overhanging it.
  minWidth: 0,
  maxWidth: '100%',
};

/** The two answers as one group, held a little off the words: the OK's countdown ring is drawn
 *  outside the button, so the card's own gap would leave it nearly touching the sentence beside it. */
const answersStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  // The air off the words, as padding so `marginLeft: auto` can push the group to the card's far
  // end, also when a narrow card wraps it onto its own line.
  paddingLeft: 6,
  marginLeft: 'auto',
  flex: 'none',
};

/** The eyebrow is always one line: a longer line widens the notice (the row glides to it) up to the
 *  band's bound, and only a line past that bound ends in an ellipsis, so a change of line never
 *  changes the notice's height. */
const eyebrowStyle: CSSProperties = {
  ...roleFont('caption'),
  lineHeight: `${EYEBROW_LINE}px`,
  color: MUTED,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  minWidth: 0,
};

const nameStyle: CSSProperties = {
  ...roleFont('lead'),
  lineHeight: `${NAME_LINE}px`,
  color: FRAME_INK,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

/** The two answers share everything but their fill: one row, one height, one word each. */
const answerStyle: CSSProperties = {
  ...btnReset,
  position: 'relative',
  borderRadius: radii.pill,
  padding: '6px 16px',
  ...roleFont('menu'),
  fontFamily: font.family,
  whiteSpace: 'nowrap',
  flex: 'none',
};

/** What is on screen: the arrival, and the planet it was about. The template is snapshot rather
 *  than read live, so a notice already up keeps describing the arrival it was posted for.
 *
 *  `seq` counts the arrivals this notice has shown. It keys the countdown, so an arrival that
 *  Replaces one already up (resuming the saved session under a standing notice) starts the clock
 *  again: the new eyebrow has a phrase and a detail three seconds behind it to get through, and a
 *  fuse carried over from the previous arrival could be a second from the end. The card is not
 *  keyed by it — the words change, the notice does not arrive twice. */
interface Shown {
  arrival: Arrival;
  template: MapTemplate;
  seq: number;
}

/**
 * The one line above the name, and the change from each line to the next.
 *
 * One cell of a grid, so the outgoing line and the incoming one cross in the same box: one fades
 * out exactly where the other fades in, and the row is as wide as the wider of the two for those
 * few hundred ms. That is deliberate, and it is why the card's width is measured twice per line
 * (`onCrossed`, in `ArrivalCard`) — a box that shrank while a line was still fading would pull
 * the ground out from under it. Taking the outgoing line out of flow instead (Framer's `popLayout`)
 * parks it at the position it had while the card travels away from it, which reads as two lines
 * sliding apart; checked in a browser.
 */
function Eyebrow({ text, onCrossed }: { text: string; onCrossed: () => void }) {
  const reduced = useReducedMotionConfig();
  // A cut, which is what reduced motion asks for: the change itself is information and stays.
  if (reduced) return <span data-testid="arrival-eyebrow" style={eyebrowStyle} title={text}>{text}</span>;
  return (
    // A track that may shrink below its lines, so a line past the band's bound truncates.
    <span style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', minWidth: 0 }}>
      <AnimatePresence initial={false} onExitComplete={onCrossed}>
        <motion.span
          key={text}
          data-testid="arrival-eyebrow"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={CROSSFADE}
          style={{ ...eyebrowStyle, gridArea: '1 / 1' }}
          title={text}
        >
          {text}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/**
 * The notice card itself, extracted so the Help Center can stand one as a live figure: the same
 * plate, planet art, eyebrow, name and answer row the arrival shows. `measureKey` drives the width
 * glide (the live notice keys it by its line cycle; a figure passes a constant), and `paused`
 * holds the OK countdown still for a card that is a picture rather than a question.
 */
export function ArrivalCard({ art, eyebrow, name, seq, paused, onOk, onSwitch, measureKey, compact = false }: {
  art: string | undefined;
  eyebrow: string;
  name: string;
  seq: number;
  paused?: boolean;
  onOk: (byClock: boolean) => void;
  onSwitch: () => void;
  measureKey: string;
  /** One row at `COMPACT` measures that never wraps, for an upright window. */
  compact?: boolean;
}) {
  const t = useT();
  /**
   * Bumped once two eyebrow lines have finished crossing, which asks for a second measurement.
   *
   * Both lines share one box while they cross, so for those few hundred ms the row is as wide as
   * the wider of the two. The first measurement therefore eases the card out to fit an arriving
   * line that is longer; this one lets it come back in once a line that was longer has gone. A card
   * that shrank mid-fade would pull the ground out from under a line still on screen.
   *
   * A counter rather than a flag: a flag reset in an effect lands in the same flush as the line
   * change and cancels the first glide before it has drawn a frame, which snaps every line that grows.
   */
  const [crossed, setCrossed] = useState(0);
  const onCrossed = useCallback(() => setCrossed((n) => n + 1), []);
  const measured = `${measureKey}:${crossed}`;
  // The words' settled width, read before the glide holds the row at its old size: while the row
  // travels the words keep the layout they land in (a capped card's eyebrow or name already cut)
  // rather than their unshrunk one, which would change at the landing.
  const words = useRef<HTMLSpanElement>(null);
  const [wordsW, setWordsW] = useState<number | null>(null);
  // The computed width keeps the fraction `offsetWidth` rounds off: a box held a fraction of a pixel
  // narrower than its line would cut that line short for the length of the glide.
  useLayoutEffect(() => {
    const el = words.current;
    if (!el) return;
    const computed = parseFloat(getComputedStyle(el).width);
    setWordsW(Number.isFinite(computed) ? computed : el.offsetWidth);
  }, [measured]);
  const row = useSizeGlide<HTMLDivElement>(measured, { axis: 'width', motionId: 'notice.resize' });
  const profiles = useInteractionProfiles();
  // A finger answers here, so touch mode draws each answer a fingertip tall and the notice's zoom
  // keeps it so on screen (`NoticeBar.tsx:useNoticeZoom`).
  const touchAnswer: CSSProperties = useTouchMode()
    ? { ...answerStyle, minHeight: NOTICE_CONTROL, display: 'flex', alignItems: 'center' } : answerStyle;
  // Compact, a one-character answer still draws at least as wide as it is tall.
  const answer: CSSProperties = compact
    ? { ...touchAnswer, padding: `6px ${COMPACT.answerPadX}px`, minWidth: NOTICE_CONTROL, justifyContent: 'center' }
    : touchAnswer;
  const card: CSSProperties = compact ? { ...cardStyle, padding: COMPACT.padding, columnGap: COMPACT.gap, flexWrap: 'nowrap' } : cardStyle;
  const rowBase: CSSProperties = compact ? { ...rowStyle, gap: COMPACT.gap } : rowStyle;
  const artSize = compact ? COMPACT.art : ART;
  return (
    <motion.div
      key="arrival"
      data-testid="arrival-toast"
      // Wide, the answers take a line of their own at the far end when the words leave them no room.
      style={card}
      initial={{ opacity: 0, y: -20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // The sibling toast's own exit: a clean slide out rather than a spring back, so the
      // per-variant transition wins over the bouncy entrance.
      exit={{ opacity: 0, y: -10, scale: 0.96, transition: framerMotion('notice.leave') }}
      transition={framerMotion('surface.pop')}
    >
      <div
        ref={row.ref}
        data-testid="arrival-row"
        style={row.gliding ? { ...rowBase, ...glidingStyle } : rowBase}
      >
        {art && (
          <img
            src={art}
            alt=""
            draggable={false}
            style={{ width: artSize, height: artSize, objectFit: 'contain', flex: 'none' }}
          />
        )}
        {/* Shrinks only at rest: mid-glide the words hold their settled width and the row clips. */}
        <span
          ref={words}
          style={{ display: 'flex', flexDirection: 'column', minWidth: 0, ...(row.gliding && wordsW !== null ? { flexShrink: 0, width: wordsW } : { flexShrink: 1 }) }}
        >
          <Eyebrow text={eyebrow} onCrossed={onCrossed} />
          <span style={nameStyle} title={name}>{name}</span>
        </span>
      </div>
      <span style={compact ? { ...answersStyle, gap: COMPACT.answersGap, paddingLeft: 0 } : answersStyle}>
        {/* No `paused` from the card itself: TimedButton pauses under a pointer on the button, and
            a hold taken from the whole notice would be taken by a pointer parked anywhere in this
            band of the map, which is not someone reading. A keyboard visitor reaches OK before the
            other answer and its own focus cancels the clock outright. */}
        <TimedButton
          key={seq}
          after={ARRIVAL_AFTER_S}
          hint={timedHint(t, ARRIVAL_AFTER_S)}
          paused={paused}
          onPress={onOk}
          data-testid="arrival-ok"
          style={{ ...answer, background: FRAME_INK, color: PLATE }}
        >
          {t('arrival.ok')}
        </TimedButton>
        <motion.button
          type="button"
          {...profiles.action}
          data-testid="arrival-switch"
          onClick={onSwitch}
          style={{ ...answer, background: SURFACE_SECONDARY, color: FRAME_INK }}
        >
          {t('arrival.switch')}
        </motion.button>
      </span>
    </motion.div>
  );
}

interface ArrivalToastProps {
  /** The boot splash still owns the screen. */
  splashActive: boolean;
}

export function ArrivalToast({ splashActive }: ArrivalToastProps) {
  const t = useT();
  const setModal = useEditorStore((s) => s.setModal);
  // Subscribed for the retry they trigger rather than for their values: the gate below reads the
  // store live, because the check is deferred past the commit these are read in.
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const whatsNewOpen = useEditorStore((s) => s.modals.whatsNew);
  const repairOpen = useEditorStore((s) => s.repairSession !== null);
  const gridState = useEditorStore((s) => s.gridState);
  const visitorBusy = useShellEngaged();
  const layer = useChromeLayer({ control: NOTICE_CONTROL });
  const zoom = useNoticeZoom();
  const ratio = useGlidingChromeScale() / zoom;
  // A docked panel's strip is not the notice's to stand in: it centres on the rest of the window.
  const upright = useLayoutShape() === 'portrait';
  const maxWidth = bandMaxWidth(useViewportSize().w, zoom, ratio, upright);
  // The row the notice takes in the band, in chrome px, for the dev notice stacked under it.
  const band = useRef<HTMLDivElement>(null);
  const [row, setRow] = useState(ARRIVAL_ROW);
  useObservedSize(() => band.current, ([el]) => { if (el) setRow(Math.max(ARRIVAL_ROW, el.offsetHeight + ARRIVAL_AIR)); }, []);
  useRootCssVars({ [ARRIVAL_ROW_VAR]: `${row / ratio}px` });

  const [pending, setPending] = useState<Arrival | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  /** Which line the eyebrow is on: 0 is the arrival phrase, 1..n the arrival's own lines. */
  const [step, setStep] = useState(0);
  const seq = useRef(0);
  const lines = shown ? arrivalLines(shown.arrival) : NO_LINES;
  // Keyed on the line as well as the arrival: each one is a different width, and the box follows
  // whichever is being said.

  useEffect(() => subscribeArrival(setPending), []);

  // Surfaces that would cover the notice hear whether it stands.
  const standing = shown !== null;
  useEffect(() => {
    setArrivalStanding(standing);
    return () => setArrivalStanding(false);
  }, [standing]);

  useEffect(() => {
    if (!pending) return undefined;
    // Deferred past this commit's effects. The first-launch check runs in one of them and can decide
    // to open the tour, or waive it by writing a flag that moves no store field at all; a check made
    // inline would read a browser that has not been asked yet as one that has answered. The facts
    // are read live in here for the same reason.
    const timer = setTimeout(() => {
      const st = useEditorStore.getState();
      const open = arrivalNoticeOpens({
        splashActive,
        tourRunning: st.tourRunning,
        whatsNewOpen: st.modals.whatsNew,
        repairOpen: st.repairSession !== null,
        tourSettled: tourSettled(),
      }, shellEngaged());
      const template = st.gridState?.template;
      if (!open || !template) return;
      seq.current += 1;
      setShown({ arrival: pending, template, seq: seq.current });
      setPending(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pending, splashActive, tourRunning, whatsNewOpen, repairOpen, visitorBusy, gridState]);

  // A greeting gives way once the visitor sets to work, as the welcome-back offer does.
  const engaged = useVisitorEngaged(shown !== null);
  useEffect(() => { if (engaged) setShown(null); }, [engaged]);

  // A landmark repair asked over the notice standing: it waits as an arrival announced then would,
  // and is said again once the repair ends.
  useEffect(() => {
    if (!repairOpen || !shown) return;
    setPending((held) => held ?? shown.arrival);
    setShown(null);
  }, [repairOpen, shown]);

  // The cycle: the phrase holds one cadence, then each line takes the row in turn and the last one
  // stays. One timer per line rather than a chain, so a step cannot drift by the length of a render.
  useEffect(() => {
    setStep(0);
    if (lines.length === 0) return undefined;
    const timers = lines.map((_, i) => setTimeout(() => setStep(i + 1), EYEBROW_SWAP_MS * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [shown, lines]);

  /** Taking the notice. A hand on it also answers the saved-session offer standing at the foot of
   *  the map: whoever presses OK has said this is where they are, and the offer's own path is what
   *  puts it away. The countdown's own press is not an answer and leaves the card alone. */
  const dismiss = useCallback((byClock: boolean) => {
    if (!byClock) declineRestoreOffer();
    setShown(null);
  }, []);
  const switchPlanet = useCallback(() => {
    declineRestoreOffer();
    setShown(null);
    setModal('newProject', true);
  }, [setModal]);

  const art = shown ? iconUrl(`planet-${shown.template.id}`) : undefined;
  const planetName = usePlanetName(shown?.template);
  // Resolved here rather than held on the arrival, so the words follow a locale changed while the
  // notice is standing.
  const line = lines[step - 1];
  const eyebrow = shown
    ? (line ? t(line.key, line.params) : t(ARRIVAL_LEAD_KEY[shown.arrival.kind]))
    : '';

  // Its answers stand taller under a finger, so its content crossfades through a switch.
  const morph = useMorph('arrival', undefined, { reflows: true });
  return (
    // The live region is the container, which is mounted for the app's life: a region announces
    // what appears inside it, so one that arrives already holding its message announces nothing.
    <div ref={band} role="status" {...morph} style={{ ...layer, ...(upright ? uprightContainerStyle(ratio, maxWidth) : containerStyle(ratio, maxWidth, false)) }}>
      <AnimatePresence>
        {shown && (
          <ArrivalCard
            art={art}
            eyebrow={eyebrow}
            name={planetName}
            seq={shown.seq}
            onOk={dismiss}
            onSwitch={switchPlanet}
            measureKey={`${shown.seq}:${step}`}
            compact={upright}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
