/*
 * RestoreShelf.tsx — the offer to reopen the last session, standing where the shelves stand.
 *
 * THE SAVED MAP IS A CANDIDATE CARD, and the same one: the same plate, the same picture rect, the
 * same corner and the same 660:450, drawn at `CARD_SCALE` and standing up out of the shelf's plate
 * the way the five candidates do, only further. The plate is the plinth. That aspect IS the design:
 * the map is roughly square, so a photograph asked for at a band's 5:1 is mostly sea with an island
 * in the middle of it, and the offer read flat because the only picture on it was a sliver.
 *
 * A CLICK IS THE ANSWER, with no confirm step, exactly as a click on a candidate is. Restoring can
 * be taken back by asking for a new map, with the old one already returned if the visitor changes
 * their mind; that is what makes the click safe enough to be the whole of it.
 *
 * IT ARRIVES WITH THE OFFER AND LEAVES WITH IT. Not furniture that happens to be empty, or it would
 * read as a sixth mode: it is drawn because there is something to offer and gone the moment there
 * is not, on the score in `motion/choreography.ts`.
 *
 * THE CARD PRESSES ITSELF, and its clock is the mark a shelf's row of names puts under the chosen
 * name — a yellow stadium under the picture, spent rather than filled. The default falls toward the
 * RECOVERABLE option, which is the whole argument for having one. What that inverts is "offered
 * rather than applied", and knowingly: that phrasing was protecting against a SILENT default, and a
 * mark shortening under the picture is not silent. All four ways of saying no already unmount this
 * offer, so the clock dies with it and needs no path of its own; the one case that is not an
 * unmount is the offer ON ITS WAY OUT, which is still mounted for the length of its exit and is
 * held by `useIsPresent`.
 *
 * THE ANSWERS ARE PILLS ON THE MAP, under the words rather than in a strip: a strip is where a
 * setting lives, and these two answer the sentence above them. Resume repeats what the card already
 * does, for a target that does not require aiming at the photograph; Start fresh is the one press
 * here that must never fall through to anything. They are SIBLINGS of the card, since a button
 * cannot nest in a button, and a hand resting on either counts as a hand over the offer — hovering
 * one holds the same clock hovering the card does.
 */
import { useEffect, useState } from 'react';
import { motion, useIsPresent } from 'framer-motion';
import { renderThumbnail } from '../../../canvas/thumbnail';
import { useT } from '../../../i18n/context';
import type { GridState } from '../../../core/model/types';
import { TimedButton } from '../../primitives/TimedButton';
import { ScaleProvider } from '../../design/scale';
import { btnReset, buttonMotion, cursors, z } from '../../design/styles';
import { ACTIVE, PLATE, PLATE_INK } from '../../design/tokens';
import { PLATE_BAND, SHELF_SCALE, SHELF_TABS, TEXT } from '../units';
import { MOTIONS } from '../motion/registry';
import { useBeat, useMotion, useMotionAllowed } from '../motion/use-motion';
import { BarText } from './bar-atoms';
import { CardFace } from './CandidateCard';
import { BAR, CARD, CARD_H, GAP, PAD, STRIP } from './generate-shelf';

/**
 * How much bigger this card is than a candidate.
 *
 * A candidate is one of six and is read by comparing it with the others; this is the only picture
 * on the screen, so it is drawn bigger. It is the offer's ILLUSTRATION rather than the offer: drawn
 * at nearly twice a candidate it became the whole body of the surface, and the words that say what
 * it is and the answers that act on it read as captions under a poster.
 *
 * It is a SCALE on the shelf's own card height rather than a size of its own, so everything that
 * moves that height — a short window, where the row of names' floor brings the cards down — moves
 * this too, and the card can never climb into the mode row.
 */
const CARD_SCALE = 1.5;
const CARD_H_BIG = CARD_H * CARD_SCALE;
/** The width follows from the height, since the shape is the drawing's. */
const CARD_W_BIG = (CARD_H_BIG * CARD.w) / CARD.h;

/**
 * How high the card's foot stands above the window's bottom edge, in css px.
 *
 * It is the line a CANDIDATE stands on: the shelf's own bottom padding plus the strip of settings
 * inside the plate and the room over it. There is no strip here, but the line is what makes this
 * card the same object as those — a picture standing on the plate at the height pictures stand at.
 */
const CARD_FOOT = PAD.bottom + STRIP.h + STRIP.gap;

/** The room between the picture and the words beside it, in css px: the strip's own control to
 *  control, since a photograph and the sentence about it are two things in one row. */
const COLUMN_GAP = GAP.strip;

/*
 * The words column is a flex item in the row's `flex-end` alignment, so its FOOT always sits on the
 * card's own foot line no matter how tall its content grows. `minHeight: CARD_H_BIG` gives it the
 * card's own height as a floor, so at the common measure (one or two lines) its top edge is the
 * photograph's top edge and the title reads as the heading of the picture beside it. The body's
 * height is not ours — a sentence in seven languages, two lines in most and three in a narrow
 * window — and a third line grows the column PAST that floor, which `flex-end` resolves by pushing
 * it UPWARD: the title climbs above the photograph rather than the answers dropping into the plate.
 */

