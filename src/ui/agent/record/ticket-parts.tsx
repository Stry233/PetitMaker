/* The paper, stamps, step lists and figures every settled card is drawn from. */
import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { animate, useReducedMotionConfig } from 'framer-motion';
import { Icon, type IconId } from '../parts/sprite';
import { PAPER } from '../parts/paper';
import { recede, statePaper } from '../panel-skin';
import { font, radii } from '../../design/styles';
import { framerMotion } from '../../design/motion';
import { fmtClock } from '../derive/clock';
import { INK, MUTED, PLATE, PLATE_INK, REVERT_AMBER, rgbaOf } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { JobOutcome, JobView } from '../../../agent/panel';
import type { Translate, I18nKey } from '../../../i18n/keys';

/** Recorded job checkpoint shared by settled and live rewind controls. */
export type Checkpoint = JobView['checkpoints'][number];

interface StampSpec { paper: string; icon: IconId; key: I18nKey }

/** Exhaustive visual stamp for each terminal job outcome. */
const OUTCOME_STAMP: Record<JobOutcome, StampSpec> = {
  done: { paper: statePaper.work, icon: 'pw-check', key: 'agent.ticket_stamp_done' },
  capped: { paper: statePaper.ask, icon: 'pw-flag', key: 'agent.ticket_stamp_capped' },
  aborted: { paper: statePaper.stop, icon: 'pw-stop', key: 'agent.ticket_stamp_aborted' },
  incident: { paper: statePaper.danger, icon: 'pw-warning', key: 'agent.ticket_stamp_incident' },
};

/** Rewound records replace their terminal stamp and omit claims about edits remaining on the map. */
const REWOUND_STAMP: StampSpec = {
  paper: statePaper.wait, icon: 'pw-undo-arrow', key: 'agent.ticket_stamp_rewound',
};

/** Localized checkpoint labels with a generic write fallback for unknown log values. */
const STEP_KEY: Record<string, I18nKey> = {
  job: 'agent.ticket_step_job',
  stage: 'agent.ticket_step_stage',
  write: 'agent.ticket_step_write',
};
const STEP_KEY_FALLBACK = 'agent.ticket_step_write';

function stepKey(label: string): I18nKey {
  return STEP_KEY[label] ?? STEP_KEY_FALLBACK;
}

/** Non-zero cell and object totals reported by the job's tool results. */
export function statsOf(job: JobView): { key: I18nKey; n: number }[] {
  let cells = 0;
  let objects = 0;
  for (const op of job.ops) {
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
  }
  const stats: { key: I18nKey; n: number }[] = [
    { key: 'agent.ticket_stat_cells', n: cells },
    { key: 'agent.ticket_stat_objects', n: objects },
  ];
  return stats.filter((c) => c.n > 0);
}

/** Returns a stage's dominant non-zero result measure: cells, objects, then read operations. */
export function stageFigure(job: JobView, index: number, t: Translate): string | undefined {
  let cells = 0;
  let objects = 0;
  let reads = 0;
  for (const op of job.ops) {
    if (op.stageIndex !== index) continue;
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
    if (op.isRead) reads += 1;
  }
  if (cells > 0 && cells >= objects) return t('units.cells', { n: cells });
  if (objects > 0) return t('units.objects', { n: objects });
  // Reuse the status card's read-count copy.
  if (reads > 0) return t('agent.dock_reads', { n: reads });
  return undefined;
}

/* ── the shared paper ─────────────────────────────────────── */


/**
 * Absolute flip face. Backface visibility requires an unflattened 3D context, so opacity and other
 * grouping properties belong on each face rather than the perspective ancestor.
 */
