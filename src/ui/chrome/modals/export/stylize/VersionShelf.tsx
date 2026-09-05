/*
 * VersionShelf.tsx — the session's contact sheet: 原图 first, then every take in the order it was
 * drawn, then the card standing in for a job in flight.
 *
 * THE SHELF IS ALWAYS THE SAME ROW. Ghost slots keep it drawn to its six visible slots, so a take
 * arriving fills a slot that was already there and the row never grows under the pointer; past six
 * the row SCROLLS sideways under the house fade rather than wrapping, since a second row would
 * take its height out of the canvas above. A fresh take (and the card painting one) glides into
 * view on its own. Hovering a card TRIES it on the canvas and pressing KEEPS it, which is what
 * lets someone walk the sheet without committing to anything.
 *
 * The retire square is a SIBLING of the card, never a child: a button cannot nest in a button, and
 * the card is the picture's own press.
 *
 * AND THIS SHELF IS WHERE A RUNNING JOB IS REPORTED — the only place. The footer's status slot says
 * nothing while a take is painting, because two indicators for one wait ask the eye which of them
 * is the job.
 */
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { motion, AnimatePresence, useReducedMotionConfig } from 'framer-motion';
import { buttonMotion, colors, cursors, pressable, radii } from '../../../../design/styles';
import { skin } from '../../../../design/window-skin';
import { roleFont } from '../../../../design/text-weight';
import { useT } from '../../../../../i18n/context';
import type { StylizeVersion } from '../../../../../io/stylize';
import { useScrollFade } from '../../../../primitives/scroll-fade';
import { useWheelToHorizontal } from '../../../../primitives/wheel-horizontal';
import { MAP_ASPECT } from './sample-art';
import { entering } from './atoms';
import { amplitude, cssMotion, framerMotion } from './motion';

/** How many slots stand in view; the row scrolls once the session has made more. */
const SLOTS = 6;

/** How far the creep reaches, as a percentage of the track. Short of the end on purpose: see the
 *  motion's own declaration. */
const CREEP_PCT = amplitude('stylize.progress.creep') * 100;

