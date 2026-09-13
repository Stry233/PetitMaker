/*
 * Shared, shadow-free visual primitives for the assistant panel. Looping stripe decoration uses the
 * shell animation class and custom property; `TapeBar` also checks the JavaScript reduced-motion
 * setting so behavior is consistent in rendering and tests.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { Icon, type IconId } from './icons';
import { edge, inkTint, tape, tickInk } from './tokens';
import { ACTIVE, INK, INSET, PLATE, PLATE_INK } from '../design/tokens';
import { buttonMotion, colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowFooterPrimary, windowPill, type PillVariant, type WindowSurface } from '../design/window-skin';
import { MOTIONS } from '../shell/motion/registry';
import { Spinner } from '../primitives/Spinner';
import { amplitude, cssMotion, framerMotion } from './motion';
import { useT } from '../../i18n/context';
import type { OpRow } from '../../agent/core/project-view';

/** A SCREEN ARRIVING IN THE JOB ZONE for a press (`panel.zone.swap`): the gear's manage card, the
 *  connection form, the keyless office. Entrance only — the zone's ternary replaces screens
 *  synchronously, so the arrival is the whole gesture, and every screen makes the same one. */
export function zoneEnter(reduced: boolean): {
  initial: false | { opacity: number; y: number };
  animate: { opacity: number; y: number };
  transition: ReturnType<typeof framerMotion>;
} {
  return {
    initial: reduced ? false : { opacity: 0, y: amplitude('panel.zone.swap') ?? 8 },
    animate: { opacity: 1, y: 0 },
    transition: framerMotion('panel.zone.swap'),
  };
}


/** The construction tape shares its cycle duration with the motion registry. */
const CRAWL_SECONDS = MOTIONS['panel.tape.crawl'].duration;

/** React's `CSSProperties` has no room for a custom property; this widens it for exactly the
 *  `--pw-*` ones `animations.css` reads (mirrors `ui/agent/atoms.tsx`'s own `PwStyle`). */
type PwStyle = CSSProperties & Record<`--pw-${string}`, string>;

/* ── construction tape: the plan's one progress bar ─────────────────────── */

export type TapeMode = 'indeterminate' | { fraction: number };

/** ONE MEANING FOR A FILLED WIDTH: a measured fraction with a real remainder. Unknown progress is a
 *  DIFFERENT visual — a short left-anchored pill standing on the track, never the whole of it, so it
 *  can never be mistaken for a job that finished. */
const INDETERMINATE_FRACTION = 0.26;

/** A held bar's dimmed opacity: the fill stands exactly where it stopped, read as paused rather
 *  than as still working. Not a motion (nothing here travels), so it is not a registry entry. */
const HELD_OPACITY = 0.45;

/** Stripes crawl independently of the completed fraction; held and reduced-motion bars stay still. */
export function TapeBar({ mode, held = false }: { mode: TapeMode; held?: boolean }) {
  const reduced = useReducedMotionConfig() === true;
  const indeterminate = mode === 'indeterminate';
  const fraction = indeterminate ? INDETERMINATE_FRACTION : Math.max(0, Math.min(1, mode.fraction));
  const crawling = !reduced && !held;
  const fill: CSSProperties = {
    display: 'block',
    position: 'relative',
    height: '100%',
    borderRadius: 999,
    width: `${fraction * 100}%`,
    opacity: held ? HELD_OPACITY : undefined,
    transition: cssMotion('panel.tape.fill', ['width'], reduced),
    // The drifting layer is one stripe period wider than this box, and its own rounded cap is what
    // the fill's right end is: without the clip the stripes would paint a square edge over it.
    overflow: 'hidden',
  };
  const stripes: PwStyle = {
    position: 'absolute',
    top: 0,
    bottom: 0,
    // The layer starts one period LEFT of the fill and travels one period right, so the band it
    // vacates was already covered and the pattern lands exactly on itself.
    left: `-${tape.stripeSize}px`,
    right: 0,
    backgroundImage: `repeating-linear-gradient(45deg, ${tape.stripeLight} 0 4px, ${tape.stripeDark} 4px 8px)`,
    backgroundSize: `${tape.stripeSize}px 100%`,
    '--pw-stripe-travel': `${tape.stripeSize}px`,
  };
  if (crawling) stripes.animationDuration = `${CRAWL_SECONDS}s`;
  return (
    <div
      data-testid="tape-bar"
      // `flex: 0 0 auto` because the band is a FIXED height in a flex column: a card whose content
      // wants more room than the box has shrinks every item with a default `flex-shrink`, and a 10px
      // band with `min-height: auto` resolving to 0 is the first thing to vanish entirely.
      style={{
        height: 10, flex: '0 0 auto', borderRadius: 999,
        background: tape.track, overflow: 'hidden', boxShadow: 'none',
      }}
    >
      <span data-testid="tape-fill" style={fill}>
        <span data-testid="tape-stripes" className={crawling ? 'pw-stripe-drift' : undefined} style={stripes} />
      </span>
    </div>
  );
}

