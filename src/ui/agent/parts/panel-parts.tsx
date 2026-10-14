/*
 * Shared, shadow-free visual primitives for the assistant panel. Looping stripe decoration uses the
 * shell animation class and custom property; `TapeBar` also checks the JavaScript reduced-motion
 * setting so behavior is consistent in rendering and tests.
 */
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { motion, useReducedMotionConfig } from 'framer-motion';
import { Icon, type IconId } from './sprite';
import { recede, tickInk } from '../panel-skin';
import { ACTIVE, INK, INSET, MUTED, PLATE_INK, TAPE } from '../../design/tokens';
import { cursors, font, radii, type PwStyle } from '../../design/styles';
import { roleFont, LINE_HEIGHT } from '../../design/text-weight';
import { MOTIONS } from '../../design/motion/registry';
import { Spinner } from '../../primitives/Spinner';
import { ActionButton } from '../../primitives/ActionButton';
import { amplitude, cssMotion, framerMotion } from '../../design/motion';
import { useT } from '../../../i18n/context';
import { openHelp } from '../../session/help-targets';
import type { HelpPageId } from '../../help/page-schema';
import type { OpRow } from '../../../agent/panel';

const HELP_LINK: CSSProperties = {
  border: 'none', background: 'none', padding: 0, font: 'inherit', color: 'inherit',
  textDecoration: 'underline', textUnderlineOffset: 2, cursor: cursors.clickable,
};

/** An inline "Learn more" that opens the Help Center on the page a line is about. */
export function HelpLink({ page, anchor }: { page: HelpPageId; anchor?: string }) {
  const t = useT();
  return (
    <ActionButton interaction="quietLink" style={HELP_LINK} onClick={() => openHelp(page, anchor)}>
      {t('agent.learn_more')}
    </ActionButton>
  );
}

/** Incoming screens share one reveal; outgoing forms unmount before their controls can be reused. */
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


/* ── construction tape: the plan's one progress bar ─────────────────────── */

export type TapeMode = 'indeterminate' | { fraction: number };

/** One meaning for a filled width: a measured fraction with a real remainder. Unknown progress is a
 *  Different visual — a short left-anchored pill standing on the track, never the whole of it, so it
 *  can never be mistaken for a job that finished. */
const INDETERMINATE_FRACTION = 0.26;

/** A held bar's fill stands where it stopped, read as paused rather than as still working. */
const HELD_OPACITY = recede.still;

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
    borderRadius: radii.pill,
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
    // The layer starts one period left of the fill and travels one period right, so the band it
    // vacates was already covered and the pattern lands exactly on itself.
    left: `-${TAPE.stripeSize}px`,
    right: 0,
    backgroundImage: `repeating-linear-gradient(45deg, ${TAPE.stripeLight} 0 4px, ${TAPE.stripeDark} 4px 8px)`,
    backgroundSize: `${TAPE.stripeSize}px 100%`,
    '--pw-stripe-travel': `${TAPE.stripeSize}px`,
  };
  if (crawling) stripes.animationDuration = `${CRAWL_SECONDS}s`;
  return (
    <div
      data-testid="tape-bar"
      // `flex: 0 0 auto` because the band is a fixed height in a flex column: a card whose content
      // wants more room than the box has shrinks every item with a default `flex-shrink`, and a 10px
      // band with `min-height: auto` resolving to 0 is the first thing to vanish entirely.
      style={{
        height: 10, flex: '0 0 auto', borderRadius: radii.pill,
        background: TAPE.track, overflow: 'hidden', boxShadow: 'none',
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
 * The end mark for each op status; a running call wears the Spinner instead. Only what the user must
 * act on takes a hue: `ok` is a plain check, `revert` and `error` carry the outcome inks, `blocked`
 * is an outline shield in the revert ink, and calls that never ran recede into the muted brown.
 */
const TICK_SPEC: Record<OpRow['status'], TickSpec | 'spin'> = {
  ok: { icon: 'pw-check', ink: tickInk.ok },
  run: 'spin',
  revert: { icon: 'pw-undo-arrow', ink: tickInk.revert },
  error: { icon: 'pw-cross', ink: tickInk.error },
  blocked: { icon: 'pw-shield-hold', ink: tickInk.revert },
  skipped: { icon: 'pw-cross', ink: MUTED },
  cut: { icon: 'pw-stop', ink: MUTED },
  words: { icon: 'pw-reply-bubble', ink: MUTED },
  'pending-gate': { icon: 'pw-reply-bubble', ink: MUTED },
};

/** The statuses a row is still in rather than finished at: a tick only pulses on the way out of
 *  one of these, so a row drawn already settled (history, any re-render) reports nothing. */
const UNSETTLED: ReadonlySet<OpRow['status']> = new Set<OpRow['status']>(['run', 'pending-gate']);

/** An op row's outcome mark: one glyph, coloured (and for `pending-gate`, papered) by status.
 *
 *  It swells and comes back when the row settles (`panel.tick.settle`) — the mark is already in
 *  place, so what changes is the mark rather than where it is. Framer diffs keyframe targets by
 *  Value, so a value-identical array would not replay; the pulse is keyed to a counter bumped only
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

/* ── single-line stamp ───────────────────────────────────────────────────── */

/** One icon plus a muted line of text for job side notes (compaction, a
 *  damper, an interruption, a note the user sent) read this way, never as their own card.
 *
 *  It may take a second line rather than truncating at one (`.stampline .tx`): a stamp carries the
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
        color: MUTED,
        boxShadow: 'none',
      }}
    >
      <span style={{ flex: '0 0 auto', display: 'inline-flex', marginTop: 2 }}>
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
          lineHeight: LINE_HEIGHT.snug,
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
 * It names the tail it left visible, not just the total: "9 steps" alone beside three rows reads as
 * a claim that nine of them are drawn below. `shown` is what the caller kept.
 */
export function CountPill({ total, shown, expanded, onClick }: { total: number; shown?: number; expanded?: boolean; onClick?: () => void }) {
  const t = useT();
  const partial = shown !== undefined && shown < total;
  const words = expanded === true ? t('agent.says_less') : partial
    ? t('agent.steps_count_last', { n: total, shown })
    : t('units.steps', { n: total });
  // A count with nothing to open is a label, not a control.
  if (!onClick) return <span data-testid="ops-count-pill" style={COUNT_PILL}>{words}</span>;
  return (
    <ActionButton data-testid="ops-count-pill" interaction="pill" aria-expanded={expanded} hoverFill={ACTIVE} onClick={onClick} style={COUNT_PILL}>
      {words}
    </ActionButton>
  );
}

const COUNT_PILL: CSSProperties = {
  alignSelf: 'flex-start', margin: '0 0 2px 6px', ...roleFont('small'), fontFamily: font.family,
  color: PLATE_INK, background: INSET, border: 'none', borderRadius: radii.pill, padding: '2px 10px', boxShadow: 'none',
};

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
        borderRadius: radii.pill,
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
