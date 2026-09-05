/*
 * Terminal card for answer-only and quiet jobs, as classified by `JobView.kind`. It presents model
 * text as the primary result, summarizes read-only operations in one line and keeps reasoning below
 * the answer. A closing question reuses the gate spine and quick-answer row. Quiet jobs use explicit
 * panel-authored fallback copy rather than attributing words to the model.
 */
import { useState, type CSSProperties } from 'react';
import { Pill } from './atoms';
import { ArchiveFoot } from './FlipTicket';
import { ASK_SPINE, QuickRow } from './GateBlock';
import { readCount } from './dock-face';
import { Icon, type IconId } from './icons';
import { ModelProse } from './model-prose';
import { ThoughtRow } from './ThoughtsBox';
import { edge } from './tokens';
import { ACTIVE, INSET, PLATE, PLATE_INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { JobView } from '../../agent/core/project-view';

/** What the paper's quiet stamp says the job was. */
export type AnswerStamp = 'answered' | 'asking' | 'ended';

/** Whether the terminal card for this job is the PAPER rather than the build receipt. */
export function isAnswerJob(job: JobView): boolean {
  return job.kind === 'answer' || job.kind === 'quiet';
}

/**
 * The stamp, in the order the three facts outrank each other: a job still waiting on the user is
 * ASKING whatever else it did, a job that never spoke ENDED, and everything else ANSWERED.
 */
export function answerStamp(job: JobView): AnswerStamp {
  if (job.question === true) return 'asking';
  return job.kind === 'quiet' ? 'ended' : 'answered';
}

/** Each stamp's glyph and word. `Record`, so a stamp the union grows fails `tsc` here. */
const STAMP_SPEC: Record<AnswerStamp, { icon: IconId; key: string }> = {
  answered: { icon: 'pw-reply-bubble', key: 'agent3.answer_stamp_answered' },
  asking: { icon: 'pw-question', key: 'agent3.answer_stamp_asking' },
  ended: { icon: 'pw-history', key: 'agent3.answer_stamp_ended' },
};

const PAPER: CSSProperties = {
  background: INSET,
  border: edge,
  borderRadius: 24,
  padding: 12,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  flex: '0 0 auto',
  boxShadow: 'none',
};

const STAMP: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: PLATE,
  borderRadius: 999,
  padding: '4px 11px',
  color: colors.brownText,
  ...roleFont('small'),
  fontFamily: font.family,
};

/** The order, at the subject rung. TWO LINES AND NO MORE: an order can be a paragraph, and the
 *  card's subject is what it was ABOUT rather than the whole of what was typed. */
const ORDER: CSSProperties = {
  ...roleFont('menu'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.3,
  display: '-webkit-box',
  WebkitLineClamp: 2,
  WebkitBoxOrient: 'vertical',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
};

const READS: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  ...roleFont('caption'),
  fontFamily: font.family,
  color: colors.brownText,
  fontVariantNumeric: 'tabular-nums',
};

