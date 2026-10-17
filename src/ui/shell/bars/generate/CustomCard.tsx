/** The generate shelf's own card: a recipe number or a word typed into the picture's frame. */
import { presence } from '../../../design/motion';
import { ActionButton } from '../../../primitives/ActionButton';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import type { CSSProperties } from 'react';
import { useT } from '../../../../i18n/context';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { btnReset, cursors, radii } from '../../../design/styles';
import { ACTIVE, MUTED_INK, PLATE, PLATE_INK } from '../../../design/tokens';
import { LOADING_DOT, SHELF_SCALE, TEXT } from '../../units';
import { BarText, Plate } from '../bar-atoms';
import { SEED_DIGITS, TEXT_MAX_CHARS } from './generate-shelf';
import { limitTextGraphemes } from '../../../../tools/generation/stencil';
import cardPlate from '../../../../assets/shell/shelf-generate/candidates/roundrect-1.svg';
import picturePlate from '../../../../assets/shell/shelf-generate/candidates/roundrect-2.svg';
import { MOTIONS } from '../../../design/motion/registry';
import { PaintedText } from './PaintedText';
import { useGhostField } from './use-ghost-field';
import { BOX, ChosenPlate, FIELD_PAD, GIANT_SIZE, Landing, LINE, NoteText, PICTURE, PICTURE_CORNER } from './CandidateCard';
/** The mark on the confirm pill: this frame draws no tick, and one glyph for one meaning is better
 *  than a word that does not fit a button this size in every language. */
const CONFIRM_MARK = '\u2713';
/** The mark a filled card's number carries besides itself: the pencil that says the pill is also
 *  the way back to typing, not just a reading of what was typed. */
const EDIT_MARK = '\u270e';
/** How far the face that is leaving shrinks as it goes, as a share: the registry's own amplitude. */
const FLIP_RISE = MOTIONS['candidate.custom.flip'].amplitude;
/**
 * The rule the number is written on: its own element at a fixed width and place, sized in px off
 * `GIANT_SIZE` (the slot's ambient em would be the wrong size).
 */
const RULE_W = Math.round(GIANT_SIZE * 5.2);
/** How far under the slot's middle the rule sits: clear of the digits' own descender line, so the
 *  number stands on it rather than in it. */
const RULE_DROP = Math.round(GIANT_SIZE * 0.75);
const SEED_RULE: CSSProperties = {
  position: 'absolute',
  left: '50%',
  top: '50%',
  transform: `translate(-50%, ${RULE_DROP}px)`,
  width: RULE_W,
  height: 2,
  background: MUTED_INK,
  borderRadius: radii.hair,
};
/** The confirm pill's band in percent of the frame: its offset and height, from which `PILL_RESERVE` derives. */
const PILL_BOTTOM = 6;
const PILL_HEIGHT = 20;
/** The share of the frame the pill's band takes, which the digits stay clear of. */
const PILL_RESERVE = `${PILL_BOTTOM + PILL_HEIGHT}%`;
/** The confirm pill: a wide `ACTIVE` band along the frame's own bottom edge, sized as shares of the
 *  frame it stands in so it keeps its proportion at any card width. */