/* ── op outcome tick ─────────────────────────────────────────────────────── */

interface TickSpec {
  icon: IconId;
  ink: string;
}

/** How large the running spinner and each mark are drawn, in px. The spinner is the house
 *  tight-space loader at the mark's own size, so a row's right edge does not move as it settles. */
const MARK_SIZE = 13;

/**
 * The end-mark vocabulary. A `Record` makes a new status fail type-checking until it has a mark.
 * `run` alone is not a mark: a call still working wears the house Spinner,
 * because which phase it is in belongs to the words on the row rather than to a second loader.
 *
 * WHAT TAKES A HUE IS WHAT THE USER MUST ACT ON, and nothing else. `ok` is the QUIET CHECK in plain
 * ink: a call that did what it was asked has nothing to report but that it is done. `revert` and
 * `error` carry the two outcome inks; `blocked` is HELD BACK rather than refused, so it draws the
 * OUTLINE shield in the revert ink — nothing was applied and nothing is wrong with the map. The
 * three that never ran recede into the muted brown: a QUIET cross for the call the user declined
 * (never the refusal red — a decision of theirs is not a fault), a stop mark for one the end of the
 * job cut short, and the reply bubble for a proposal that turned into conversation, whether it is
 * still awaiting an answer (`pending-gate`) or was answered in words.
 */
const TICK_SPEC: Record<OpRow['status'], TickSpec | 'spin'> = {
  ok: { icon: 'pw-check', ink: tickInk.ok },
  run: 'spin',
  revert: { icon: 'pw-undo-arrow', ink: tickInk.revert },
  error: { icon: 'pw-cross', ink: tickInk.error },
  blocked: { icon: 'pw-shield-hold', ink: tickInk.revert },
  skipped: { icon: 'pw-cross', ink: colors.brownText },
  cut: { icon: 'pw-stop', ink: colors.brownText },
  words: { icon: 'pw-reply-bubble', ink: colors.brownText },
  'pending-gate': { icon: 'pw-reply-bubble', ink: colors.brownText },
};

/** The statuses a row is still IN rather than finished at: a tick only pulses on the way OUT of
 *  one of these, so a row drawn already settled (history, any re-render) reports nothing. */
const UNSETTLED: ReadonlySet<OpRow['status']> = new Set<OpRow['status']>(['run', 'pending-gate']);

/** An op row's outcome mark: one glyph, coloured (and for `pending-gate`, papered) by status.
 *
 *  It SWELLS AND COMES BACK when the row settles (`panel.tick.settle`) — the mark is already in
 *  place, so what changes is the mark rather than where it is. Framer diffs keyframe targets by
 *  VALUE, so a value-identical array would not replay; the pulse is keyed to a counter bumped only
 *  on the transition out of a running state, and never on mount. */
export function TickDot({ status }: { status: OpRow['status'] }) {
  const spec = TICK_SPEC[status];
  const reduced = useReducedMotionConfig() === true;
  const wasUnsettled = useRef(UNSETTLED.has(status));
  const [pulses, setPulses] = useState(0);

  useEffect(() => {
    const unsettled = UNSETTLED.has(status);
    if (wasUnsettled.current && !unsettled) setPulses((n) => n + 1);
    wasUnsettled.current = unsettled;
  }, [status]);

  const peak = 1 + (amplitude('panel.tick.settle') ?? 0);
  return (
    <motion.span
      data-testid="tick-dot"
      data-status={status}
      data-pulses={pulses}
      animate={pulses > 0 && !reduced ? { scale: [1, peak, 1] } : { scale: 1 }}
      transition={framerMotion('panel.tick.settle')}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: 16,
        height: 16,
        background: 'transparent',
        color: spec === 'spin' ? INK : spec.ink,
      }}
    >
      {spec === 'spin'
        ? <Spinner size={MARK_SIZE} color={INK} />
        : <Icon id={spec.icon} size={MARK_SIZE} />}
    </motion.span>
  );
}

