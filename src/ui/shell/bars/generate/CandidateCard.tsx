/*
 * One generate candidate: the picture of what its recipe builds, from a real run on a detached map copy,
 * and its recipe's number. Every rect is a fraction of the plate, so the drawing keeps its shape at any
 * width while the caption keeps its size. The visitor's own card (`CustomCard`) is the same card.
 */
import { ActionButton } from '../../../primitives/ActionButton';
import { AnimatePresence, motion } from 'framer-motion';
import { useRef, type CSSProperties, type ReactNode } from 'react';
import { useT } from '../../../../i18n/context';
import { LoadingDots } from '../../../primitives/LoadingDots';
import { btnReset, cursors, radii } from '../../../design/styles';
import { ACTIVE, INSET, MUTED, MUTED_INK, PLATE, PLATE_INK } from '../../../design/tokens';
import { AlertIcon } from '../../../primitives/line-glyphs';
import { roleSize } from '../../../design/text-weight';
import { LOADING_DOT, SHELF_SCALE } from '../../units';
import { BarText, Plate } from '../bar-atoms';
import { CARD, CHOSEN, PLATE_BOX } from './generate-shelf';
import { usePanelTone } from '../bar-panel';

import cardPlate from '../../../../assets/shell/shelf-generate/candidates/roundrect-1.svg';
import picturePlate from '../../../../assets/shell/shelf-generate/candidates/roundrect-2.svg';
import { MOTIONS } from '../../../design/motion/registry';
import { useTransition } from '../../../design/motion/use-motion';

/** How far over its frame a photograph stands as it lands, as a share: the registry's own amplitude,
 *  since a distance typed at an element is the same unfindable decision a duration typed there is. */
const SHOT_RISE = MOTIONS['candidate.shot.arrive'].amplitude;

const pct = (part: number, whole: number): string => `${(part / whole) * 100}%`;

/** The picture's rect within the plate. */
export const PICTURE: CSSProperties = {
  position: 'absolute',
  left: pct(CARD.pic.x, CARD.w), top: pct(CARD.pic.y, CARD.h),
  width: pct(CARD.pic.w, CARD.w), height: pct(CARD.pic.h, CARD.h),
};

/** The recipe line's rect within the plate, which every kind of card writes into. */
export const LINE: CSSProperties = {
  position: 'absolute', left: 0, right: 0,
  top: pct(CARD.label.y, CARD.h), height: pct(CARD.label.h, CARD.h),
};

/** The picture plate's corner as a share of each axis, so it lands on the drawing's corner at any width. */
export const PICTURE_CORNER = `${pct(CARD.pic.r, CARD.pic.w)} / ${pct(CARD.pic.r, CARD.pic.h)}`;

/**
 * The card being put on the map, over its own picture: a landing runs for real on a changed map, and the
 * clicked card is where the eye waits.
 */
export function Landing() {
  return (
    <span
      style={{
        ...PICTURE, display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: PICTURE_CORNER, pointerEvents: 'none',
        background: `${PLATE}cc`,
      }}
    >
      <LoadingDots color={PLATE_INK} size={LOADING_DOT * SHELF_SCALE} />
    </span>
  );
}

/** The card's own box: whatever width the row gives it, at the drawing's shape. */
export const BOX: CSSProperties = {
  position: 'relative', width: '100%', aspectRatio: `${CARD.w} / ${CARD.h}`,
};

/** The plate a chosen card stands on, both terms shares of the card's box (`generate-shelf.ts:CHOSEN`):
 *  it rises as the card is chosen and fades as another is. */
export function ChosenPlate({ chosen }: { chosen: boolean }) {
  const motionOf = useTransition('candidate.chosen');
  const pc = (n: number) => `${n * 100}%`;
  return (
    <AnimatePresence>
      {chosen ? (
        <motion.span
          key="plate"
          data-testid="chosen-plate"
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.94 }}
          transition={motionOf}
          style={{
            position: 'absolute',
            left: `-${pc(CHOSEN.insetX)}`, right: `-${pc(CHOSEN.insetX)}`,
            top: `-${pc(CHOSEN.insetY)}`, bottom: `-${pc(CHOSEN.insetY)}`,
            borderRadius: `${pc(CHOSEN.radiusX)} / ${pc(CHOSEN.radiusY)}`,
            background: ACTIVE, pointerEvents: 'none',
          }}
        />
      ) : null}
    </AnimatePresence>
  );
}

