/*
 * The session's contact sheet: Original, every take in order, then the card for a job in flight (the one
 * place a running job is reported). Ghost slots keep six slots drawn, so a take fills a slot rather than
 * growing the row; past what the row shows (six, fewer on a narrow row) it scrolls sideways. Reaching
 * for a take (`useReveal`) tries it on the canvas, a press keeps it and so shows it too; the retire
 * square is the card's sibling, since a button cannot nest in a button, and in touch mode it stands on
 * the kept card.
 */
import { ActionButton } from '../../../../primitives/ActionButton';
import { useNameReveal } from '../../../../primitives/use-name-reveal';
import { useSurfaceZoom } from '../../../../design/scale';
import { TouchReach } from '../../../../primitives/TouchReach';
import { useEffect, useRef, type CSSProperties } from 'react';
import { useReveal } from '../../../../primitives/use-reveal';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { cursors, radii } from '../../../../design/styles';
import { DANGER_INK, DANGER_SURFACE, ACTIVE, inkTint, rgbaOf } from '../../../../design/tokens';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import { versionSrc, type StylizeVersion } from '../../../../../state/stylize-versions';
import { useScrollRow } from '../../../../primitives/use-scroll-row';
import { MAP_ASPECT } from './sample-art';
import { entering } from './stylize-parts';
import { amplitude, cssMotion, framerMotion, NO_MOTION } from '../../../../design/motion';
import { useInteractionProfiles } from '../../../../design/input-mode';

/** How many slots stand in view; the row scrolls once the session has made more. */
const SLOTS = 6;

/** How far the creep reaches, as a percentage of the track. Short of the end on purpose: see the
 *  motion's own declaration. */
const CREEP_PCT = amplitude('stylize.progress.creep') * 100;

/** The picture a card shows, where the browser can be given one. */

