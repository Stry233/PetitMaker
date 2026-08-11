/*
 * CandidateCard.tsx — one candidate: a picture of what a recipe builds, and the recipe's number.
 *
 * The picture is a real generation of that recipe, run on a detached copy of the map and painted
 * cell by cell, which is why it is exactly what clicking the card produces and why making it never
 * touches the map under the shelf. Until it arrives the card shows that it is still being made,
 * rather than an empty frame that looks like a candidate with nothing in it.
 *
 * The card takes whatever width the row gives it and keeps the drawing's shape from that: every
 * rect inside is a FRACTION of the plate, so the picture stays in proportion at any size. The
 * caption does not follow, since a recipe number that shrank with the card would stop being
 * readable exactly when the row got tight.
 *
 * THE LAST CARD IS YOURS, AND IT IS THE SAME CARD. `CustomCard` draws the same plate, picture and
 * line; what differs is that its line is a FIELD and its picture is the number itself, standing
 * where a photograph will once there is one to take. That replaces the seed field and its confirm
 * step: a seed was never a setting, it is a candidate you name yourself, so it belongs in the row
 * with the ones that were named for you.
 *
 * IT IS ALSO THE ONE CARD A NEW BATCH DOES NOT REPLACE, which is why it is drawn as a field: a
 * batch that overwrote a number somebody typed would lose the only thing on this shelf they
 * authored. The field is what says the number stays — the others carry their recipe as plain text
 * and are re-drawn under it.
 */
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { useT } from '../../../i18n/context';
import { LoadingDots } from '../../primitives/LoadingDots';
import { btnReset, buttonMotion, cursors } from '../../design/styles';
import { ACTIVE, MUTED_INK, PLATE, PLATE_INK } from '../../design/tokens';
import { TEXT } from '../units';
import { BarText, Plate } from './bar-atoms';
import { CARD, CHOSEN, SEED_DIGITS } from './generate-shelf';

import cardPlate from '../../../assets/shell/shelf-generate/candidates/roundrect-1.svg';
import picturePlate from '../../../assets/shell/shelf-generate/candidates/roundrect-2.svg';
import { MOTIONS } from '../motion/registry';
import { useMotion } from '../motion/use-motion';

/** How far over its frame a photograph stands as it lands, as a share: the registry's own amplitude,
 *  since a distance typed at an element is the same unfindable decision a duration typed there is. */
const SHOT_RISE = MOTIONS['candidate.shot.arrive'].amplitude;

const pct = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/** The picture's rect within the plate. */
const PICTURE: CSSProperties = {
  position: 'absolute',
  left: pct(CARD.pic.x, CARD.w), top: pct(CARD.pic.y, CARD.h),
  width: pct(CARD.pic.w, CARD.w), height: pct(CARD.pic.h, CARD.h),
};

/** The recipe line's rect within the plate, which every kind of card writes into. */
export const LINE: CSSProperties = {
  position: 'absolute', left: 0, right: 0,
  top: pct(CARD.label.y, CARD.h), height: pct(CARD.label.h, CARD.h),
};

/**
 * The picture plate's own corner, as a share of each axis.
 *
 * A percentage radius resolves against the box it is on, and the picture keeps the drawing's shape
 * at every card width, so the pair lands on the plate's 50 design px corner whatever the row can
 * spare. One percentage would draw an ellipse instead.
 */
const PICTURE_CORNER = `${pct(CARD.pic.r, CARD.pic.w)} / ${pct(CARD.pic.r, CARD.pic.h)}`;

/** Room around the caption pill's own text, in css px. */
const FIELD_PAD = 8;

/** The mark on the confirm pill: this frame draws no tick, and one glyph for one meaning is better
 *  than a word that does not fit a button this size in every language. */
const CONFIRM_MARK = '\u2713';

/** The mark a filled card's number carries besides itself: the pencil that says the pill is also
 *  the way back to typing, not just a reading of what was typed. */
const EDIT_MARK = '\u270e';

/** How far the face that is leaving shrinks as it goes, as a share: the registry's own amplitude. */
const FLIP_RISE = MOTIONS['candidate.custom.flip'].amplitude;