/** Shared refusal message for sample and custom candidate thumbnails. */
export function NoteText({ text }: { text: string }) {
  return (
    <span
      style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: 4, padding: '6px 8%', boxSizing: 'border-box', width: '100%', height: '100%',
      }}
    >
      <AlertIcon size={24} style={{ flexShrink: 0, color: MUTED, pointerEvents: 'none' }} />
      <BarText role="small" color={PLATE_INK} weight={700} style={{ width: '100%', flexShrink: 0 }}>
        <span style={{ display: 'block', textAlign: 'center', whiteSpace: 'normal', textWrap: 'balance' }}>{text}</span>
      </BarText>
    </span>
  );
}

/** The card's plate on a cream panel: the inset, the fill a field on that plate takes. */
const CREAM_PLATE: CSSProperties = {
  position: 'absolute',
  left: `${PLATE_BOX.insetX * 100}%`, right: `${PLATE_BOX.insetX * 100}%`,
  top: `${PLATE_BOX.insetY * 100}%`, bottom: `${PLATE_BOX.insetY * 100}%`,
  borderRadius: `${PLATE_BOX.radiusX * 100}% / ${PLATE_BOX.radiusY * 100}%`,
  background: INSET, pointerEvents: 'none',
};

/** The two plates and the picture between them, filling whatever box the caller gives. */
export function CardFace({ shot, waited, placeholder, bare = false, face }: {
  shot: string | null | undefined;
  /** What the picture with its plate wears where a morph finds it as another arrangement's picture (`primitives/morph.ts:MORPH_FACE_ATTR`). */
  face?: Record<string, string>;
  /** The picture alone, filling the box with `radii.field` corners, without the two plates. */
  bare?: boolean;
  /** Whether this card was drawn before its picture existed, which is what makes the arrival an
   *  arrival. A card that had its shot on mount has nothing to announce. */
  waited: boolean;
  /** What stands in the frame while there is no picture and none is being taken. */
  placeholder?: ReactNode;
}) {
  const shotMotion = useTransition('candidate.shot.arrive');
  const cream = usePanelTone() === 'cream';
  // A face (`face`) is the picture with its own plate, so the two travel as one.
  const framed = face !== undefined && !bare;
  const frame: CSSProperties = bare
    ? { position: 'absolute', inset: 0, borderRadius: radii.field, background: PLATE }
    : framed ? { position: 'absolute', inset: 0, borderRadius: PICTURE_CORNER } : { ...PICTURE, borderRadius: PICTURE_CORNER };
  const picture = (
    <>
      {bare ? null : <Plate src={picturePlate} style={framed ? { inset: 0, width: '100%', height: '100%' } : PICTURE} />}

      {/* The picture is framed in sea to the plate's own shape before it gets here, so it fills the
          rect to its edges and the only thing left to do is turn its corners. */}
      <span
        {...(framed ? {} : face)}
        style={{
          ...frame,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          pointerEvents: 'none', overflow: 'hidden',
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
        ) : shot === undefined ? <LoadingDots color={PLATE_INK} size={LOADING_DOT * SHELF_SCALE} /> : placeholder ?? null}
      </span>
    </>
  );
  return (
    <>
      {bare ? null : cream ? <span style={CREAM_PLATE} /> : <Plate src={cardPlate} style={{ inset: 0, width: '100%', height: '100%' }} />}
      {framed ? <span {...face} style={{ ...PICTURE, display: 'block', pointerEvents: 'none' }}>{picture}</span> : picture}
    </>
  );
}

interface Props {
  seed: number;
  /** Why this card has no picture, written in its empty frame; shown only while there is no picture. */
  note?: string;
  /** What this card is, where that is not a recipe number: the letter it builds, or the picture's
   *  name. A picture kind is deterministic, so the card is its own recipe. */
  name?: string;
  /** The photograph: `undefined` while it is taken, `null` where none could be (the card still builds). */
  shot: string | null | undefined;
  selected: boolean;
  /** The last click on this card did not reach the map. */
  failed?: boolean;
  /** This card's own click is being put on the map. */
  landing?: boolean;
  onSelect: () => void;
}

