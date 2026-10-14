/* The one-face card of a stopped job: what it kept, and the take-back or filing. */
import { Pill } from '../../primitives/Pill';
import { editCount } from '../derive/job-stats';
import { Icon } from '../parts/sprite';
import { rewindConfirmCopy, rollbackCost } from '../derive/rollback';
import { ConfirmPill } from '../parts/ConfirmPill';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import { FOOT, HEAD_STAMP, HEADLINE, OutcomeStamp, SPACER, SUMMARY, TICKET } from './ticket-parts';

/* ── the stop card: one face, two answers ─────────────────── */

/** One-face card for a stopped job, retained edits and rollback or filing actions. */
export function StopCard({
  job,
  clock,
  rolledBack = false,
  undoDepth,
  unanswered = false,
  onRewindAll,
  onFileAway,
}: {
  job: JobView;
  /** Elapsed job time using the status card's clock format. */
  clock?: string;
  /** Whether the stop lapsed an unanswered question. */
  unanswered?: boolean;
  /** The job's edits are already off the map, so there is nothing left to take back. */
  rolledBack?: boolean;
  /** Live undo depth used to calculate rollback confirmation copy. */
  undoDepth?: number;
  onRewindAll?: () => void;
  onFileAway?: (orderSeq: number) => void;
}) {
  const t = useT();
  const edits = editCount(job);
  const canRewind = Boolean(onRewindAll) && !rolledBack && job.checkpoints.length > 0;
  const copy = rewindConfirmCopy(t, job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null);

  return (
    <div data-testid="stop-card" style={TICKET}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <OutcomeStamp outcome="aborted" rewound={rolledBack} />
        {clock !== undefined && <span data-testid="stop-clock" style={HEAD_STAMP}>{clock}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {/* State retained edits only while a non-zero count remains on the map. */}
      {!rolledBack && edits > 0 && (
        <div data-testid="stop-fact" style={HEADLINE}>
          {t('agent.ticket_edits_kept', { n: edits })}
        </div>
      )}

      {rolledBack && (
        <div data-testid="stop-fact" style={HEADLINE}>{t('agent.ticket_rewound_sum')}</div>
      )}

      {unanswered && (
        <div data-testid="stop-lapsed" style={SUMMARY}>{t('agent.ticket_question_lapsed')}</div>
      )}

      {canRewind && <div data-testid="stop-note" style={SUMMARY}>{t('agent.ticket_ctrlz_note')}</div>}

      <div style={FOOT}>
        {canRewind && onRewindAll && (
          <ConfirmPill
            testId="stop-rewind"
            title={copy.confirmLabel}
            {...(copy.question !== copy.confirmLabel ? { message: copy.question } : {})}
            actLabel={t('agent.ticket_rewind_all')}
            help="agent-undo"
            onConfirm={onRewindAll}
          >
            <Icon id="pw-undo-arrow" size={13} />
            {t('agent.ticket_rewind_all')}
          </ConfirmPill>
        )}
        <span style={SPACER} />
        {onFileAway && (
          <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
            {t('agent.action_file_away')}
          </Pill>
        )}
      </div>
    </div>
  );
}

