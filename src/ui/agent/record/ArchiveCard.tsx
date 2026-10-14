/* A past record opened from the list, and the archive foot every opened record shares. */
import { Pill } from '../../primitives/Pill';
import { ModelProse } from '../parts/model-prose';
import { OpsList } from './OpRow';
import { buildHistory } from '../derive/build-history';
import { ConfirmPill } from '../parts/ConfirmPill';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import { FOOT, HEAD_STAMP, HEADLINE, ON_MAP, OutcomeStamp, SPACER, StepList, stepName, TICKET } from './ticket-parts';

/** Shared archive footer with a primary Back action and in-place confirmed Clear action. */
export function ArchiveFoot({
  orderSeq,
  onBack,
  onClear,
}: {
  orderSeq: number;
  onBack?(): void;
  onClear?(orderSeq: number): void;
}) {
  const t = useT();
  if (!onBack && !onClear) return null;
  return (
    <div data-testid="archive-foot" style={FOOT}>
      {onBack && (
        <Pill variant="active" on="inset" data-testid="archive-back" onClick={onBack}>
          {t('agent.ticket_back_to_history')}
        </Pill>
      )}
      <span style={SPACER} />
      {onClear && (
        <ConfirmPill
          testId="archive-clear"
          title={t('agent.ticket_clear_record_q')}
          actLabel={t('agent.ticket_clear_record')}
          help="agent-trail"
          onConfirm={() => onClear(orderSeq)}
        >
          {t('agent.ticket_clear_record')}
        </ConfirmPill>
      )}
    </div>
  );
}

/** Opened history record with inline steps and no per-step rewind controls. */
export function ArchiveCard({
  job,
  stamp,
  rolledBack = false,
  onBack,
  onClear,
}: {
  job: JobView;
  /** When this record was made, in the caller's own words. */
  stamp?: string;
  rolledBack?: boolean;
  onBack?(): void;
  onClear?(orderSeq: number): void;
}) {
  const t = useT();
  const history = buildHistory(job);
  return (
    <div data-testid="archive-card" style={TICKET}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {job.outcome && <OutcomeStamp outcome={job.outcome} rewound={rolledBack} />}
        {stamp !== undefined && <span data-testid="archive-stamp" style={HEAD_STAMP}>{stamp}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {job.summary && <ModelProse testId="ticket-summary" text={job.summary} style={ON_MAP} />}

      {history.before.length > 0 && <OpsList ops={history.before} />}
      {job.checkpoints.length > 0 && (
        <StepList
          testId="archive-step"
          rows={job.checkpoints.map((checkpoint, i) => ({
            name: stepName(job, checkpoint, i, t),
            ...(history.steps[i]?.length ? { details: <OpsList ops={history.steps[i]!} /> } : {}),
            ...(rolledBack ? { rewound: true, stat: t('agent.ticket_step_rewound') } : {}),
          }))}
        />
      )}

      <ArchiveFoot
        orderSeq={job.orderSeq}
        {...(onBack ? { onBack } : {})}
        {...(onClear ? { onClear } : {})}
      />
    </div>
  );
}