/** The picture a card shows, where the browser can be given one. */
export function versionSrc(version: StylizeVersion): string | null {
  const image = version.image as { src?: unknown };
  return typeof image.src === 'string' ? image.src : null;
}

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
  const [hover, setHover] = useState<string | null>(null);
  const painting = running;
  // What the loader's leave should say: a job that MINTED hands its exact spot to the take (the
  // slot collapses on the same frame, so the card pops where the bar stood); a job that ended
  // with nothing folds shut like a retired card, since there is nothing to hand the spot to.
  const jobStartLen = useRef(versions.length);
  const wasRunning = useRef(running);
  if (running && !wasRunning.current) jobStartLen.current = versions.length;
  wasRunning.current = running;
  const minted = versions.length > jobStartLen.current;
  const ghosts = Math.max(0, SLOTS - versions.length - 1 - (painting ? 1 : 0));
  const scrollRef = useRef<HTMLDivElement>(null);
  const fade = useScrollFade(scrollRef, 'x');
  // A mouse over the shelf has only vertical notches; they drive the row's own travel.
  useWheelToHorizontal(scrollRef);

  // A card the row just GAINED (a finished take, or the one painting) belongs in view without a
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
      style={{ ...shelfRow, ...fade }}
    >
      <div style={{ ...slotBox, position: 'relative' }}>
        <motion.button
          type="button"
          aria-label={t('stylize.original')}
          onClick={() => onPick(null)}
          onMouseEnter={() => onTry('original')}
          onMouseLeave={() => onTry(null)}
          onFocus={() => onTry('original')}
          onBlur={() => onTry(null)}
          {...buttonMotion}
          style={cardStyle(selectedId === null, originalSrc)}
        >
          <span style={tagStyle}>{t('stylize.original')}</span>
        </motion.button>
      </div>

      {/* ONE presence list holds the cards AND the painting slot. `custom` carries whether the
          job minted, read by the loader's exit at the moment it leaves. */}
      <AnimatePresence initial={false} custom={minted}>
        {([...versions, ...(painting ? ['painting' as const] : [])]).map((entry) => {
          if (entry === 'painting') {
            return <PaintingCard key="painting" band={runningBand} reduced={reduced} />;
          }
          const version = entry;
          const custom = version.direction === 'custom';
          const label = t('stylize.version_label', { n: version.no });
          return (
            <motion.div
              key={version.id}
              initial={{ opacity: 0, scale: 1 - amplitude('stylize.card.enter') }}
              animate={{ opacity: 1, scale: 1 }}
              // The SLOT folds shut while the picture fades: flex reflow carries every survivor
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
              onMouseEnter={() => setHover(version.id)}
              onMouseLeave={() => setHover(null)}
              style={{ ...slotBox, position: 'relative' }}
            >
              <motion.button
                type="button"
                aria-label={label}
                {...(custom && version.prompt ? { title: version.prompt } : {})}
                onClick={() => onPick(version.id)}
                onMouseEnter={() => onTry(version.id)}
                onMouseLeave={() => onTry(null)}
                onFocus={() => onTry(version.id)}
                onBlur={() => onTry(null)}
                {...buttonMotion}
                style={cardStyle(selectedId === version.id, versionSrc(version))}
              >
                <span style={tagStyle}>
                  {label}
                  {custom ? <i aria-label={t('stylize.edit_prompt')} style={{ fontStyle: 'normal' }}> ✎</i> : null}
                </span>
              </motion.button>
              <motion.button
                type="button"
                aria-label={t('stylize.retire')}
                title={t('stylize.retire')}
                onClick={() => onRetire(version.id)}
                onFocus={() => setHover(version.id)}
                onBlur={() => setHover(null)}
                // The square is REVEALED by the card's hover and answers the pointer with its own
                // growth: both are hover feedback, so both run on the house affordance's own spring.
                // While hidden it must not take the pointer either, or the card's corner would
                // delete a take the hand was only reaching to pick.
                animate={{ opacity: hover === version.id ? 1 : 0 }}
                whileHover={pressable.whileHover}
                whileTap={pressable.whileTap}
                transition={pressable.transition}
                style={{ ...retireStyle, pointerEvents: hover === version.id ? 'auto' : 'none' }}
              >
                {/* The cross is drawn, not typed: the Latin face has no U+2715, and a fallback
                    font's glyph lands off-center in an 18px circle. */}
                <span aria-hidden style={crossArm(45)} />
                <span aria-hidden style={crossArm(-45)} />
              </motion.button>
            </motion.div>
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

/**
 * The slot standing in for a job in flight, carrying the ONE progress bar the running state shows.
 *
 * THE TRACK DOES NOT KNOW HOW FAR ALONG THE JOB IS, and it never pretends to: the whole generation
 * is one request that reports nothing between the asking and the answering, so the bar creeps to a
 * mark short of the end over the length a take usually takes and only the finished picture fills
 * it. Under reduced motion the creep is taken in ONE STEP rather than glided — what the track has
 * to carry is that something is out, not a rate nobody measured — and the landing, which is the one
 * moment the bar knows a fact, is written at once.
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
          ? { opacity: 0, flexBasis: 0, marginRight: 0, transition: { duration: 0 } }
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


/** The row itself: six slots in view, the rest reachable sideways. The vertical padding keeps a
 *  picked card's ring (drawn 2.5px outside its box) inside the clipped area. `scroll`, not `auto`:
 *  the house scrollbar is a classic (space-taking) one, and `scrollbar-gutter` reserves only the
 *  inline-axis gutter — so the lane under the row is held open from the start, and the seventh
 *  card cannot change the row's height. */
const shelfRow: CSSProperties = {
  flex: 'none',
  display: 'flex',
  overflowX: 'scroll',
  overflowY: 'hidden',
  /* Clip room for the cards' hover growth and the chosen ring (both drawn outside the card box),
     handed back by the margin so the shelf keeps its footprint. */
  padding: 8,
  margin: -5,
};

/** One slot's footprint in the row: exactly six fit the visible width, gaps included. The gap is
 *  the slot's own right margin (not the row's `gap`) so a retiring slot folds its gap shut with it. */
const slotBox: CSSProperties = {
  flex: '0 0 calc((100% - 48px) / 6)',
  minWidth: 0,
  marginRight: 8,
};

/** One slot of the sheet: the map's ratio, and the hairline that keeps an empty one drawn. */
const slotStyle: CSSProperties = {
  width: '100%',
  aspectRatio: String(MAP_ASPECT),
  borderRadius: 10,
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
    // a shadow list that changes LENGTH cannot be interpolated, so the ring would land in one frame.
    boxShadow: picked
      ? `inset 0 0 0 1.5px ${skin.line}, 0 0 0 2.5px ${skin.active}`
      : `inset 0 0 0 1.5px ${skin.line}, 0 0 0 0 rgba(255,218,126,0)`,
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

const tagStyle: CSSProperties = {
  position: 'absolute',
  left: 4,
  bottom: 4,
  ...roleFont('small'),
  color: skin.plate,
  background: 'rgba(67,65,62,0.66)',
  borderRadius: radii.sm,
  padding: '1px 6px',
  pointerEvents: 'none',
};

const retireStyle: CSSProperties = {
  position: 'absolute',
  right: 3,
  top: 3,
  width: 18,
  height: 18,
  border: 'none',
  borderRadius: '50%',
  background: colors.dangerBg,
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
    borderRadius: 1,
    background: colors.dangerText,
    transform: `rotate(${deg}deg)`,
  };
}