/* ── the window pill, ported into the panel's own paper ─────────────────── */

/**
 * `windowPill`'s three fills, worn by a panel control. `on` names the
 * surface the pill itself stands on, exactly as `windowPill` reads it: a `quiet` pill flips fill to
 * stay legible on either cream level, `active`/`danger` bring their own colour regardless.
 *
 * It uses the shared `buttonMotion` hover and press treatment. `animations.css` states that there
 * are no global button rules — components own their hover and tap — so a plain `<button>` here was
 * motionless while the retry pill beside it, being a `TimedButton`, sprang: two press idioms on one
 * card. A DISABLED pill takes none of it: a control that refuses must not answer the pointer.
 */
export function Pill({
  variant = 'quiet',
  on = 'plate',
  disabled = false,
  hoverFill,
  onClick,
  children,
  style,
  'data-testid': testId = 'pill',
  'data-demoted': demoted,
}: {
  variant?: PillVariant;
  on?: WindowSurface;
  disabled?: boolean;
  /** Added AFTER the pill's own, for a wrapper that has something to say about the box rather than
   *  about the pill: `primitives/InlineConfirm` hands its trigger the beat the fill crosses on and the
   *  clip the growth is revealed behind. Not a way to restyle a pill. */
  style?: CSSProperties;
  /** A fill the pill takes under the pointer, on top of the house press. The gate family's own
   *  idiom: a quiet pill inside a gate card answers a hover with the ask colour, which is the one
   *  place that colour appears below the dock. */
  hoverFill?: string;
  onClick?: () => void;
  children?: ReactNode;
  /** Overrides the generic `pill` id: a screen with several of these needs to name each one, and a
   *  caller wrapping every pill in a labelled box just to select it would move the layout. */
  'data-testid'?: string;
  /** Whether this pill has stepped down for a control that now owns the press (`AskPrimary`'s own
   *  demotion, said in the same attribute so one reader answers for the whole gate family). */
  'data-demoted'?: string;
}) {
  const [hovered, setHovered] = useState(false);
  const lit = hoverFill !== undefined && hovered && !disabled;
  return (
    <motion.button
      type="button"
      data-testid={testId}
      {...(demoted !== undefined ? { 'data-demoted': demoted } : {})}
      disabled={disabled}
      onClick={onClick}
      onPointerEnter={hoverFill === undefined ? undefined : () => setHovered(true)}
      onPointerLeave={hoverFill === undefined ? undefined : () => setHovered(false)}
      whileHover={disabled ? undefined : buttonMotion.whileHover}
      whileTap={disabled ? undefined : buttonMotion.whileTap}
      transition={buttonMotion.transition}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: 'none',
        ...windowPill(variant, disabled, on),
        ...(lit ? { background: hoverFill } : {}),
        ...style,
      }}
    >
      {children}
    </motion.button>
  );
}

/* ── the hold's own primary ──────────────────────────────────────────────── */

/**
 * Resume uses the ink fill wherever it stands, never the ask amber, since
 * lifting a hold is an action on a held job rather than a "this needs you" gate.
 *
 * IT IS ONE CONSTANT BECAUSE THE VERB HAS THREE SEATS — the paused ticket's foot, the hold row under
 * the ask that produced it, and the offer card — and a copy of these four properties per seat drifts
 * onto the amber pill one seat at a time, so a correction lands only where someone happened to be
 * looking. `Fix key` shares it: the blocked offer's repair takes the seat Resume would have had.
 *
 * THE BASE IS THE FOOTER PRIMARY, NOT `windowPrimary`, AND THE RADIUS IS THE WHOLE REASON. The house
 * has two ink primaries and they are two SHAPES: `windowPrimary` is the centred confirm, whose 14 is
 * authored for that shape, and `windowFooterPrimary` is the one that STRETCHES across the foot of a
 * column at the house radius. Every primary in this panel is the stretched one — each of them
 * overrode `flex` and `padding` and kept the centred shape's radius by accident, which is how the
 * panel came to draw its gate cards and its ticket feet at 14 while the setup foot and the manage
 * Done, taking the footer token honestly, drew at 12. One shape, one radius, and it is a token.
 */