const CONFIRM_PILL: CSSProperties = {
  position: 'absolute',
  left: '8%', right: '8%', bottom: `${PILL_BOTTOM}%`, height: `${PILL_HEIGHT}%`,
  borderRadius: radii.pill,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: ACTIVE, cursor: cursors.clickable,
};
/** The caret bar, sized off the digits' em. */
const CARET: CSSProperties = { width: '0.07em', height: '100%', background: PLATE_INK, borderRadius: radii.hair };
interface CustomProps {
  /** What the field takes: a recipe number, or the characters a letter kind builds the shape of. */
  field?: 'number' | 'glyph';
  /** Why this card built nothing, drawn in its empty frame as a dealt card's is. */
  note?: string;
  onRetry?: () => void;
  /** The number the visitor gave this card, or null while it has none. */
  seed: number | null;
  /** `glyph` field only: the character they gave it, or null while it has none. */
  glyph?: string | null;
  /** What this card is called. A picture kind has no recipe to name, so the caller says. */
  title?: string;
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
 * The card the visitor types. One slot with a fixed rule shows the blank, the caret alone on focus, then
 * the giant digits with a confirm pill along the frame's foot; a hidden input over the frame holds focus
 * and IME, and Enter confirms like the pill. Filled, it is a candidate whose click lands the run and
 * whose line (`#4127 ✎`) is the way back to typing.
 */
export function CustomCard({
  field = 'number', seed, glyph = null, title, note, draft, shot, selected, failed, landing,
  onDraft, onCommit, onEdit, onSelect, onRetry,
}: CustomProps) {
  const isGlyph = field === 'glyph';
  const t = useT();
  const flip = presence('candidate.custom.flip', { opacity: 0, scale: 1 - FLIP_RISE }, { reduced: useReducedMotionConfig() });
  const name = title ?? t('generate.custom');
  /** The field is showing whenever there is no number yet, or the number is being typed over. */
  const value = isGlyph ? glyph : (seed === null ? null : String(seed));
  const typing = value === null || draft !== null;
  /** What is standing in the frame right now — the confirm pill and the giant digits both read
   *  this, since there is nothing to confirm or to enlarge about an empty field. */
  const typed = draft ?? value ?? '';
  /** The hidden input's focus and real selection, which the painted digits show in its place. */
  const ghost = useGhostField(typed);
  const { composing } = ghost;

  return (
    <div style={{ ...BOX, pointerEvents: 'auto' }} data-testid="shell-candidate-custom">
      {selected ? <ChosenPlate /> : null}
      <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />
      <Plate src={picturePlate} style={PICTURE} />

      <AnimatePresence initial={false} mode="wait">
        {typing ? (
          /* The frame is the field: no capsule, no chrome, just the number standing where its
             photograph will and a hidden input sized to the same rect underneath it. */
          <motion.span
            key="typing"
            {...flip}
            style={PICTURE}
          >
            <input
              ref={ghost.inputRef}
              type="text"
              inputMode={isGlyph ? 'text' : 'numeric'}
              autoFocus={seed !== null}
              value={typed}
              // IME preedit can contain more characters than the final Chinese or Japanese word.
              onChange={(e) => onDraft(isGlyph
                ? composing.current ? e.target.value : limitTextGraphemes(e.target.value, TEXT_MAX_CHARS)
                : e.target.value.replace(/\D/g, '').slice(0, SEED_DIGITS))}
              onCompositionEnd={(e) => {
                if (isGlyph) onDraft(limitTextGraphemes(e.currentTarget.value, TEXT_MAX_CHARS));
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !(isGlyph && (composing.current || e.nativeEvent.isComposing || e.keyCode === 229))) onCommit();
              }}
              aria-label={name}
              // `pw-ghost-field` also hides the native selection highlight; `PaintedText` paints the real one.
              className="pw-ghost-field"
              style={{
                position: 'absolute', inset: 0, width: '100%', height: '100%',
                margin: 0, padding: 0, border: 'none', outline: 'none',
                background: 'transparent', color: 'transparent', caretColor: 'transparent',
                // 16: iOS Safari zooms the whole page in on focus for any input below this size.
                fontSize: 16, borderRadius: PICTURE_CORNER, cursor: cursors.text,
              }}
            />

            {/* The number's slot centres above the pill's band, reserved always so it never re-centres. */}
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
              {/* The digits and the caret share one wrapper at the digits' size, since `CARET` is sized in em. */}
              <BarText size={GIANT_SIZE} color={PLATE_INK} weight={900}>
                <PaintedText
                  text={typed} start={ghost.start} end={ghost.end} focused={ghost.focused} moves={ghost.moves}
                  caret={CARET} paintRef={ghost.paintRef}
                />
              </BarText>
            </span>

            {/* The confirm: a wide pill along the frame's own bottom edge, once there is something
                to confirm — an empty field has nothing to take. */}
            <AnimatePresence initial={false}>
              {typed !== '' ? (
                <ActionButton
                  key="confirm"
                  interaction="action"
                  {...flip}
                  aria-label={t(isGlyph ? 'generate.text_confirm' : 'generate.custom_confirm')}
                  onClick={() => { if (!composing.current) onCommit(); }}
                  style={{ ...btnReset, ...CONFIRM_PILL }}
                >
                  <BarText size={TEXT.small} color={PLATE_INK} weight={900}>{CONFIRM_MARK}</BarText>
                </ActionButton>
              ) : null}
            </AnimatePresence>
          </motion.span>
        ) : (
          /* The picture, and a click on it lands the run the number names. */
          <ActionButton
            key="picture"
            interaction="action"
            {...flip}
            aria-label={onRetry ? t('export.review.retry') : isGlyph ? name : t('generate.recipe', { n: seed ?? 0 })}
            aria-pressed={selected}
            aria-disabled={Boolean(note) && !shot && !onRetry}
            aria-busy={shot === undefined}
            onClick={() => { if (onRetry) onRetry(); else if (!(note && !shot)) onSelect(); }}
            style={{
              ...btnReset, ...PICTURE,
              cursor: note && !shot && !onRetry ? cursors.blocked : cursors.clickable,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              overflow: 'hidden', borderRadius: PICTURE_CORNER,
            }}
          >
            {shot ? (
              <img src={shot} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            ) : shot === undefined ? <LoadingDots color={PLATE_INK} size={LOADING_DOT * SHELF_SCALE} /> : note ? <NoteText text={note} /> : null}
          </ActionButton>
        )}
      </AnimatePresence>
      {landing ? <Landing /> : null}

      {/* The line: the way back to the field, drawn as one. Empty, it names what this card is. */}
      {typing ? (
        <BarText size={TEXT.small} color={PLATE} style={LINE}>{name}</BarText>
      ) : (
        <span style={{ ...LINE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <ActionButton
            interaction="action"
            aria-label={t(isGlyph ? 'generate.text_edit' : 'generate.custom_edit')}
            onClick={onEdit}
            style={{
              ...btnReset, height: '100%', padding: `0 ${FIELD_PAD}px`, borderRadius: radii.pill,
              background: PLATE, cursor: cursors.clickable,
              display: 'flex', alignItems: 'center',
            }}
          >
            <BarText size={TEXT.small} color={PLATE_INK}>
              {failed ? t('generate.failed') : `${isGlyph ? glyph : `#${seed}`} ${EDIT_MARK}`}
            </BarText>
          </ActionButton>
        </span>
      )}
    </div>
  );
}