/**
 * How large EVERY typed digit stands, in css px, whatever the count: fixed at the size the
 * ten-digit ceiling itself fits the frame's own ~136px real width at (screenshot-verified), so the
 * number never resizes as more are typed — stability over spectacle, an explicit call over the
 * per-count table this replaced, which made a short number visibly bigger than a long one.
 */
const GIANT_SIZE = 20;

/**
 * The rule the number is written on: a fixed grey line, drawn INDEPENDENTLY of the digits.
 *
 * It is its own absolutely-positioned element rather than a border on the number's box, because a
 * border follows whatever that box is doing — it moved when focus added the caret, and it stretched
 * as the number got longer. A blank to write on is the same blank before, during and after typing,
 * so its width and its place are fixed here and nothing about the digits reaches them.
 *
 * Sized in px off `GIANT_SIZE`, not in `em`: the slot around it carries the card's ambient font, so
 * an em here would resolve against the wrong size entirely.
 */
const RULE_W = Math.round(GIANT_SIZE * 5.2);
/** How far under the slot's middle the rule sits: clear of the digits' own descender line, so the
 *  number stands ON it rather than in it. */
const RULE_DROP = Math.round(GIANT_SIZE * 0.75);

const SEED_RULE: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: `translate(-50%, ${RULE_DROP}px)`,
  width: RULE_W,
  height: 2,
  background: MUTED_INK,
  borderRadius: 2,
};
/** The confirm pill's own band, in percent of the frame it stands in: how far it holds off the
 *  frame's bottom edge, and how tall it stands. Named so the digit region above it (`PILL_RESERVE`)
 *  is DERIVED from the same two numbers rather than a second guess at them. */
const PILL_BOTTOM = 6;
const PILL_HEIGHT = 20;

/** The share of the frame's own height the pill's own band occupies, bottom offset included: what
 *  the digits (and the empty placeholder above it) must leave clear underneath them, or the number
 *  centres in the WHOLE frame while the pill claims a slice of it, reading as sat too low. */
const PILL_RESERVE = `${PILL_BOTTOM + PILL_HEIGHT}%`;

/** The confirm pill: a wide ACTIVE band along the frame's own bottom edge, sized as shares of the
 *  frame it stands in so it keeps its proportion at any card width. */
const CONFIRM_PILL: CSSProperties = {
  position: 'absolute',
  left: '8%', right: '8%', bottom: `${PILL_BOTTOM}%`, height: `${PILL_HEIGHT}%`,
  borderRadius: 999,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: ACTIVE, cursor: cursors.clickable,
};

/** The mark standing where the keyboard is: a plain bar, sized off the digits' own em so it reads
 *  as part of the same giant number whatever the frame's actual width comes out at. The blink
 *  itself is `.pw-caret-blink` in animations.css (a CSS keyframe, same ambient treatment as
 *  `.pw-wavy`/`.pw-blankdrift` there, and outside the registry for the same reason those are). */
const CARET: CSSProperties = {
  display: 'inline-block', width: '0.07em', height: '0.72em', marginLeft: '0.08em',
  background: PLATE_INK, borderRadius: 2, alignSelf: 'center',
};

/**
 * The card being PUT ON THE MAP, over its own picture.
 *
 * Landing a candidate is not instant and it is not always a replay: a card whose recipe was already
 * built arrives in about a tenth of a second, and one landing on a map that already carries another
 * island has to run for real, which is most of a second on a full map. Nothing said so, so the app
 * simply stopped. The card that was clicked is where the eye already is, so that is where the
 * waiting is drawn, over the picture it is about to become.
 *
 * The scrim is the picture's own frame colour rather than a grey: what is happening is that this
 * picture is being taken, not that the card has been put out of reach.
 */
function Landing() {
  return (
    <span
      style={{
        ...PICTURE, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: PICTURE_CORNER, pointerEvents: 'none',
        background: `${PLATE}cc`,
      }}
    >
      <LoadingDots color={PLATE_INK} />
    </span>
  );
}

/** The card's own box: whatever width the row gives it, at the drawing's shape. */
const BOX: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: `${CARD.w} / ${CARD.h}`,
};

