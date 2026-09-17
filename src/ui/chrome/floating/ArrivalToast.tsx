/**
 * Non-blocking arrival notice with map art, name, and actions. Additional arrival facts rotate one
 * line at a time; reduced motion keeps the information changes but removes cross-fades. The card
 * glides to changed content size and uses `TimedButton` for automatic acknowledgement. Manual actions
 * decline a saved-map offer, while timeout leaves that separate offer untouched.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { iconUrl } from '../../../assets/icon-urls';
import { useT, localizedName } from '../../../i18n/context';
import { useEditorStore } from '../../../state/store';
import type { Arrival, ArrivalLine } from '../../../core/runtime/arrival-bus';
import { subscribeArrival } from '../../../core/runtime/arrival-bus';
import { declineRestoreOffer } from '../../../core/runtime/restore-offer';
import type { MapTemplate } from '../../../core/model/types';
import { useChromeScale, useWeightVars } from '../../design/scale';
import { roleFont } from '../../design/text-weight';
import { btnReset, buttonMotion, colors, exitTransition, font, inkTint, radii, springs, z } from '../../design/styles';
import { TimedButton } from '../../primitives/TimedButton';
import { useSizeGlide } from '../../hooks/use-size-glide';
import { hasSeenTour } from '../tour/use-tour';
import { TOAST_BAND_ROW, TOAST_BAND_TOP } from './toast-band';
import { ARRIVAL_LEAD_KEY, arrivalLines, arrivalOpens } from './arrival-gate';

/** Seconds the final line remains visible. */
export const ARRIVAL_AFTER_S = 8;

/** How long each eyebrow line holds before the next takes the row, in ms. */
export const EYEBROW_SWAP_MS = 3000;

/** Countdown duration that gives the final rotated line a full reading beat. */
export function arrivalFuseS(lines: number): number {
  const BEAT_S = 4;
  return Math.max(ARRIVAL_AFTER_S, lines * (EYEBROW_SWAP_MS / 1000) + BEAT_S);
}

/** The crossfade from one eyebrow line to the next: the house's settle curve, at the length a line
 *  needs to change. A tween rather than a spring, since nothing is moving and a spring's tail on an
 *  opacity reads as a line that cannot decide. */
const CROSSFADE_S = 0.22;
const CROSSFADE = { duration: CROSSFADE_S, ease: exitTransition.ease };

/** The planet's art, in css px. */
const ART = 48;

/** The empty sequence, as one value: a fresh array each render would restart the cycle's timers. */
const NO_LINES: readonly ArrivalLine[] = [];

const containerStyle: CSSProperties = {
  position: 'fixed',
  top: TOAST_BAND_TOP + TOAST_BAND_ROW,
  // The toast band's own centring, and it moves for the same reason (`Toast.tsx`): a docked panel
  // owns a strip at one side of the window, and the band stands over the work.
  left: 'calc(50% + (var(--pin-dock-left, 0px) - var(--pin-dock-right, 0px)) / 2)',
  transform: 'translateX(-50%)',
  zIndex: z.toast,
  display: 'flex',
  justifyContent: 'center',
  pointerEvents: 'none',
};

/** While the box is gliding it is narrower or wider than what stands in it, and the content must
 *  not re-lay itself out over those few hundred ms — a wrapping eyebrow would take a second line and
 *  give it back. The children keep their own size (`flexShrink: 0` below) and the row clips. */
const glidingStyle: CSSProperties = { overflow: 'hidden' };

const cardStyle: CSSProperties = {
  background: colors.panelCream,
  color: colors.frameDark,
  fontFamily: font.family,
  padding: '12px 16px',
  borderRadius: 20,
  boxShadow: `0 10px 28px ${inkTint(0.22)}, 0 2px 6px ${colors.inkBorder}`,
  display: 'flex',
  alignItems: 'center',
  gap: 14,
  pointerEvents: 'auto',
};

/**
 * The picture and the words, and the box the resize actually animates.
 *
 * A ROW OF ITS OWN rather than the card itself, for two reasons. The card is a presence child, and a
 * ref handed to one is read back by the library in a way React warns about; and clipping HERE puts
 * the moving edge inside the card's own padding, so what the clip takes comes out from behind the
 * cream rather than off the card's edge. The card is auto-width, so its box follows this one.
 *
 * THE ANSWERS ARE NOT IN IT, and that is what decides where the clip falls. Every width this notice
 * has ever changed by is the eyebrow's, so the row that changes size is the picture and the words —
 * and a clip only ever eats the tail of a line that is mid-crossfade. Inside the row, the two
 * answers stood at the far end of it: a card growing from 300 to 360 held them 60 px past its own
 * clip for the length of the travel, and what that looks like is the second button sliced down its
 * right side. Outside it they are simply carried along by the card's edge, fully drawn throughout,
 * and the countdown ring the OK draws OUTSIDE itself has nothing to be cut by either.
 */
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 14,
};

/** The two answers as one group, held a little off the words: the OK's countdown ring is drawn
 *  OUTSIDE the button, so the card's own gap would leave it nearly touching the sentence beside it. */
const answersStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginLeft: 6,
  flex: 'none',
};

/** The eyebrow WRAPS where the name below it does not: a transfer hands over a written report,
 *  which has no length this card can promise, and a line that stretched the notice across the map
 *  would be worse than a second line. The strut holds the box at the taller of the two, so a
 *  wrapped detail cannot grow the card as it arrives either. */
const eyebrowStyle: CSSProperties = {
  ...roleFont('caption'),
  lineHeight: '16px',
  color: colors.brownText,
  maxWidth: 280,
};

const nameStyle: CSSProperties = {
  ...roleFont('lead'),
  lineHeight: '24px',
  color: colors.frameDark,
  whiteSpace: 'nowrap',
};

/** The two answers share everything but their fill: one row, one height, one word each. */
const answerStyle: CSSProperties = {
  ...btnReset,
  borderRadius: radii.pill,
  padding: '7px 16px',
  ...roleFont('menu'),
  fontFamily: font.family,
  whiteSpace: 'nowrap',
  flex: 'none',
};

/** What is on screen: the arrival, and the planet it was about. The template is SNAPSHOT rather
 *  than read live, so a notice already up keeps describing the arrival it was posted for.
 *
 *  `seq` counts the arrivals this notice has shown. It keys the countdown, so an arrival that
 *  REPLACES one already up (resuming the saved session under a standing notice) starts the clock
 *  again: the new eyebrow has a phrase and a detail three seconds behind it to get through, and a
 *  fuse carried over from the previous arrival could be a second from the end. The CARD is not
 *  keyed by it — the words change, the notice does not arrive twice. */
interface Shown {
  arrival: Arrival;
  template: MapTemplate;
  seq: number;
}

/**
 * The one line above the name, and the change from each line to the next.
 *
 * ONE CELL OF A GRID, so the outgoing line and the incoming one cross in the SAME box: one fades
 * out exactly where the other fades in, and the row is as wide as the wider of the two for those
 * few hundred ms. That is deliberate, and it is why the card's width is measured TWICE per line
 * (see `settled` in the notice below) — a box that shrank while a line was still fading would pull
 * the ground out from under it. Taking the outgoing line out of flow instead (Framer's `popLayout`)
 * parks it at the position it had while the card travels away from it, which reads as two lines
 * sliding apart; checked in a browser.
 */
