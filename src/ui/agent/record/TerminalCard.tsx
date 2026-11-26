import type { ReactNode } from 'react';
import { isAnswerJob, type JobView, type PanelView, type TakeBackFacts, type TerminalShape } from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import { AnswerPaper } from './AnswerPaper';
import { ArchiveCard } from './ArchiveCard';
import { FlipTicket } from './FlipTicket';
import { IncidentCard } from './IncidentCard';
import { StopCard } from './StopCard';
import { jobStamps } from './JobTicket';
import { clockOf } from '../derive/clock';

/** The verbs a settled card may offer; a card offers only those its caller wires. */
export interface TerminalVerbs {
  onFileAway?(orderSeq: number): void;
  onRewind?(job: JobView, checkpointIndex: number): void;
  onRewindAll?(job: JobView): void;
  onKeepGoing?(job: JobView): void;
}

/**
 * The newest settled record as the card its outcome earns: the answer paper, the stop card, the
 * stalled card (whose repairs are the adjacent banner's) or the receipt.
 */
export function TerminalCard({ view, settled, rolledBack, takeBack, recordShot, recordStamp, verbs }: {
  view: PanelView;
  settled: { job: JobView; shape: TerminalShape };
  rolledBack: boolean;
  /** The live facts the card's take-backs are read against. */
  takeBack: TakeBackFacts;
  recordShot?(job: JobView): ReactNode;
  recordStamp?(job: JobView): string;
  verbs: TerminalVerbs;
}) {
  const t = useT();
  const { job, shape } = settled;
  const fileAway = verbs.onFileAway ? { onFileAway: verbs.onFileAway } : {};
  const rewindAll = verbs.onRewindAll ? { onRewindAll: () => verbs.onRewindAll!(job) } : {};
  // Keyed by the record so card-local confirmation state never crosses to the next job.
  switch (shape) {
    case 'paper':
      return <AnswerPaper key={job.orderSeq} job={job} {...fileAway} />;
    case 'stop': {
      const clock = clockOf(view, job);
      return (
        <StopCard
          key={job.orderSeq}
          job={job}
          rolledBack={rolledBack}
          takeBack={takeBack}
          // A job settled mid-question keeps the unanswered ask.
          unanswered={job.asks.some((ask) => ask.verdict === 'unanswered')}
          {...(clock !== null ? { clock } : {})}
          {...rewindAll}
          {...fileAway}
        />
      );
    }
    case 'stalled':
      return <IncidentCard key={job.orderSeq} job={job} stamps={jobStamps(job, t)} />;
    case 'receipt':
      return (
        <FlipTicket
          key={job.orderSeq}
          job={job}
          compact={job.question === true}
          rolledBack={rolledBack}
          takeBack={takeBack}
          {...(recordShot && job.question !== true ? { postcard: recordShot(job) } : {})}
          {...(recordStamp ? { archiveStamp: recordStamp(job) } : {})}
          {...(verbs.onRewind ? { onRewind: verbs.onRewind } : {})}
          {...rewindAll}
          {...(verbs.onKeepGoing ? { onKeepGoing: () => verbs.onKeepGoing!(job) } : {})}
          {...fileAway}
        />
      );
  }
}

/** A past record opened from the list, as the paper or the archive card it was. */
export function OpenedRecord({ job, rolledBack, stamp, onBack, onClear }: {
  job: JobView;
  rolledBack: boolean;
  stamp?: string;
  onBack(): void;
  onClear?(orderSeq: number): void;
}) {
  const clear = onClear ? { onClear } : {};
  return isAnswerJob(job)
    ? <AnswerPaper job={job} past onBack={onBack} {...clear} />
    : <ArchiveCard job={job} rolledBack={rolledBack} {...(stamp !== undefined ? { stamp } : {})} onBack={onBack} {...clear} />;
}