/**
 * The two answers: how tall a pill is, the room around its word, and the air between the pair, in
 * css px.
 *
 * THEY ARE THE ONLY BUTTONS ON THIS SURFACE, so they are not the strip's chips. A chip stands in a
 * band of settings among a dozen other things and is read by its neighbours; these two are the
 * whole of what a returning visitor does here, and at the strip's own height with a caption inside
 * them they read as labels rather than as things to press. So the pill takes the height a control
 * standing in a shelf's ROW OF NAMES takes (`SHELF_TABS.field`, the search field's own plate) and
 * the room a name in that row keeps either side of itself (`SHELF_TABS.padX`), which is the one
 * place this frame sizes a control against words rather than against a band.
 *
 * The gap is tighter than anything else in the column, so the pair reads as one row of two rather
 * than as two controls that happen to be level.
 */
const ANSWER = { h: SHELF_TABS.field, padX: SHELF_TABS.padX, gap: GAP.sliderPart } as const;

/**
 * How wide the body line is allowed to run before it wraps, in ems of its own size.
 *
 * A MEASURE, not a box: type here is one fixed size per role, so what decides where a sentence
 * breaks is how many characters make a comfortable line, and an em is the unit that says the same
 * thing in every script. Measured at both window sizes: the sentence takes two lines in the five
 * alphabetic locales and one in Chinese and Thai, which say it in fewer characters. A single line
 * of the English would run most of the way across the window and be read by turning the head; a
 * narrower measure breaks the Chinese two characters before its end, which is a worse line than
 * none.
 */
const BODY_MEASURE = 30;

/** The long side of the photograph, in device px. HEADROOM: the picture is drawn about 200 css px
 *  wide, so this is comfortably over what a 2x screen asks of it, and it is a power of two, which
 *  is the size a texture is happiest at. */
const SHOT_PX = 1024;

/** How far the card rises into place, and how far the whole offer drops as it goes: the registry's
 *  own amplitudes, since a distance typed at an element is the same unfindable decision a duration
 *  typed there is. */
const CARD_RISE = MOTIONS['restore.card.arrive'].amplitude;
const WORDS_RISE = MOTIONS['restore.words.arrive'].amplitude;
const LEAVE_DROP = MOTIONS['restore.offer.leave'].amplitude;

/**
 * How long the offer waits before taking itself, in seconds.
 *
 * Long enough to read it, see what is in the picture and decide, and short enough that a visitor
 * who has walked away comes back to their map rather than to a question. It is the mark under the
 * card that carries the number, not this constant: a hand reaching for the card or either pill
 * pauses the clock.
 */
export const RESTORE_AFTER_S = 12;

export interface RestoreShelfProps {
  /** The saved map, for its photograph. */
  state: GridState;
  onRestore: () => void;
  onDismiss: () => void;
}

export function RestoreShelf(props: RestoreShelfProps) {
  return (
    <ScaleProvider value={SHELF_SCALE}>
      <RestoreShelfBody {...props} />
    </ScaleProvider>
  );
}