/** The model's own words: the BODY rung, in the plate's own ink. */
const TEXT: CSSProperties = {
  ...roleFont('label'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.5,
};

/** The panel speaking for itself: one rung down, in the receding ink, so it cannot be mistaken for
 *  something the model said. */
const UIVOICE: CSSProperties = {
  ...roleFont('note'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.5,
};

const FOOT: CSSProperties = { marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center' };

export function AnswerPaper({
  job,
  quick,
  onQuick,
  onFileAway,
  past = false,
  onBack,
  onClear,
}: {
  job: JobView;
  /** The quick answers the standing question offers. See the file header: `jobEnd` carries no
   *  offer field, so the panel passes none today. */
  quick?: readonly string[];
  onQuick?(answer: string): void;
  /**
   * Put the record away: the card leaves the job zone and the row in the past-jobs list is what it
   * becomes. No verb, no control — a File it away that filed nothing would be worse than none.
   */
  onFileAway?(orderSeq: number): void;
  /**
   * This paper is a PAST record opened from the list, not the newest one settling.
   *
   * A filed answer reopens as the paper it was, and wears the same archive foot as every other
   * opened record (`FlipTicket.tsx:ArchiveFoot`): Back lit and first, Clear quiet and last behind
   * its confirm. It is the same reading whichever card the record turned out to be, so it is the
   * same foot rather than a second one worded for this file.
   */
  past?: boolean;
  onBack?(): void;
  onClear?(orderSeq: number): void;
}) {
  const t = useT();
  const stamp = answerStamp(job);
  const asking = stamp === 'asking';
  const spec = STAMP_SPEC[stamp];
  const n = readCount(job);
  const words = job.summary?.trim();
  const marks = job.thought?.marks ?? [];
  const [openThoughts, setOpenThoughts] = useState<ReadonlySet<number>>(new Set());

  return (
    <div
      data-testid="answer-paper"
      data-stamp={stamp}
      style={{
        ...PAPER,
        // The spine REPLACES the left border while the question stands, exactly as the gate card's
        // does, and retires with the question.
        ...(asking ? { borderLeft: `${ASK_SPINE}px solid ${ACTIVE}` } : {}),
      }}
    >
      <span data-testid="answer-stamp" style={STAMP}>
        <Icon id={spec.icon} size={12} />
        {t(spec.key)}
      </span>

      <div data-testid="answer-order" style={ORDER}>{job.orderText}</div>

      {n > 0 && (
        <span data-testid="answer-reads" style={READS}>
          <span style={{ display: 'inline-flex', opacity: 0.75 }}><Icon id="pw-inspect" size={12} /></span>
          {t(n === 1 ? 'agent3.answer_reads_one' : 'agent3.answer_reads', { n })}
        </span>
      )}

      {/* The model's sentence is rendered VERBATIM: it was written in the locale the job ran in, and
          a later locale switch must not half-translate a record. Verbatim in the WORDS — the markdown
          it wrote them in is rendered rather than printed, since an answer whose own paragraph breaks
          have collapsed is the one thing that would make a long one unreadable. */}
      {words !== undefined && words !== '' && (
        <ModelProse testId="answer-text" text={words} style={TEXT} />
      )}

      {stamp === 'ended' && (
        <div data-testid="answer-uivoice" style={UIVOICE}>{t('agent3.answer_silent')}</div>
      )}

      {/* WHAT IT THOUGHT ON THE WAY TO THOSE WORDS, one row per turn, each opening onto the turn's
          own text where the provider sent any. The live face's pill is the CURRENT turn's and goes
          with it, so without these the transcript the log still holds could not be reached from
          anywhere once the job settled. Under the answer, because the answer is the product and this
          is the working material. */}
      {marks.length > 0 && (
        <div data-testid="answer-thoughts" style={{ display: 'flex', flexDirection: 'column' }}>
          {marks.map((mark) => (
            <ThoughtRow
              key={mark.seq}
              mark={mark}
              open={openThoughts.has(mark.seq)}
              onToggle={() => setOpenThoughts((prev) => {
                const next = new Set(prev);
                if (!next.delete(mark.seq)) next.add(mark.seq);
                return next;
              })}
            />
          ))}
        </div>
      )}

      {asking && <QuickRow {...(quick ? { answers: quick } : {})} {...(onQuick ? { onAnswer: onQuick } : {})} />}

      {past ? (
        <ArchiveFoot
          orderSeq={job.orderSeq}
          {...(onBack ? { onBack } : {})}
          {...(onClear ? { onClear } : {})}
        />
      ) : (
        /* ANSWERING IS WHAT FILES AN ASK, or the next order is: a File it away beside a standing
           question would offer to put away a job that is still waiting on the user. */
        !asking && onFileAway && (
          <div style={FOOT}>
            <Pill variant="quiet" on="inset" data-testid="answer-file-away" onClick={() => onFileAway(job.orderSeq)}>
              {t('agent3.action_file_away')}
            </Pill>
          </div>
        )
      )}
    </div>
  );
}
