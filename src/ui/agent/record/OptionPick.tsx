import { type AskRecord, displayAgentText, type GateOption } from '../../../agent/panel';
/*
 * Renders a gate whose answer is one of two or three sketched options. The log stores a selection as
 * a words verdict, so `optionAskFrom` recovers the selected index by matching the answer to a caption.
 * Open options use hover fill; the selected option uses an ink ring, and other settled options are
 * disabled and dimmed. "None of these" declines the gate without stopping the job.
 */
import { ActionButton } from '../../primitives/ActionButton';
import { useState, type ReactNode } from 'react';
import { AskCard, AskPill, QuickRow, VerdictChip, type VerdictMark } from './GateBlock';
import { Icon } from '../parts/sprite';
import { edge, recede } from '../panel-skin';
import { ACTIVE, INK, INSET, PLATE } from '../../design/tokens';
import { cursors, font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';

/** A proposed option and an optional map capture supplied by the rendering caller. */
interface OptionCard {
  cap: string;
  thumb?: ReactNode;
}

/** A pick ask, as this card reads one. Built from an `AskRecord` by `optionAskFrom`. */
export interface OptionAsk {
  gateId: string;
  /** The question that owns the options, rendered verbatim (logged in the locale it was asked in). */
  question: string;
  cards: readonly OptionCard[];
  /** Which card was taken, or -1 for "none of these". Absent while the ask is open. */
  picked?: number;
  /** A non-pick outcome, including answers submitted from another surface. */
  verdict?: VerdictMark;
}

/**
 * An ask's options as a pick. Tapping a card answers with its caption as words, so the pick is
 * recovered by matching the words to a caption; words matching none are the user's own answer, and
 * `skip` is a decline. `thumb` draws a card's picture from its rect.
 */
export function optionAskFrom(
  ask: AskRecord,
  thumb?: (option: GateOption, index: number) => ReactNode,
): OptionAsk | undefined {
  if (!ask.options) return undefined;
  const options = ask.options;
  const base: OptionAsk = {
    gateId: ask.gateId,
    question: ask.summary,
    cards: options.map((option, i) => {
      const node = thumb?.(option, i);
      return { cap: option.cap, ...(node ? { thumb: node } : {}) };
    }),
  };
  if (ask.verdict === undefined) return base;
  if (ask.verdict === 'words') {
    const index = options.findIndex((option) => option.cap === ask.words);
    return index >= 0 ? { ...base, picked: index } : { ...base, verdict: 'none-words' };
  }
  if (ask.verdict === 'declined') return { ...base, verdict: 'none-held' };
  return { ...base, verdict: ask.verdict };
}

/** Option thumbnail size in CSS pixels, shared with the capture caller. */
export const OPTION_THUMB = { width: 88, height: 62 } as const;
const THUMB_W = OPTION_THUMB.width;
const THUMB_H = OPTION_THUMB.height;

/** A settled card that was not the pick: present, and plainly no longer a choice. */
const DIM = recede.apart;

function OptionRow({
  card,
  index,
  picked,
  settled,
  onPick,
}: {
  card: OptionCard;
  index: number;
  picked: boolean;
  settled: boolean;
  onPick(): void;
}) {
  const t = useT();
  const dim = settled && !picked;
  // State-driven hover is cleared by the settled render; imperative styles can outlive that change.
  const [hovered, setHovered] = useState(false);
  const lit = hovered && !settled;
  return (
    <ActionButton
      data-testid="option-card"
      interaction="row"
      data-index={index}
      data-picked={picked ? 'true' : 'false'}
      disabled={settled}
      onClick={onPick}
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'center',
        border: edge,
        // The pick's mark: a solid ink ring, drawn as an inset shadow so the card's own box does not
        // grow by the ring's width and shove its neighbours.
        ...(picked ? { borderColor: INK, boxShadow: `inset 0 0 0 1.5px ${INK}` } : { boxShadow: 'none' }),
        borderRadius: radii.md,
        background: lit ? ACTIVE : PLATE,
        padding: 8,
        textAlign: 'left',
        flex: '0 0 auto',
        // A settled card reports its answer rather than refusing a press.
        opacity: dim ? DIM : 1,
        ...(settled ? { cursor: cursors.default } : {}),
      }}
    >
      {card.thumb && (
        <span
          data-testid="option-thumb"
          style={{
            flex: '0 0 auto',
            width: THUMB_W,
            height: THUMB_H,
            border: edge,
            borderRadius: radii.chip,
            overflow: 'hidden',
            background: INSET,
            display: 'inline-block',
          }}
        >
          {card.thumb}
        </span>
      )}
      <span
        style={{
          ...roleFont('menu'),
          fontFamily: font.family,
          color: INK,
          flex: 1,
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {displayAgentText(card.cap, t)}
      </span>
      {picked && (
        <span
          data-testid="option-mark"
          style={{
            alignSelf: 'flex-start',
            flex: '0 0 auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            background: INSET,
            borderRadius: radii.pill,
            padding: '2px 8px',
            ...roleFont('small'),
            fontFamily: font.family,
            color: INK,
          }}
        >
          <Icon id="pw-check" size={11} />
          {t('agent.gate_verdict_picked')}
        </span>
      )}
    </ActionButton>
  );
}

export function OptionPick({
  ask,
  answerable = true,
  onPick,
  onDecline,
}: {
  ask: OptionAsk | undefined;
  /** See `GateBlock`: a held session keeps its question and offers no control behind it. */
  answerable?: boolean;
  onPick(index: number): void;
  onDecline(): void;
}) {
  const t = useT();
  if (!ask) return null;
  const settled = ask.picked !== undefined || ask.verdict !== undefined;
  const declined = ask.picked === -1;

  return (
    <AskCard settled={settled} testId="option-pick">
      <div
        data-testid="option-question"
        style={{
          ...roleFont('menu'),
          fontFamily: font.family,
          color: INK,
          lineHeight: 1.45,
          minWidth: 0,
        }}
      >
        {ask.question}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {ask.cards.map((card, i) => (
          <OptionRow
            key={`${i}-${card.cap}`}
            card={card}
            index={i}
            picked={ask.picked === i}
            settled={settled || !answerable}
            onPick={() => onPick(i)}
          />
        ))}
      </div>

      {declined && <VerdictChip verdict="none-words" />}
      {ask.verdict && <VerdictChip verdict={ask.verdict} />}
      {!settled && answerable && (
        <QuickRow>
          <AskPill testId="option-none" onClick={onDecline}>{t('agent.option_none')}</AskPill>
        </QuickRow>
      )}
    </AskCard>
  );
}