function RestoreShelfBody({ state, onRestore, onDismiss }: RestoreShelfProps) {
  const t = useT();
  const present = useIsPresent();
  const [shot, setShot] = useState<string | null | undefined>(undefined);
  /** A hand resting on a pill is a hand over the offer: the pills are siblings of the card (a
   *  button cannot nest in a button), so the pointer leaving the card FOR a pill would resume the
   *  clock exactly while someone aims at "start fresh". */
  const [overAnswer, setOverAnswer] = useState(false);
  const arriving = useMotionAllowed('restore.offer.arrive');
  const plinth = useBeat('restore.offer', 'plinth');
  const cardBeat = useBeat('restore.offer', 'card');
  const wordsBeat = useBeat('restore.offer', 'words');
  const answersBeat = useBeat('restore.offer', 'answers');
  const leaving = useMotion('restore.offer.leave');

  useEffect(() => {
    let dropped = false;
    void (async () => {
      // THE PICTURE RECT'S OWN 568:333, which is what every candidate photograph is already taken
      // at: the design's "the card's own 660:450" names the card's SHAPE, and the plate's aspect
      // asked of a picture that fills the rect inside it would letterbox. Never wider than this
      // either way — the photograph is framed in sea to reach whatever aspect it is asked for, and
      // every aspect wider than the rect buys that sea at the island's expense.
      const png = await renderThumbnail(state, SHOT_PX, CARD.pic.w / CARD.pic.h);
      if (!dropped) setShot(png);
    })();
    return () => { dropped = true; };
  }, [state]);

  return (
    <motion.div
      initial={arriving ? { opacity: 0 } : false}
      animate={{ opacity: 1, y: 0 }}
      exit={arriving ? { opacity: 0, y: LEAVE_DROP, transition: leaving } : { opacity: 0, transition: leaving }}
      transition={plinth}
      style={{ position: 'fixed', left: 0, right: 0, bottom: 0, pointerEvents: 'none', zIndex: z.panel }}
    >
      <div style={{ position: 'relative', display: 'flex', justifyContent: 'center' }}>
        {/* The plinth: the shelves' own backing band, drawn exactly as they draw it. The card
            stands up out of it and nothing else is in it. */}
        <div
          style={{
            position: 'absolute',
            left: -PLATE_BAND.overhang, right: -PLATE_BAND.overhang,
            bottom: -PLATE_BAND.radius, height: PLATE_BAND.top + PLATE_BAND.radius,
            borderRadius: PLATE_BAND.radius, background: BAR.fill,
          }}
        />

        {/* The offer, hung from the card's own foot line at the shelf's left edge. In flow, so it
            is what gives the band above its height. */}
        <div
          style={{
            position: 'relative', width: '100%', boxSizing: 'border-box',
            paddingLeft: PAD.side, paddingRight: PAD.right, paddingBottom: CARD_FOOT,
            display: 'flex', alignItems: 'flex-end', gap: COLUMN_GAP,
          }}
        >
          <motion.div
            initial={arriving ? { opacity: 0, y: CARD_RISE } : false}
            animate={{ opacity: 1, y: 0 }}
            transition={cardBeat}
            // FLEX, so the card is not an inline-level box: a line box would hold the descender
            // slack of the frame's own font under it and stand the card six px off its foot line.
            style={{ display: 'flex', flex: '0 0 auto' }}
          >
            <TimedButton
              after={RESTORE_AFTER_S}
              paused={!present || overAnswer}
              onPress={onRestore}
              ring={ACTIVE}
              clock="stadium"
              // The card's OWN label, not just its action: an `aria-label` overrides its contents,
              // so without the title and body joined in, a screen reader hears only "resume" and
              // never the offer it is resuming.
              aria-label={`${t('restore.title')}. ${t('restore.body')} ${t('restore.resume')}`}
              data-testid="restore-card"
              style={{
                ...btnReset, width: CARD_W_BIG, height: CARD_H_BIG,
                pointerEvents: 'auto', cursor: cursors.clickable, padding: 0,
              }}
            >
              <CardFace shot={shot} waited />
            </TimedButton>
          </motion.div>

          {/* The words and the two answers, in one column beside the picture: what is being
              offered, and the two things that may be done about it, in reading order. They stand on
              the MAP — the card's foot is the only part of this that reaches the plate — so they
              wear the outline every unplated word in this frame wears. */}
          <div
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
              gap: GAP.row, minHeight: CARD_H_BIG,
            }}
          >
            <motion.div
              initial={arriving ? { opacity: 0, y: WORDS_RISE } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={wordsBeat}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                gap: SHELF_TABS.underlineGap,
              }}
            >
              {/* At a shelf name's size, because that is what it is: the heading of the one thing
                  standing on the plate below it. */}
              <BarText size={TEXT.shelfTab} onMap align="left" weight={900}>
                {t('restore.title')}
              </BarText>
              {/* It WRAPS, where every other label in this frame is one line: it is a sentence
                  rather than a name, and `BarText` holds its words on one line by default because
                  a control is as wide as its own label here. Two lines beside the picture, in
                  every language. */}
              <BarText
                size={TEXT.head}
                onMap
                align="left"
                style={{ whiteSpace: 'normal', maxWidth: TEXT.head * BODY_MEASURE }}
              >
                {t('restore.body')}
              </BarText>
            </motion.div>

            <motion.div
              initial={arriving ? { opacity: 0, y: WORDS_RISE } : false}
              animate={{ opacity: 1, y: 0 }}
              transition={answersBeat}
              onPointerEnter={() => setOverAnswer(true)}
              onPointerLeave={() => setOverAnswer(false)}
              // Focus and blur bubble in React's synthetic system, so this wrapper sees a tabbed-to
              // pill too: a keyboard visitor who lands on Start fresh and pauses must find the
              // offer held, not resumed out from under them for having no pointer to hover with.
              onFocus={() => setOverAnswer(true)}
              onBlur={() => setOverAnswer(false)}
              style={{ display: 'flex', gap: ANSWER.gap, pointerEvents: 'auto' }}
            >
              {/* Repeats the card's own action for a visible target; the card already carries the
                  full offer for keyboard and screen-reader visitors, so this one is hidden from
                  both rather than standing as a second, identically-named control. */}
              <motion.button
                type="button"
                {...buttonMotion}
                aria-hidden
                tabIndex={-1}
                data-testid="restore-resume"
                onClick={onRestore}
                style={{
                  ...btnReset, cursor: cursors.clickable, borderRadius: 999,
                  height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: ACTIVE,
                }}
              >
                <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.resume')}</BarText>
              </motion.button>
              <motion.button
                type="button"
                {...buttonMotion}
                data-testid="restore-fresh"
                onClick={onDismiss}
                style={{
                  ...btnReset, cursor: cursors.clickable, borderRadius: 999,
                  height: ANSWER.h, padding: `0 ${ANSWER.padX}px`, background: PLATE,
                }}
              >
                <BarText size={TEXT.head} color={PLATE_INK} weight={900}>{t('restore.fresh')}</BarText>
              </motion.button>
            </motion.div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}
