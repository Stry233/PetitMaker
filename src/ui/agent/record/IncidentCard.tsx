/* The stalled job's card; its repairs are the incident banner's. */
import { CountPill, Stamp as StampLine, TapeBar } from '../parts/panel-parts';
import type { IconId } from '../parts/sprite';
import type { JobView } from '../../../agent/panel';
import { HEADLINE, TICKET } from './ticket-parts';

/* ── the archive card: a past record, opened ──────────────── */

/** Incident detail card showing the affected order, halted plan progress, operation count and stamps. */
export function IncidentCard({ job, stamps }: {
  job: JobView;
  /** Caller-resolved icon and translated text for each side stamp. */
  stamps?: readonly { key: string; icon: IconId; text: string }[];
}) {
  const total = job.plan ? job.plan.stages.length : 0;
  return (
    <div data-testid="incident-card" style={TICKET}>
      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>
      <TapeBar mode={total > 0 ? { fraction: job.plan!.doneCount / total } : 'indeterminate'} held />
      {job.ops.length > 0 && <CountPill total={job.ops.length} shown={0} />}
      {(stamps ?? []).map((s) => (
        <StampLine key={s.key} icon={s.icon}>{s.text}</StampLine>
      ))}
    </div>
  );
}