/**
 * The mark a chosen card stands on: the bigger yellow plate a chosen tool cell wears.
 *
 * Both terms are SHARES of the card's own box (`generate-shelf.ts:CHOSEN`), so the band is the same
 * width all the way round at whatever size the row gave the card. Two percentages on the radius, not
 * one: a single percentage resolves against both axes and draws an ellipse.
 */
function ChosenPlate() {
  const chosen = useMotion('candidate.chosen');
  const pc = (n: number) => `${n * 100}%`;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={chosen}
      style={{
        position: 'absolute',
        left: `-${pc(CHOSEN.insetX)}`, right: `-${pc(CHOSEN.insetX)}`,
        top: `-${pc(CHOSEN.insetY)}`, bottom: `-${pc(CHOSEN.insetY)}`,
        borderRadius: `${pc(CHOSEN.radiusX)} / ${pc(CHOSEN.radiusY)}`,
        background: ACTIVE, pointerEvents: 'none',
      }}
    />
  );
}

/** The two plates and the picture between them: the drawing every candidate is made of, and the
 *  drawing the restore offer stands one of at 1.8x. It fills whatever box it is given, so the size
 *  is the caller's and the proportions are the drawing's. */
export function CardFace({ shot, waited, placeholder }: {
  shot: string | null | undefined;
  /** Whether this card was drawn before its picture existed, which is what makes the arrival an
   *  arrival. A card that had its shot on mount has nothing to announce. */
  waited: boolean;
  /** What stands in the frame while there is no picture and none is being taken. */
  placeholder?: ReactNode;
}) {
  const shotMotion = useMotion('candidate.shot.arrive');
  return (
    <>
      <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />
      <Plate src={picturePlate} style={PICTURE} />

      {/* The picture is framed in sea to the plate's own shape before it gets here, so it fills the
          rect to its edges and the only thing left to do is turn its corners. */}
      <span
        style={{
          ...PICTURE,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', overflow: 'hidden', borderRadius: PICTURE_CORNER,
        }}
      >
        {shot ? (
          <motion.img
            src={shot}
            alt=""
            draggable={false}
            initial={waited ? { opacity: 0, scale: 1 + SHOT_RISE } : false}
            animate={{ opacity: 1, scale: 1 }}
            transition={shotMotion}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : shot === undefined ? <LoadingDots color={PLATE_INK} /> : placeholder ?? null}
      </span>
    </>
  );
}

interface Props {
  seed: number;
  /** The photograph; `undefined` while it is still being taken, `null` where there was no renderer
   *  to take one with. A card with no picture is still a card: it names its recipe and it builds
   *  it, so what it shows then is its own empty frame rather than dots that will never stop. */
  shot: string | null | undefined;
  selected: boolean;
  /** The last click on this card did not reach the map. */
  failed?: boolean;
  /** This card's own click is being put on the map. */
  landing?: boolean;
  onSelect: () => void;
}

export function CandidateCard({ seed, shot, selected, failed, landing, onSelect }: Props) {
  const waited = useRef(shot === undefined);
  const t = useT();
  const label = t('gen.recipe', { n: seed });

  return (
    <motion.button
      type="button"
      {...buttonMotion}
      aria-label={label}
      aria-pressed={selected}
      data-testid={`shell-candidate-${seed}`}
      onClick={onSelect}
      style={{
        ...btnReset, ...BOX, cursor: cursors.clickable, pointerEvents: 'auto',
      }}
    >
      {/* Drawn first, so the card's own plate covers all of it but the margin. */}
      {selected ? <ChosenPlate /> : null}
      <CardFace shot={shot} waited={waited.current} />
      {landing ? <Landing /> : null}

      {/* The card's own line: which recipe it is, or — briefly, after a click that did not reach
          the map — that it did not build. A run rolls itself back and leaves the cards standing, so
          the card is the only thing that can say the click went nowhere. */}
      <BarText size={TEXT.small} color={PLATE} style={LINE}>
        {failed ? t('gen.failed') : label}
      </BarText>
    </motion.button>
  );
}

interface CustomProps {
  /** The number the visitor gave this card, or null while it has none. */
  seed: number | null;
  /** What is being typed, or null when the field is showing whatever `seed` is. */
  draft: string | null;
  shot: string | null | undefined;
  selected: boolean;
  failed?: boolean;
  landing?: boolean;
  onDraft: (text: string) => void;
  /** Take the digits as the recipe number. The field's own button, and Enter. */
  onCommit: () => void;
  /** Go back to the field with the number in it. */
  onEdit: () => void;
  onSelect: () => void;
}

/**
 * The card the visitor types, in the two states it has.
 *
 * The slot carries a fixed grey RULE (`SEED_RULE`) with the number written over it: empty it is the
 * blank, focused it takes the caret, typed it takes the digits. The rule is drawn independently, so
 * nothing about the number moves or resizes it.
 * FOCUSED and still empty, the hint is gone and a lone blinking caret stands in that same slot: the
 * field is ready to type, said the same way a typed field says it. Once a digit stands, the slot
 * carries THE NUMBER ITSELF as giant centred digits with the caret trailing them, and a wide confirm
 * pill arrives along the frame's own bottom edge. Empty-unfocused, empty-focused and typed are one
 * continuous surface: same slot, same centering, nothing moves between them. A HIDDEN input sized
 * to the whole frame is what actually holds keyboard/IME focus (and is the one place `focused` is
 * read from); the frame is its visible rendering, which is why its focus ring (drawn by the app's
 * own default `*:focus-visible` rule, following the input's own border-radius) reads as a ring
 * around the frame rather than around an element nobody can see. Enter confirms the same as the
 * pill.
 *
 * FILLED, it is a candidate like any other: the picture, and a click on it lands the run. The
 * caption line carries the number PLUS an edit mark (`#4127 ✎`), which is both a reading of what
 * was typed and the way back to typing it — the others carry their recipe as plain text and a new
 * batch draws them again, where this one keeps what was typed.
 *
 * THE CONFIRM BELONGS TO THE TYPING STATE, NOT TO THE CANDIDATE. Clicking a filled card still
 * adopts it with no second step; what needs a button is "I have finished typing", because Enter
 * alone is invisible.
 */
export function CustomCard({
  seed, draft, shot, selected, failed, landing, onDraft, onCommit, onEdit, onSelect,
}: CustomProps) {
  const t = useT();
  const flip = useMotion('candidate.custom.flip');
  const name = t('gen.custom');
  /** Whether the hidden input actually holds focus right now: the one fact that tells the empty
   *  slot whether to show the hint (nobody is here) or the caret alone (somebody just arrived and
   *  has not typed yet). */
  const [focused, setFocused] = useState(false);
  /** The field is showing whenever there is no number yet, or the number is being typed over. */
  const typing = seed === null || draft !== null;
  /** What is standing in the frame right now — the confirm pill and the giant digits both read
   *  this, since there is nothing to confirm or to enlarge about an empty field. */
  const typed = draft ?? (seed === null ? '' : String(seed));

  return (
    <div style={{ ...BOX, pointerEvents: 'auto' }} data-testid="shell-candidate-custom">
      {selected ? <ChosenPlate /> : null}
      <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />
      <Plate src={picturePlate} style={PICTURE} />

      <AnimatePresence initial={false} mode="wait">
        {typing ? (
          /* The frame IS the field: no capsule, no chrome, just the number standing where its
             photograph will and a hidden input sized to the same rect underneath it. */
          <motion.span
            key="typing"
            initial={{ opacity: 0, scale: 1 - FLIP_RISE }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1 - FLIP_RISE }}
            transition={flip}
            style={PICTURE}
          >
            <input
              type="text"
              inputMode="numeric"
              autoFocus={seed !== null}
              value={typed}
              // As many digits as the GENERATOR takes, which is a uint32 and not the five the
              // drawing captions a card with. A field that silently refuses a sixth digit teaches
              // that the app is broken.
              onChange={(e) => onDraft(e.target.value.replace(/\D/g, '').slice(0, SEED_DIGITS))}
              onKeyDown={(e) => { if (e.key === 'Enter') onCommit(); }}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              aria-label={name}
              // pw-ghost-field: color:transparent alone leaves a Ctrl+A/drag-select highlight
              // repainting the real characters in the browser's own selection colours (see the
              // rule in animations.css for why ::selection needs its own override).
              className="pw-ghost-field"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                margin: 0, padding: 0, border: 'none', outline: 'none',
                background: 'transparent', color: 'transparent', caretColor: 'transparent',
                // 16: iOS Safari zooms the whole page in on focus for any input below this size.
                fontSize: 16, borderRadius: PICTURE_CORNER, cursor: cursors.text,
              }}
            />

            {/* The number's own slot, centred in the region ABOVE the confirm pill's own band, not
                the whole frame, so nothing sits low once the pill claims the bottom edge (reserved
                unconditionally, typed or not, so the slot never re-centres as focus or the first
                digit arrive). */}
            <span
              aria-hidden
              style={{
                position: 'absolute', top: 0, left: 0, right: 0, bottom: PILL_RESERVE,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                pointerEvents: 'none', overflow: 'hidden',
              }}
            >
              {/* The rule stands on its own, so nothing the number does can move or resize it. */}
              <span style={SEED_RULE} />
              {/* The digits and the caret, centred over it. Both live inside one wrapper at the
                  DIGITS' size: `CARET` is sized in `em`, and a lone caret outside it resolved
                  against the card's ambient font, drawing the empty field's caret at about a third
                  of the height it jumped to as the first digit landed. */}
              <BarText size={GIANT_SIZE} color={PLATE_INK} weight={900}>
                {typed}
                {focused ? <span className="pw-caret-blink" style={CARET} /> : null}
              </BarText>
            </span>

            {/* The confirm: a wide pill along the frame's own bottom edge, once there is something
                to confirm — an empty field has nothing to take. */}
            <AnimatePresence initial={false}>
              {typed !== '' ? (
                <motion.button
                  key="confirm"
                  type="button"
                  {...buttonMotion}
                  initial={{ opacity: 0, scale: 1 - FLIP_RISE }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 1 - FLIP_RISE }}
                  transition={flip}
                  aria-label={t('gen.custom_confirm')}
                  onClick={onCommit}
                  style={{ ...btnReset, ...CONFIRM_PILL }}
                >
                  <BarText size={TEXT.small} color={PLATE_INK} weight={900}>{CONFIRM_MARK}</BarText>
                </motion.button>
              ) : null}
            </AnimatePresence>
          </motion.span>
        ) : (
          /* The picture, and a click on it lands the run the number names. */
          <motion.button
            key="picture"
            type="button"
            {...buttonMotion}
            initial={{ opacity: 0, scale: 1 - FLIP_RISE }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 1 - FLIP_RISE }}
            transition={flip}
            aria-label={t('gen.recipe', { n: seed ?? 0 })}
            aria-pressed={selected}
            onClick={onSelect}
            style={{
              ...btnReset, ...PICTURE, cursor: cursors.clickable,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', borderRadius: PICTURE_CORNER,
            }}
          >
            {shot ? (
              <img src={shot} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : shot === undefined ? <LoadingDots color={PLATE_INK} /> : null}
          </motion.button>
        )}
      </AnimatePresence>
      {landing ? <Landing /> : null}

      {/* The line: the way back to the field, drawn as one. Empty, it names what this card is. */}
      {typing ? (
        <BarText size={TEXT.small} color={PLATE} style={LINE}>{name}</BarText>
      ) : (
        <span style={{ ...LINE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <motion.button
            type="button"
            {...buttonMotion}
            aria-label={t('gen.custom_edit')}
            onClick={onEdit}
            style={{
              ...btnReset, height: '100%', padding: `0 ${FIELD_PAD}px`, borderRadius: 999,
              background: PLATE, cursor: cursors.clickable,
              display: 'flex', alignItems: 'center',
            }}
          >
            <BarText size={TEXT.small} color={PLATE_INK}>
              {failed ? t('gen.failed') : `#${seed} ${EDIT_MARK}`}
            </BarText>
          </motion.button>
        </span>
      )}
    </div>
  );
}