export function VersionShelf({ versions, selectedId, running, runningBand, originalSrc, onTry, onPick, onRetire, enterIndex = 0 }: {
  versions: readonly StylizeVersion[];
  selectedId: string | null;
  running: boolean;
  /** The colour of the direction being drawn, worn by the skeleton's own mark. */
  runningBand: string;
  originalSrc: string | null;
  /** Shows a picture on the canvas without keeping it. `null` puts the kept one back. */
  onTry: (key: string | null) => void;
  onPick: (id: string | null) => void;
  onRetire: (id: string) => void;
  /** Where the shelf stands in its page's arrival order. */
  enterIndex?: number;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  // Tries the original on the canvas while its card is reached for, and puts the kept picture back after.
  const tryOriginal = useReveal({ onChange: (shown) => onTry(shown ? 'original' : null) }).bind;
  const painting = running;
  // What the loader's leave should say: a job that minted hands its exact spot to the take (the
  // slot collapses on the same frame, so the card pops where the bar stood); a job that ended
  // with nothing folds shut like a retired card, since there is nothing to hand the spot to.
  const jobStartLen = useRef(versions.length);
  const wasRunning = useRef(running);
  if (running && !wasRunning.current) jobStartLen.current = versions.length;
  wasRunning.current = running;
  const minted = versions.length > jobStartLen.current;
  const ghosts = Math.max(0, SLOTS - versions.length - 1 - (painting ? 1 : 0));
  const scrollRef = useRef<HTMLDivElement>(null);
  // A mouse over the shelf has only vertical notches; they drive the row's own travel.
  const row = useScrollRow(scrollRef, { zoom: useSurfaceZoom(), bleed: SHELF_BLEED, pointerEvents: 'auto' });

  // A card the row just gained (a finished take, or the one painting) belongs in view without a
  // hand on the scrollbar. Only growth scrolls: a retire must not yank the row to its end while
  // the eye is on the cards around the gap.
  const occupied = versions.length + (painting ? 1 : 0);
  const prevOccupied = useRef(occupied);
  useEffect(() => {
    const grew = occupied > prevOccupied.current;
    prevOccupied.current = occupied;
    if (!grew) return;
    const el = scrollRef.current;
    if (el && typeof el.scrollTo === 'function') el.scrollTo({ left: el.scrollWidth, behavior: reduced ? 'auto' : 'smooth' });
  }, [occupied, reduced]);

  return (
    <motion.div
      {...entering(enterIndex)}
      ref={scrollRef}
      data-testid="stylize-shelf-scroll"
      className="pw-noscroll"
      style={{ ...shelfRow, ...row }}
   >
      <div style={{ ...slotBox, position: 'relative' }}>
        <ActionButton
          aria-label={t('stylize.original')}
          onClick={() => onPick(null)}
          {...tryOriginal}
          style={cardStyle(selectedId === null, originalSrc)}
       >
          <span style={tagStyle}>{t('stylize.original')}</span>
        </ActionButton>
      </div>

      {/* One presence list holds the cards and the painting slot. `custom` carries whether the
          job minted, read by the loader's exit at the moment it leaves. */}
      <AnimatePresence initial={false} custom={minted}>
        {([...versions, ...(painting ? ['painting' as const] : [])]).map((entry) => {
          if (entry === 'painting') {
            return <PaintingCard key="painting" band={runningBand} reduced={reduced} />;
          }
          return (
            <VersionCard key={entry.id} version={entry} picked={selectedId === entry.id} reduced={reduced}
              onTry={onTry} onPick={onPick} onRetire={onRetire} />
          );
        })}
      </AnimatePresence>

      {Array.from({ length: ghosts }, (_, i) => (
        // A ghost the row just regained fades in where the fold left room, instead of popping.
        <motion.div
          key={`ghost-${i}`}
          initial={{ opacity: 0 }}
          animate={{ opacity: 0.55 }}
          transition={framerMotion('stylize.shelf.settle')}
          style={{ ...slotBox, ...slotStyle }}
        />
      ))}
    </motion.div>
  );
}

/** One take's slot: its card, and the retire square the slot's reveal shows (in touch mode, the
 *  kept card's too). */
function VersionCard({ version, picked, reduced, onTry, onPick, onRetire }: {
  version: StylizeVersion;
  picked: boolean;
  reduced: boolean;
  onTry: (key: string | null) => void;
  onPick: (id: string | null) => void;
  onRetire: (id: string) => void;
}) {
  const t = useT();
  const profiles = useInteractionProfiles();
  const chrome = useSurfaceZoom();
  const slot = useReveal();
  const retireName = useNameReveal(t('stylize.retire'));
  const tryIt = useReveal({ onChange: (shown) => onTry(shown ? version.id : null) }).bind;
  const retirable = slot.shown || (slot.touch && picked);
  const custom = version.direction === 'custom';
  const label = t('stylize.version_label', { n: version.no });
  return (
    <motion.div
      initial={{ opacity: 0, scale: 1 - amplitude('stylize.card.enter') }}
      animate={{ opacity: 1, scale: 1 }}
      // The slot folds shut while the picture fades: flex reflow carries every survivor
      // continuously (no transform compensation to disagree with the scroller), the row's
      // scrollWidth shrinks smoothly instead of clamping at a scrolled end, and the flex
      // gap collapses because it is the slot's own margin. Reduced motion takes the fade
      // alone and lets the reflow land in one step.
      exit={reduced
        ? { opacity: 0, transition: framerMotion('stylize.shelf.retire') }
        : {
            opacity: 0,
            scale: 1 - amplitude('stylize.card.enter'),
            flexBasis: 0,
            marginRight: 0,
            transition: {
              ...framerMotion('stylize.shelf.retire'),
              flexBasis: framerMotion('stylize.shelf.settle'),
              marginRight: framerMotion('stylize.shelf.settle'),
            },
          }}
      transition={framerMotion('stylize.card.enter')}
      {...slot.bind}
      style={{ ...slotBox, position: 'relative' }}
   >
      <ActionButton
        aria-label={label}
        {...(custom && version.prompt ? { title: version.prompt } : {})}
        onClick={() => onPick(version.id)}
        {...tryIt}
        style={cardStyle(picked, versionSrc(version))}
     >
        <span style={tagStyle}>
          {label}
          {custom ? <i aria-label={t('stylize.edit_prompt')} style={{ fontStyle: 'normal' }}> ✎</i> : null}
        </span>
      </ActionButton>
      <motion.button
        type="button"
        {...retireName.bind}
        aria-label={t('stylize.retire')}
        onClick={() => onRetire(version.id)}
        // The square is revealed by the card's reach and answers the pointer with its own
        // growth: both are hover feedback, so both run on the house affordance's own spring.
        // While hidden it must not take the pointer either, or the card's corner would
        // delete a take the hand was only reaching to pick.
        animate={{ opacity: retirable ? 1 : 0 }}
        whileHover={profiles.tile.whileHover}
        whileTap={profiles.tile.whileTap}
        transition={profiles.tile.transition}
        style={{ ...retireStyle, pointerEvents: retirable ? 'auto' : 'none' }}
     >
        {/* The cross is drawn, not typed: the Latin face has no U+2715, and a fallback
            font's glyph lands off-center in an 18px circle. */}
        <span aria-hidden style={crossArm(45)} />
        <span aria-hidden style={crossArm(-45)} />
        {/* In the card's corner, so it grows into the card rather than past the shelf's clipped edges. */}
        <TouchReach w={RETIRE} h={RETIRE} zoom={chrome} sides={{ top: false, right: false }} />
        {retireName.bubble}
      </motion.button>
    </motion.div>
  );
}

/**
 * The slot for a job in flight, with the running state's one progress bar. The request reports nothing
 * until it answers, so the bar creeps to a mark short of the end over a take's usual length (one step
 * under reduced motion) and only the finished picture fills it.
 */
function PaintingCard({ band, reduced }: { band: string; reduced: boolean }) {
  const percent = reduced ? CREEP_PCT / 2 : CREEP_PCT;
  const bar: CSSProperties = { height: '100%', background: skin.active, borderRadius: radii.pill };

  return (
    <motion.div
      variants={{
        // A minted take stands where this bar stood: the slot collapses on the leave's first
        // frame so the card pops in place, never one slot over sliding back.
        exit: (mintedJob: boolean) => mintedJob || reduced
          ? { opacity: 0, flexBasis: 0, marginRight: 0, transition: NO_MOTION }
          : { opacity: 0, flexBasis: 0, marginRight: 0, transition: framerMotion('stylize.shelf.settle') },
      }}
      exit="exit"
      style={{ ...slotBox, ...slotStyle, background: skin.inset, position: 'relative', overflow: 'hidden' }}>
      <span aria-hidden style={{ ...bandStyle, background: band }} />
      <div aria-hidden style={trackStyle}>
        {reduced ? (
          <div data-testid="stylize-progress" style={{ ...bar, width: `${percent}%` }} />
        ) : (
          <motion.div
            data-testid="stylize-progress"
            initial={{ width: '0%' }}
            animate={{ width: `${percent}%` }}
            transition={framerMotion('stylize.progress.creep')}
            style={bar}
          />
        )}
      </div>
    </motion.div>
  );
}


/** Clip room around the row for the cards' hover growth and the chosen ring (drawn 2.5px outside a
 *  card), handed back by the margin so the row keeps its footprint. */
const SHELF_BLEED = 8;

/** The row itself: up to six slots in view, the rest reachable sideways with the edge fades and no bar. */
const shelfRow: CSSProperties = {
  flex: 'none',
  display: 'flex',
};

/** The narrowest a slot stands, in css px: room for a card's tag ("Original") in every locale, so a
 *  narrow row shows fewer slots and scrolls rather than cutting the tag. */
const SLOT_MIN = 96;

/** One slot's footprint in the row: six fit the visible width, gaps included, unless that would be
 *  narrower than `SLOT_MIN`. The gap is
 *  the slot's own right margin (not the row's `gap`) so a retiring slot folds its gap shut with it. */
const slotBox: CSSProperties = {
  flex: `0 0 max(calc((100% - 48px) / 6), ${SLOT_MIN}px)`,
  minWidth: 0,
  marginRight: 8,
};

/** One slot of the sheet: the map's ratio, and the hairline that keeps an empty one drawn. */
const slotStyle: CSSProperties = {
  width: '100%',
  aspectRatio: String(MAP_ASPECT),
  borderRadius: radii.md,
  boxShadow: `inset 0 0 0 1.5px ${skin.line}`,
};

function cardStyle(picked: boolean, src: string | null): CSSProperties {
  return {
    ...slotStyle,
    position: 'relative',
    display: 'block',
    padding: 0,
    border: 'none',
    overflow: 'hidden',
    background: skin.plate,
    cursor: cursors.clickable,
    transition: cssMotion('stylize.select.ring', ['box-shadow']),
    ...(src ? { backgroundImage: `url(${src})`, backgroundSize: 'cover', backgroundPosition: 'center' } : {}),
    // The unpicked ring is the picked one at zero width rather than the slot's own hairline alone:
    // a shadow list that changes length cannot be interpolated, so the ring would land in one frame.
    boxShadow: picked
      ? `inset 0 0 0 1.5px ${skin.line}, 0 0 0 2.5px ${skin.active}`
      : `inset 0 0 0 1.5px ${skin.line}, 0 0 0 0 ${rgbaOf(ACTIVE, 0)}`,
  };
}

/** The bar's own bed, along the foot of the slot. */
const trackStyle: CSSProperties = {
  position: 'absolute',
  left: 10,
  right: 10,
  bottom: 10,
  height: 5,
  borderRadius: radii.pill,
  background: skin.line,
  overflow: 'hidden',
};

const bandStyle: CSSProperties = {
  position: 'absolute', left: 0, top: 0, right: 0, height: 4, pointerEvents: 'none',
};

/** A tag longer than `SLOT_MIN` allows ends in an ellipsis; the card's name carries the whole label. */
const tagStyle: CSSProperties = {
  position: 'absolute',
  left: 4,
  bottom: 4,
  maxWidth: 'calc(100% - 8px)',
  boxSizing: 'border-box',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  ...roleFont('small'),
  color: skin.plate,
  background: inkTint(0.66),
  borderRadius: radii.sm,
  padding: '2px 6px',
  pointerEvents: 'none',
};

/** The retire square's side, in the window's px. */
const RETIRE = 18;

const retireStyle: CSSProperties = {
  position: 'absolute',
  right: 3,
  top: 3,
  width: RETIRE,
  height: RETIRE,
  border: 'none',
  borderRadius: '50%',
  background: DANGER_SURFACE,
  display: 'grid',
  placeItems: 'center',
  cursor: cursors.clickable,
};

/** One arm of the drawn cross, centred in the square. */
function crossArm(deg: number): CSSProperties {
  return {
    position: 'absolute',
    left: 4.5,
    top: 8.2,
    width: 9,
    height: 1.6,
    borderRadius: radii.hair,
    background: DANGER_INK,
    transform: `rotate(${deg}deg)`,
  };
}
