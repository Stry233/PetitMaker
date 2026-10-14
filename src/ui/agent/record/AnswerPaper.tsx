import { Pill } from '../../primitives/Pill';
/*
 * Terminal card for answer-only and quiet jobs, as classified by `JobView.kind`. It presents model
 * text as the primary result, summarizes read-only operations in one line and keeps reasoning below
 * the answer. A closing question reuses the gate spine and quick-answer row. Quiet jobs use explicit
 * panel-authored fallback copy rather than attributing words to the model.
 */
import type { CSSProperties } from 'react';

import { ArchiveFoot } from './ArchiveCard';
import { ASK_SPINE, QuickRow } from './GateBlock';
import { useToggleSet } from '../hooks/use-toggle-set';
import { PAPER } from '../parts/paper';
import { readCount } from '../derive/job-stats';
import { Icon, type IconId } from '../parts/sprite';
import { ModelProse } from '../parts/model-prose';
import { ThoughtRow } from './ThoughtsBox';
import { recede } from '../panel-skin';
import { ACTIVE, MUTED, PLATE, PLATE_INK } from '../../design/tokens';
import { font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import type { I18nKey } from '../../../i18n/keys';

export { isAnswerJob } from '../derive/terminal';

/** What the paper's quiet stamp says the job was. */
type AnswerStamp = 'answered' | 'asking' | 'ended';


/**
 * The stamp, in the order the three facts outrank each other: a job still waiting on the user is
 * Asking whatever else it did, a job that never spoke ended, and everything else answered.
 */
function answerStamp(job: JobView): AnswerStamp {
  if (job.question === true) return 'asking';
  return job.kind === 'quiet' ? 'ended' : 'answered';
}

/** Each stamp's glyph and word. `Record`, so a stamp the union grows fails `tsc` here. */
const STAMP_SPEC: Record<AnswerStamp, { icon: IconId; key: I18nKey }> = {
  answered: { icon: 'pw-reply-bubble', key: 'agent.answer_stamp_answered' },
  asking: { icon: 'pw-question', key: 'agent.answer_stamp_asking' },
  ended: { icon: 'pw-history', key: 'agent.answer_stamp_ended' },
};


const STAMP: CSSProperties = {
  alignSelf: 'flex-start',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: PLATE,
  borderRadius: radii.pill,
  padding: '4px 10px',
  color: MUTED,
  ...roleFont('small'),
  fontFamily: font.family,
};

/** The order, at the subject rung. Two lines and no more: an order can be a paragraph, and the
 *  card's subject is what it was about rather than the whole of what was typed. */
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
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
};

/** The model's own words: the body rung, in the plate's own ink. */
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
  color: MUTED,
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
  /** A past record opened from the list; it wears the archive foot every opened record shares. */
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
  const openThoughts = useToggleSet<number>();

  return (
    <div
      data-testid="answer-paper"
      data-stamp={stamp}
      style={{
        ...PAPER,
        // The spine replaces the left border while the question stands, exactly as the gate card's
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
          <span style={{ display: 'inline-flex', opacity: recede.aside }}><Icon id="pw-inspect" size={12} /></span>
          {t('agent.answer_reads', { n })}
        </span>
      )}

      {/* The model's sentence is rendered verbatim: it was written in the locale the job ran in, and
          a later locale switch must not half-translate a record. Verbatim in the words — the markdown
          it wrote them in is rendered rather than printed, since an answer whose own paragraph breaks
          have collapsed is the one thing that would make a long one unreadable. */}
      {words !== undefined && words !== '' && (
        <ModelProse testId="answer-text" text={words} style={TEXT} />
      )}

      {stamp === 'ended' && (
        <div data-testid="answer-uivoice" style={UIVOICE}>{t('agent.answer_silent')}</div>
      )}

      {/* What it thought on the way to those words, one row per turn, each opening onto the turn's
          own text where the provider sent any. The live face's pill is the current turn's and goes
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
              onToggle={() => openThoughts.toggle(mark.seq)}
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
        onFileAway && (
          <div style={FOOT}>
            <Pill variant="quiet" on="inset" data-testid="answer-file-away" onClick={() => onFileAway(job.orderSeq)}>
              {t('agent.action_file_away')}
            </Pill>
          </div>
        )
      )}
    </div>
  );
}