export const RESUME_PRIMARY: CSSProperties = {
  ...windowFooterPrimary, flex: 1, padding: '10px 0', boxShadow: 'none',
};

/* ── single-line stamp ───────────────────────────────────────────────────── */

/** One icon plus a muted line of text for job side notes (compaction, a
 *  damper, an interruption, a note the user sent) read this way, never as their own card.
 *
 *  IT MAY TAKE A SECOND LINE rather than truncating at one (`.stampline .tx`): a stamp carries the
 *  user's own words as often as the panel's, and a note cut off at the panel's width is a note the
 *  record does not hold. Two lines is the cap either way. */
export function Stamp({ icon, children }: { icon: IconId; children: ReactNode }) {
  return (
    <div
      data-testid="stamp"
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 8,
        padding: '2px 6px',
        ...roleFont('caption'),
        fontFamily: font.family,
        color: colors.brownText,
        boxShadow: 'none',
      }}
    >
      <span style={{ flex: '0 0 auto', display: 'inline-flex', marginTop: 1 }}>
        <Icon id={icon} size={13} />
      </span>
      <span
        data-testid="stamp-text"
        style={{
          minWidth: 0,
          overflow: 'hidden',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          lineHeight: 1.35,
          // A steer note rides this seat verbatim, and a pasted token has no space to break at.
          overflowWrap: 'anywhere',
        }}
      >
        {children}
      </span>
    </div>
  );
}

/* ── the record's own two small parts: a count and a result ──────────────── */

/**
 * The pill that stands for operation rows a list is not showing.
 *
 * IT NAMES THE TAIL IT LEFT VISIBLE, not just the total: "9 steps" alone beside three rows reads as
 * a claim that nine of them are drawn below. `shown` is what the caller kept.
 */
export function CountPill({ total, shown, onClick }: { total: number; shown?: number; onClick?: () => void }) {
  const t = useT();
  const partial = shown !== undefined && shown < total;
  return (
    <button
      type="button"
      data-testid="ops-count-pill"
      onClick={onClick}
      style={{
        alignSelf: 'flex-start',
        margin: '0 0 2px 6px',
        ...roleFont('small'),
        fontFamily: font.family,
        color: PLATE_INK,
        background: INSET,
        border: 'none',
        borderRadius: 999,
        padding: '3px 10px',
        cursor: onClick ? cursors.clickable : cursors.default,
        boxShadow: 'none',
      }}
    >
      {partial
        ? t('agent3.steps_count_last', { n: total, shown })
        : t(total === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: total })}
    </button>
  );
}

/** How wide a result chip may run before it ellipsizes, in CSS pixels. A chip is a short
 *  phrase beside a row; past this it would push the row's own words out. */
const CHIP_MAX = 150;

/**
 * A row's outcome said in a word or two: what came of the call, where the
 * mark alone cannot say it. `warn` is the revert ink and `bad` the danger one — the same two hues
 * the marks carry, so a chip and the mark beside it never disagree about how bad a thing is.
 */