function Eyebrow({ text }: { text: string }) {
  const reduced = useReducedMotionConfig();
  // A cut, which is what reduced motion asks for: the change itself is information and stays.
  if (reduced) return <span data-testid="arrival-eyebrow" style={eyebrowStyle}>{text}</span>;
  return (
    <span style={{ display: 'grid' }}>
      <AnimatePresence initial={false}>
        <motion.span
          key={text}
          data-testid="arrival-eyebrow"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={CROSSFADE}
          style={{ ...eyebrowStyle, gridArea: '1 / 1' }}
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
export function ArrivalCard({ art, eyebrow, name, seq, paused, onOk, onSwitch, measureKey }: {
  art: string | undefined;
  eyebrow: string;
  name: string;
  seq: number;
  paused?: boolean;
  onOk: (byClock: boolean) => void;
  onSwitch: () => void;
  measureKey: string;
}) {
  const t = useT();
  const row = useSizeGlide<HTMLDivElement>(measureKey, { axis: 'width' });
  return (
    <motion.div
      key="arrival"
      data-testid="arrival-toast"
      style={cardStyle}
      initial={{ opacity: 0, y: -20, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      // The sibling toast's own exit: a clean slide out rather than a spring back, so the
      // per-variant transition wins over the bouncy entrance.
      exit={{ opacity: 0, y: -10, scale: 0.96, transition: { duration: 0.2, ease: [0.4, 0, 1, 1] } }}
      transition={springs.bouncy}
    >
      <div
        ref={row.ref}
        data-testid="arrival-row"
        style={row.gliding ? { ...rowStyle, ...glidingStyle } : rowStyle}
      >
        {art && (
          <img
            src={art}
            alt=""
            draggable={false}
            style={{ width: ART, height: ART, objectFit: 'contain', flex: 'none' }}
          />
        )}
        <span style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flexShrink: 0 }}>
          <Eyebrow text={eyebrow} />
          <span style={nameStyle}>{name}</span>
        </span>
      </div>
      <span style={answersStyle}>
        {/* No `paused` from the card itself: TimedButton pauses under a pointer on the BUTTON, and
            a hold taken from the whole notice would be taken by a pointer parked anywhere in this
            band of the map, which is not someone reading. A keyboard visitor reaches OK before the
            other answer and its own focus cancels the clock outright. */}
        <TimedButton
          key={seq}
          after={ARRIVAL_AFTER_S}
          paused={paused}
          onPress={onOk}
          data-testid="arrival-ok"
          style={{ ...answerStyle, background: colors.frameDark, color: colors.panelCream }}
        >
          {t('arrival.ok')}
        </TimedButton>
        <motion.button
          type="button"
          {...buttonMotion}
          data-testid="arrival-switch"
          onClick={onSwitch}
          style={{ ...answerStyle, background: colors.surfaceSecondary, color: colors.frameDark }}
        >
          {t('arrival.switch')}
        </motion.button>
      </span>
    </motion.div>
  );
}

export interface ArrivalToastProps {
  /** The boot splash still owns the screen. */
  splashActive: boolean;
}

export function ArrivalToast({ splashActive }: ArrivalToastProps) {
  const t = useT();
  const locale = useEditorStore((s) => s.locale);
  const setModal = useEditorStore((s) => s.setModal);
  // Subscribed for the RETRY they trigger rather than for their values: the gate below reads the
  // store live, because the check is deferred past the commit these are read in.
  const tourRunning = useEditorStore((s) => s.tourRunning);
  const blocked = useEditorStore((s) => s.portraitBlocked);
  const tourDoneOpen = useEditorStore((s) => s.modals.tourDone);
  const whatsNewOpen = useEditorStore((s) => s.modals.whatsNew);
  const gridState = useEditorStore((s) => s.gridState);
  const chrome = useChromeScale();
  const weights = useWeightVars();

  const [pending, setPending] = useState<Arrival | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  /** Which line the eyebrow is on: 0 is the arrival phrase, 1..n the arrival's own lines. */
  const [step, setStep] = useState(0);
  /**
   * Bumped once the two lines have finished crossing, which asks for a SECOND measurement.
   *
   * Both lines share one box while they cross, so for those few hundred ms the row is as wide as
   * the wider of the two. The first measurement therefore eases the card out to fit an arriving
   * line that is longer; this one lets it come back in once a line that was longer has gone. A card
   * that shrank mid-fade would pull the ground out from under a line still on screen.
   *
   * A COUNTER RATHER THAN A FLAG, and it matters: a flag reset in an effect lands in the same flush
   * as the step change and cancels the first glide before it has drawn a frame, which snaps every
   * line that grows. Nothing is set here until the timer fires.
   */
  const [measured, setMeasured] = useState(0);
  const seq = useRef(0);
  const lines = shown ? arrivalLines(shown.arrival) : NO_LINES;
  // Keyed on the LINE as well as the arrival: each one is a different width, and the box follows
  // whichever is being said.

  useEffect(() => subscribeArrival(setPending), []);

  useEffect(() => {
    if (!pending) return undefined;
    // DEFERRED PAST THIS COMMIT'S EFFECTS. The first-launch check runs in one of them and can decide
    // to open the tour, or waive it by writing a flag that moves no store field at all; a check made
    // inline would read a browser that has not been asked yet as one that has answered. The facts
    // are read LIVE in here for the same reason.
    const timer = setTimeout(() => {
      const st = useEditorStore.getState();
      const open = arrivalOpens({
        splashActive,
        blocked: st.portraitBlocked,
        tourRunning: st.tourRunning,
        tourDoneOpen: st.modals.tourDone,
        whatsNewOpen: st.modals.whatsNew,
        tourSettled: hasSeenTour(),
      });
      const template = st.gridState?.template;
      if (!open || !template) return;
      seq.current += 1;
      setShown({ arrival: pending, template, seq: seq.current });
      setPending(null);
    }, 0);
    return () => clearTimeout(timer);
  }, [pending, splashActive, tourRunning, blocked, tourDoneOpen, whatsNewOpen, gridState]);

  // The cycle: the phrase holds one cadence, then each line takes the row in turn and the last one
  // stays. One timer per line rather than a chain, so a step cannot drift by the length of a render.
  useEffect(() => {
    setStep(0);
    if (lines.length === 0) return undefined;
    const timers = lines.map((_, i) => setTimeout(() => setStep(i + 1), EYEBROW_SWAP_MS * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [shown, lines]);

  // The second measure, once the two lines have finished crossing.
  useEffect(() => {
    const timer = setTimeout(() => setMeasured((m) => m + 1), CROSSFADE_S * 1000);
    return () => clearTimeout(timer);
  }, [shown, step]);

  /** Taking the notice. A HAND on it also answers the saved-session offer standing at the foot of
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
  // Resolved HERE rather than held on the arrival, so the words follow a locale changed while the
  // notice is standing.
  const line = lines[step - 1];
  const eyebrow = shown
    ? (line ? t(line.key, line.params) : t(ARRIVAL_LEAD_KEY[shown.arrival.kind]))
    : '';

  return (
    // The live region is the container, which is mounted for the app's life: a region announces
    // what appears INSIDE it, so one that arrives already holding its message announces nothing.
    <div role="status" style={{ ...containerStyle, zoom: chrome, ...weights }}>
      <AnimatePresence>
        {shown && (
          <ArrivalCard
            art={art}
            eyebrow={eyebrow}
            name={localizedName(shown.template.name, locale)}
            seq={shown.seq}
            onOk={dismiss}
            onSwitch={switchPlanet}
            measureKey={`${shown.seq}:${step}:${measured}`}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