export const FACE: CSSProperties = {
  ...PAPER,
  flex: undefined,
  overflow: 'hidden',
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/** The one-face cards (`.aticket`): the same paper standing in the flow. */
export const TICKET: CSSProperties = { ...PAPER, overflow: 'hidden' };

/** Wrapping action row for localized labels and inline confirmations. */
export const FOOT: CSSProperties = {
  marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
};

/** Keeps the quiet action at the far edge while confirmations expand in place. */
export const SPACER: CSSProperties = { flex: 1 };

/** Primary order or kept-edits line. */
export const HEADLINE: CSSProperties = {
  ...roleFont('action'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

/** The model's closing words (`.tsum`): one rung down, receding. */
export const SUMMARY: CSSProperties = {
  ...roleFont('note'),
  fontFamily: font.family,
  color: MUTED,
  lineHeight: 1.4,
};

/** Prominent summary used when the line is the compact card's main content. */
export const ON_MAP: CSSProperties = { ...SUMMARY, color: PLATE_INK };

/** Formats aggregate thinking time, adding the turn count only when it exceeds one. */
export function thoughtLine(job: JobView, t: Translate): string | null {
  const thought = job.thought;
  if (!thought || thought.ms <= 0) return null;
  const clock = fmtClock(thought.ms / 1000);
  if (clock === null) return null;
  return t('agent.thoughts_total', { t: clock, n: Math.max(1, thought.turns) });
}

/** Quiet aggregate thinking metadata; no reasoning transcript is rendered. */
export const THOUGHT_TOTAL: CSSProperties = {
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
};

/** The provenance stamp in the card's header seat. */
export const HEAD_STAMP: CSSProperties = {
  marginLeft: 'auto',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
  fontVariantNumeric: 'tabular-nums',
};

/** Minimum heights for full and compact cards with absolute faces. */
export const CARD_FLOOR = 290;
export const COMPACT_FLOOR = 118;

/* ── the pieces ───────────────────────────────────────────── */

export function OutcomeStamp({ outcome, rewound = false }: { outcome: JobOutcome; rewound?: boolean }) {
  const t = useT();
  const stamp = rewound ? REWOUND_STAMP : OUTCOME_STAMP[outcome];
  return (
    <span
      data-testid="ticket-stamp"
      data-rewound={rewound}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: radii.pill,
        padding: '4px 12px',
        background: stamp.paper,
        color: INK,
        ...roleFont('small'),
        fontFamily: font.family,
      }}
    >
      <Icon id={stamp.icon} size={13} />
      {t(stamp.key)}
    </span>
  );
}

/** Counts from zero on mount, or renders the final value immediately under reduced motion. */
export function CountUp({ value }: { value: number }) {
  const reduced = useReducedMotionConfig() === true;
  const [shown, setShown] = useState(() => (reduced ? value : 0));

  useEffect(() => {
    if (reduced) {
      setShown(value);
      return undefined;
    }
    const run = animate(0, value, {
      ...framerMotion('panel.stat.count'),
      onUpdate: (v) => setShown(Math.round(v)),
    });
    return () => { run.stop(); };
  }, [reduced, value]);

  return <>{shown}</>;
}

/** The done receipt's hero row of figures (`.statrow`). */
export function StatRow({ job }: { job: JobView }) {
  const t = useT();
  const stats = statsOf(job);
  if (stats.length === 0) return null;
  return (
    <div data-testid="ticket-stats" style={{ display: 'flex', gap: 8, flex: '0 0 auto' }}>
      {stats.map((stat) => (
        <span
          key={stat.key}
          data-testid="ticket-stat"
          style={{
            flex: 1,
            minWidth: 0,
            background: PLATE,
            borderRadius: radii.md,
            padding: '6px 10px 8px',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          <b
            data-testid="ticket-stat-n"
            style={{
              ...roleFont('lead'),
              fontFamily: font.family,
              color: INK,
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1.2,
            }}
          >
            <CountUp value={stat.n} />
          </b>
          <span
            data-testid="ticket-stat-label"
            style={{ ...roleFont('caption'), fontFamily: font.family, color: MUTED, lineHeight: 1.15 }}
          >
            {t(stat.key)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** One row of a step list, in whichever of the three lists is drawing it. */
export interface StepRow {
  name: string;
  details?: ReactNode;
  /** The figure at the row's far end, where the row has one to state. */
  stat?: string;
  /** Stage the run did not reach. */
  unreached?: boolean;
  /** Whether this step's work is absent from the map. */
  rewound?: boolean;
  /** Whether a pending rewind would discard this row. */
  preview?: boolean;
  /** The control (or mark) at the row's end. */
  trailing?: ReactNode;
}

const STEP_NO: CSSProperties = {
  width: 20,
  height: 20,
  borderRadius: radii.pill,
  flex: '0 0 auto',
  background: PLATE,
  color: INK,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  ...roleFont('small'),
  fontFamily: font.family,
  fontVariantNumeric: 'tabular-nums',
};

/** Dashed edge for an unreached stage. */
const UNREACHED_EDGE = `1px dashed ${rgbaOf(REVERT_AMBER, 0.55)}`;

export function StepList({ rows, testId }: { rows: readonly StepRow[]; testId: string }) {
  return (
    <div data-testid={`${testId}-list`} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      {rows.map((row, i) => (
        <div
          key={`${row.name}-${i}`}
          data-testid={testId}
          data-rewound={row.rewound === true}
          data-unreached={row.unreached === true}
          data-preview={row.preview === true}
          style={{
            borderRadius: radii.md,
            padding: '4px 8px',
            ...(row.unreached === true ? { border: UNREACHED_EDGE } : {}),
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span
            data-testid={`${testId}-no`}
            style={{ ...STEP_NO, opacity: row.preview ? recede.apart : 1, ...(row.unreached === true ? { color: REVERT_AMBER } : {}) }}
          >
            {i + 1}
          </span>
          <span
            data-testid={`${testId}-name`}
            style={{
              ...roleFont('label'),
              fontFamily: font.family,
              color: row.unreached === true ? REVERT_AMBER : PLATE_INK,
              opacity: row.preview ? recede.apart : 1,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          {row.stat !== undefined && (
            <span
              data-testid={`${testId}-stat`}
              style={{
                marginLeft: 'auto',
                flex: '0 0 auto',
                ...roleFont('small'),
                fontFamily: font.family,
                color: row.unreached === true ? REVERT_AMBER : MUTED,
              }}
            >
              {row.stat}
            </span>
          )}
          {row.trailing}
          </div>
          {row.details && <div style={{ marginTop: 4, paddingLeft: 20 }}>{row.details}</div>}
        </div>
      ))}
    </div>
  );
}

/** Returns a non-blank plan-stage label or a localized checkpoint fallback. */
export function stepName(
  job: JobView,
  checkpoint: Checkpoint,
  i: number,
  t: Translate,
): string {
  const staged = checkpoint.stageIndex !== undefined
    ? job.plan?.stages[checkpoint.stageIndex]?.label?.trim()
    : undefined;
  if (staged !== undefined && staged !== '') return staged;
  return t(stepKey(checkpoint.label), { n: (checkpoint.stageIndex ?? i) + 1 });
}