export function ResultChip({ tone, children }: { tone?: 'warn' | 'bad'; children: ReactNode }) {
  const ink = tone === 'warn' ? tickInk.revert : tone === 'bad' ? tickInk.error : PLATE_INK;
  return (
    <span
      data-testid="op-chip"
      data-tone={tone ?? 'plain'}
      style={{
        flex: '0 0 auto',
        marginLeft: 'auto',
        maxWidth: CHIP_MAX,
        ...roleFont('small'),
        fontFamily: font.family,
        color: ink,
        background: INSET,
        borderRadius: 999,
        padding: '2px 6px',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  );
}

/**
 * THE FREE PANEL'S DOCK CONTROL: a disc standing ON the panel's top-right corner, in the frame's px.
 * It is one press with nothing to choose between, so it is a whole round button rather than a control
 * in a row of them.
 *
 * IT IS CENTRED ON THE PANEL'S RIGHT EDGE, which halves it: the outer half floats over the map and the
 * inner half lies on the plate. That inner half reaches exactly the plate's own PADDING, which is the
 * gutter every one of the plate's children begins after, so it cannot touch the character's seat or the
 * dock card whatever either of them holds — and the same reasoning holds at the top, where its own
 * radius is the padding.
 *
 * IT HANGS FROM THE PLATE'S OWN CORNER RATHER THAN FROM ITS TOP EDGE, and both bounds are measured. It
 * cannot go HIGHER than the corner's radius: above that its inner half stands over the curve, where
 * there is no paper behind it and the map shows through the join. And it cannot cross the panel's top
 * edge at all, because what stands immediately above the panel is the selected block's caption, whose
 * box the column's own top clearance is measured against (`shell/panel-frame.ts:PANEL_TOP`) — a control
 * reaching into that clearance would touch the one word saying what the map is armed with.
 */
export const PIN_KNOB = { size: 28 } as const;

/** How far the disc hangs past the panel's right edge: half of itself, which is what puts its centre on
 *  the edge. Read by the placement, so the two cannot disagree about which edge it is centred on. */
export const PIN_KNOB_OUT = PIN_KNOB.size / 2;

/** The paper the disc is drawn on and the outline it wears, both the plate's own: it is a piece of the
 *  panel's own stock lying across the corner, not a chrome button borrowed from elsewhere. */
export function PinKnob({
  testId, icon, label, disabled = false, onClick, ...rest
}: Omit<IconButtonProps, 'lit' | 'door'>) {
  return (
    <motion.button
      type="button"
      data-testid={testId}
      data-icon={icon}
      data-act={rest['data-act']}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { ...buttonMotion.whileHover, backgroundColor: ACTIVE }}
      whileTap={disabled ? undefined : buttonMotion.whileTap}
      transition={buttonMotion.transition}
      style={{
        width: PIN_KNOB.size,
        height: PIN_KNOB.size,
        background: PLATE,
        border: edge,
        borderRadius: '50%',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: 'none',
        color: INK,
        opacity: disabled ? 0.38 : 1,
        ...(disabled ? { cursor: cursors.default } : {}),
      }}
    >
      <Icon id={icon} size={16} />
    </motion.button>
  );
}

export interface IconButtonProps {
  testId: string;
  icon: IconId;
  label: string;
  'data-act'?: string;
  disabled?: boolean;
  lit?: boolean;
  /** The gear alone recedes to the muted door tone at rest; every other glyph
   *  on the card, the seat control included, stands at the house ink like the rest of the card's own
   *  words. A lit door reads as ink again (`.ib.door.lit`), the surface it opens standing open. */
  door?: boolean;
  onClick?: () => void;
}

/** One pressable glyph on the ink-wash square (the plate policy), with the house yellow as the
 *  press rather than as a resting state. A lit one is the surface it opens, standing open. */
export function IconButton({
  testId, icon, label, disabled = false, lit = false, door = false, onClick, ...rest
}: IconButtonProps) {
  return (
    <motion.button
      type="button"
      data-testid={testId}
      data-icon={icon}
      data-act={rest['data-act']}
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      whileHover={disabled ? undefined : { ...buttonMotion.whileHover, backgroundColor: ACTIVE }}
      whileTap={disabled ? undefined : buttonMotion.whileTap}
      transition={buttonMotion.transition}
      style={{
        width: 28,
        height: 28,
        borderRadius: 8,
        flex: '0 0 auto',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        boxShadow: 'none',
        opacity: disabled ? 0.38 : 1,
        // A SEAT THAT ONLY REPORTS IS NOT A SEAT THAT REFUSES. `cursors.css` gives every disabled
        // button the blocked badge, which is right for a control the state forbids and wrong for
        // this one: the seat stands numbed for a beat so the column does not move under the hand
        // that is still reaching for it, and a badge there reads as a rejection of a press nobody
        // made. Named only in the disabled branch, so the sheet still gives the live seat its hand.
        ...(disabled ? { cursor: cursors.default } : {}),
        color: door && !lit ? colors.brownText : INK,
        background: lit ? ACTIVE : inkTint.chip,
      }}
    >
      <Icon id={icon} size={16} />
    </motion.button>
  );
}