export function CandidateCard({ seed, name, note, shot, selected, failed, landing, onSelect }: Props) {
  const waited = useRef(shot === undefined);
  const t = useT();
  // A picture kind's card is what it shows -- the letter, or the picture's name -- so it names
  // itself with that rather than with a recipe number it does not have.
  const label = name ?? t('generate.recipe', { n: seed });
  /* A card with a note has nothing to land: it stands dimmed and refusing, the reason in its frame. */
  const refuses = Boolean(note) && !shot;

  return (
    <ActionButton
      interaction="action" dim="caller" unavailable={refuses}
      aria-label={label}
      aria-pressed={selected}
      data-testid={`shell-candidate-${name ?? seed}`}
      onClick={() => { if (!refuses) onSelect(); }}
      style={{
        ...btnReset, ...BOX, cursor: refuses ? cursors.blocked : cursors.clickable, pointerEvents: 'auto',
      }}
    >
      {/* Drawn first, so the card's own plate covers all of it but the margin. */}
      <ChosenPlate chosen={selected} />
      <CardFace
        shot={shot}
        waited={waited.current}
        {...(note && !shot ? { placeholder: <NoteText text={note} /> } : {})}
      />
      {landing ? <Landing /> : null}

      {/* The card's line: its recipe, or briefly that a click did not reach the map. */}
      <BarText role="small" color={PLATE} style={LINE}>
        {failed ? t('generate.failed') : label}
      </BarText>
    </ActionButton>
  );
}

/** The picture kind's own card: an import in place of the field, then a candidate like any other. */
export function ImportCard({ name, shot, selected, failed, landing, onPick, onSelect }: {
  /** A name for the chosen picture, already made readable by the caller. Null while none is chosen. */
  name: string | null;
  shot: string | null | undefined;
  selected: boolean;
  failed?: boolean;
  landing?: boolean;
  onPick: () => void;
  onSelect: () => void;
}) {
  const t = useT();
  const waited = useRef(shot === undefined);
  return (
    <div style={{ ...BOX, pointerEvents: 'auto' }} data-testid="shell-candidate-import">
      <ChosenPlate chosen={selected} />
      {/* The face every card wears, the empty frame carrying the mark. */}
      <CardFace
        shot={shot}
        waited={waited.current}
        placeholder={<BarText role="lead" color={MUTED_INK} weight={900}>+</BarText>}
      />
      {/* The picture itself is the click that lands the run, once there is one; empty, the whole
          frame is the way to fetch one. */}
      <ActionButton
        interaction="action"
        aria-label={name ? t('generate.import_change') : t('generate.import_pick')}
        onClick={name && shot ? onSelect : onPick}
        style={{ ...btnReset, ...PICTURE, borderRadius: PICTURE_CORNER, cursor: cursors.clickable, background: 'transparent' }}
      />
      {landing ? <Landing /> : null}
      <span style={{ ...LINE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <ActionButton
          interaction="action"
          aria-label={t('generate.import_change')}
          onClick={onPick}
          style={{ ...btnReset, ...linePill(), cursor: cursors.clickable }}
        >
          <LinePillText text={failed ? t('generate.failed') : name ?? t('generate.import_pick')} />
        </ActionButton>
      </span>
    </div>
  );
}

/** Room around the caption pill's own text, in css px. */
export const FIELD_PAD = 8;
/**
 * The size every typed digit stands at, in css px: fixed where ten digits fit the frame, so a number never
 * resizes as it is typed.
 */
export const GIANT_SIZE = roleSize('lead');

/** The pill on a card's line that names what an empty card fetches or starts. Every box between the
 *  pill and the ellipsis span carries `minWidth: 0`, so a long name ellipsizes. */
export function linePill(): CSSProperties {
  return {
    height: '100%', maxWidth: '86%', minWidth: 0, padding: `0 ${FIELD_PAD}px`, borderRadius: radii.pill,
    background: PLATE, display: 'flex', alignItems: 'center', overflow: 'hidden',
  };
}

/** The pill's words, cut with an ellipsis where they outgrow it. */
export function LinePillText({ text }: { text: string }) {
  return (
    <BarText role="small" color={PLATE_INK} style={{ minWidth: 0, maxWidth: '100%' }}>
      <span style={{ display: 'block', minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
    </BarText>
  );
}
