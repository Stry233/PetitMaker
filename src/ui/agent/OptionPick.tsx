import { displayAgentText } from '../../agent/tool-labels';
/*
 * Renders a gate whose answer is one of two or three sketched options. The log stores a selection as
 * a words verdict, so `optionAskFrom` recovers the selected index by matching the answer to a caption.
 * Open options use hover fill; the selected option uses an ink ring, and other settled options are
 * disabled and dimmed. "None of these" declines the gate without stopping the job.
 */
import { useState, type ReactNode } from 'react';
import { AskCard, AskPill, QuickRow, VerdictChip, type VerdictMark } from './GateBlock';
import { Icon } from './icons';
import { edge } from './tokens';
import { ACTIVE, INK, INSET, PLATE } from '../design/tokens';
import { cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { AskRecord } from '../../agent/core/project-view';
import type { GateOption } from '../../agent/core/types';

/** A proposed option and an optional map capture supplied by the rendering caller. */
export interface OptionCard {
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
 * AN ASK CARRYING OPTIONS, READ AS A PICK — or nothing, for an ask that offered none.
 *
 * THE PICK IS AN ANSWER IN WORDS, and this is where that is decoded. Tapping a card sends the
 * caption as the gate's `words`, exactly as typing it would, so the settled log holds a sentence and
 * the offer; the index is recovered by matching the two. A `words` answer matching NO caption is a
 * real state and not a pick — the user typed something of their own over an open pick — so it reads
 * as "none of these, answered in words". A decline (`skip`) is the held refusal.
 *
 * `thumb` builds one card's picture from its rect; the caller owning a renderer supplies it (this
 * component knows nothing about capturing a map).
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
const DIM = 0.5;

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
    <button
      type="button"
      data-testid="option-card"
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
        borderRadius: 12,
        background: lit ? ACTIVE : PLATE,
        padding: 8,
        textAlign: 'left',
        flex: '0 0 auto',
        opacity: dim ? DIM : 1,
        cursor: settled ? cursors.default : cursors.clickable,
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
            borderRadius: 8,
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
            borderRadius: 999,
            padding: '3px 9px',
            ...roleFont('small'),
            fontFamily: font.family,
            color: INK,
          }}
        >
          <Icon id="pw-check" size={11} />
          {t('agent3.gate_verdict_picked')}
        </span>
      )}
    </button>
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
          <AskPill testId="option-none" onClick={onDecline}>{t('agent3.option_none')}</AskPill>
        </QuickRow>
      )}
    </AskCard>
  );
}
