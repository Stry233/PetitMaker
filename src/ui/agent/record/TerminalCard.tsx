import type { ReactNode } from 'react';
import type { JobView, PanelView } from '../../../agent/panel';
import { useT } from '../../../i18n/context';
import { AnswerPaper } from './AnswerPaper';
import { ArchiveCard } from './ArchiveCard';
import { FlipTicket } from './FlipTicket';
import { IncidentCard } from './IncidentCard';
import { StopCard } from './StopCard';
import type { Checkpoint } from './ticket-parts';
import { jobStamps } from './JobTicket';
import { clockOf, isAnswerJob, type TerminalShape } from '../derive/terminal';

/** The verbs a settled card may offer; a card offers only those its caller wires. */
export interface TerminalVerbs {
  onFileAway?(orderSeq: number): void;
  onRewind?(checkpoint: Checkpoint): void;
  onRewindAll?(job: JobView): void;
  onKeepGoing?(job: JobView): void;
}

/**
 * The newest settled record as the card its outcome earns: the answer paper, the stop card, the
 * stalled card (whose repairs are the adjacent banner's) or the receipt. A record that cannot be
 * proven to belong to this map offers no rewind.
 */
export function TerminalCard({ view, settled, rewindable, rolledBack, undoDepth, recordShot, recordStamp, verbs }: {
  view: PanelView;
  settled: { job: JobView; shape: TerminalShape };
  /** Whether the record may rewind the open map. */
  rewindable: boolean;
  rolledBack: boolean;
  undoDepth?: number;
  recordShot?(job: JobView): ReactNode;
  recordStamp?(job: JobView): string;
  verbs: TerminalVerbs;
}) {
  const t = useT();
  const { job, shape } = settled;
  const depth = undoDepth !== undefined ? { undoDepth } : {};
  const fileAway = verbs.onFileAway ? { onFileAway: verbs.onFileAway } : {};
  const rewindAll = verbs.onRewindAll && rewindable ? { onRewindAll: () => verbs.onRewindAll!(job) } : {};
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
          {...depth}
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
          {...depth}
          {...(recordShot && job.question !== true ? { postcard: recordShot(job) } : {})}
          {...(recordStamp ? { archiveStamp: recordStamp(job) } : {})}
          {...(verbs.onRewind && rewindable ? { onRewind: verbs.onRewind } : {})}
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
