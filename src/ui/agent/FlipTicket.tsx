/*
 * Terminal-card family for completed, capped, stopped, question-ending and archived jobs. All faces
 * share paper, stamps and action vocabulary while changing hierarchy for each outcome. Live rewind
 * actions stay on the receipt's back; archived jobs use whole-job rollback from the history row.
 *
 * Both flip faces remain mounted and hide their reverse side. Reduced motion disables rotation, and
 * the inactive face remains `aria-hidden`. Figures and stages derive from recorded operations and
 * checkpoints; zero figures and unavailable slots are omitted. Rolled-back records expose no rewind.
 * A settled progress band appears only for jobs that had a plan and retains their completed fraction.
 */
import {
  useEffect, useLayoutEffect, useRef, useState,
  type CSSProperties, type ReactNode, type RefObject,
} from 'react';
import { animate, useReducedMotionConfig } from 'framer-motion';
import { CountPill, Pill, Stamp as StampLine, TapeBar } from './atoms';
import { editCount } from './job-stats';
import { AskPrimary } from './GateBlock';
import { Icon, type IconId } from './icons';
import { ModelProse } from './model-prose';
import { CARD_PAD, edge, POSTCARD, statePaper } from './tokens';
import { withAlpha } from '../design/styles';
import { CONFIRM_ARM, cssMotion, framerMotion } from './motion';
import { rewindConfirmCopy, rollbackCost, rollbackReaches } from './rollback';
import { fmtClock } from './dock-face';
import { InlineConfirm, HUSHED } from '../primitives/InlineConfirm';
import { INK, INSET, PLATE, PLATE_INK } from '../design/tokens';
import { colors, cursors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { windowPill } from '../design/window-skin';
import { useT } from '../../i18n/context';
import type { T } from './setup-parts';
import type { JobOutcome } from '../../agent/core/types';
import type { JobView } from '../../agent/core/project-view';

/** Recorded job checkpoint shared by settled and live rewind controls. */
export type Checkpoint = JobView['checkpoints'][number];

interface StampSpec { paper: string; icon: IconId; key: string }

/** Exhaustive visual stamp for each terminal job outcome. */
const OUTCOME_STAMP: Record<JobOutcome, StampSpec> = {
  done: { paper: statePaper.work, icon: 'pw-check', key: 'agent3.ticket_stamp_done' },
  capped: { paper: statePaper.ask, icon: 'pw-flag', key: 'agent3.ticket_stamp_capped' },
  aborted: { paper: statePaper.stop, icon: 'pw-stop', key: 'agent3.ticket_stamp_aborted' },
  incident: { paper: statePaper.danger, icon: 'pw-warning', key: 'agent3.ticket_stamp_incident' },
};

/** Rewound records replace their terminal stamp and omit claims about edits remaining on the map. */
const REWOUND_STAMP: StampSpec = {
  paper: statePaper.wait, icon: 'pw-undo-arrow', key: 'agent3.ticket_stamp_rewound',
};

/** Localized checkpoint labels with a generic write fallback for unknown log values. */
const STEP_KEY: Record<string, string> = {
  job: 'agent3.ticket_step_job',
  stage: 'agent3.ticket_step_stage',
  write: 'agent3.ticket_step_write',
};
const STEP_KEY_FALLBACK = 'agent3.ticket_step_write';

function stepKey(label: string): string {
  return STEP_KEY[label] ?? STEP_KEY_FALLBACK;
}

/** Non-zero cell and object totals reported by the job's tool results. */
function statsOf(job: JobView): { key: string; n: number }[] {
  let cells = 0;
  let objects = 0;
  for (const op of job.ops) {
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
  }
  return [
    { key: 'agent3.ticket_stat_cells', n: cells },
    { key: 'agent3.ticket_stat_objects', n: objects },
  ].filter((c) => c.n > 0);
}

/** Returns a stage's dominant non-zero result measure: cells, objects, then read operations. */
function stageFigure(job: JobView, index: number, t: T): string | undefined {
  let cells = 0;
  let objects = 0;
  let reads = 0;
  for (const op of job.ops) {
    if (op.stageIndex !== index) continue;
    cells += op.detail?.cells ?? 0;
    objects += op.detail?.objects ?? 0;
    if (op.isRead) reads += 1;
  }
  if (cells > 0 && cells >= objects) return t(cells === 1 ? 'agent3.ticket_stage_cells_one' : 'agent3.ticket_stage_cells', { n: cells });
  if (objects > 0) return t(objects === 1 ? 'agent3.ticket_stage_objects_one' : 'agent3.ticket_stage_objects', { n: objects });
  // Reuse the dock's read-count copy.
  if (reads > 0) return t(reads === 1 ? 'agent3.dock_reads_one' : 'agent3.dock_reads', { n: reads });
  return undefined;
}

/* ── the shared paper ─────────────────────────────────────── */

/** The card body every member of the family wears: one inset paper, one radius, one gutter. */
const PAPER: CSSProperties = {
  background: INSET,
  border: edge,
  borderRadius: 24,
  padding: CARD_PAD,
  display: 'flex',
  flexDirection: 'column',
  gap: 9,
  overflow: 'hidden',
  boxShadow: 'none',
};

/**
 * Absolute flip face. Backface visibility requires an unflattened 3D context, so opacity and other
 * grouping properties belong on each face rather than the perspective ancestor.
 */
const FACE: CSSProperties = {
  ...PAPER,
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
};

/** The one-face cards (`.aticket`): the same paper standing in the flow. */
const TICKET: CSSProperties = { ...PAPER, flex: '0 0 auto' };

/** Wrapping action row for localized labels and inline confirmations. */
const FOOT: CSSProperties = {
  marginTop: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
};

/** Keeps the quiet action at the far edge while confirmations expand in place. */
const SPACER: CSSProperties = { flex: 1 };

/** Primary order or kept-edits line. */
const HEADLINE: CSSProperties = {
  ...roleFont('action'),
  fontFamily: font.family,
  color: PLATE_INK,
  lineHeight: 1.3,
  overflowWrap: 'anywhere',
};

/** The model's closing words (`.tsum`): one rung down, receding. */
const SUMMARY: CSSProperties = {
  ...roleFont('note'),
  fontFamily: font.family,
  color: colors.brownText,
  lineHeight: 1.4,
};

/** Prominent summary used when the line is the compact card's main content. */
const ON_MAP: CSSProperties = { ...SUMMARY, color: PLATE_INK };

/** Formats aggregate thinking time, adding the turn count only when it exceeds one. */
function thoughtLine(job: JobView, t: T): string | null {
  const thought = job.thought;
  if (!thought || thought.ms <= 0) return null;
  const clock = fmtClock(thought.ms / 1000);
  if (clock === null) return null;
  return thought.turns > 1
    ? t('agent3.thoughts_total', { t: clock, n: thought.turns })
    : t('agent3.thoughts_total_one', { t: clock });
}

/** Quiet aggregate thinking metadata; no reasoning transcript is rendered. */
const THOUGHT_TOTAL: CSSProperties = {
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  fontVariantNumeric: 'tabular-nums',
};

/** The provenance stamp in the seat where a done receipt wears its score (`.hstamp`). */
const HEAD_STAMP: CSSProperties = {
  marginLeft: 'auto',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  fontVariantNumeric: 'tabular-nums',
};

/** Minimum heights for full and compact cards with absolute faces. */
const CARD_FLOOR = 290;
const COMPACT_FLOOR = 118;

/** Measures both absolute faces before paint and settles the taller height in at most three passes. */
const SIZE_PASSES = 3;

function useFaceHeight(
  inner: RefObject<HTMLDivElement | null>,
  floor: number,
  key: unknown,
): void {
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return undefined;
    const measure = () => {
      for (let pass = 0; pass < SIZE_PASSES; pass++) {
        let wanted = floor;
        for (const face of el.querySelectorAll<HTMLElement>('[data-face-body]')) {
          wanted = Math.max(wanted, face.scrollHeight);
        }
        if (el.style.height === `${wanted}px`) break;
        el.style.height = `${wanted}px`;
      }
    };
    measure();
    // Observe rewraps caused by chrome zoom, locale or font changes.
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    for (const face of el.querySelectorAll<HTMLElement>('[data-face-body]')) ro.observe(face);
    return () => { ro.disconnect(); };
  }, [inner, floor, key]);
}

/* ── the pieces ───────────────────────────────────────────── */

function Stamp({ outcome, rewound = false }: { outcome: JobOutcome; rewound?: boolean }) {
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
        borderRadius: 999,
        padding: '5px 12px',
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
function CountUp({ value }: { value: number }) {
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
function StatRow({ job }: { job: JobView }) {
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
            borderRadius: 12,
            padding: '7px 10px 8px',
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
            style={{ ...roleFont('caption'), fontFamily: font.family, color: colors.brownText, lineHeight: 1.15 }}
          >
            {t(stat.key)}
          </span>
        </span>
      ))}
    </div>
  );
}

/** One row of a step list, in whichever of the three lists is drawing it. */
interface StepRow {
  name: string;
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
  borderRadius: 999,
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
const UNREACHED_EDGE = `1px dashed ${withAlpha(colors.revertAmber, 0.55)}`;

function StepList({ rows, testId }: { rows: readonly StepRow[]; testId: string }) {
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
            display: 'flex',
            alignItems: 'center',
            gap: 9,
            borderRadius: 12,
            padding: '5px 8px',
            opacity: row.rewound === true || row.preview === true ? 0.55 : 1,
            ...(row.unreached === true ? { border: UNREACHED_EDGE } : {}),
          }}
        >
          <span
            data-testid={`${testId}-no`}
            style={{ ...STEP_NO, ...(row.unreached === true ? { color: colors.revertAmber } : {}) }}
          >
            {i + 1}
          </span>
          <span
            data-testid={`${testId}-name`}
            style={{
              ...roleFont('label'),
              fontFamily: font.family,
              color: row.unreached === true ? colors.revertAmber : PLATE_INK,
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
                color: row.unreached === true ? colors.revertAmber : colors.brownText,
              }}
            >
              {row.stat}
            </span>
          )}
          {row.trailing}
        </div>
      ))}
    </div>
  );
}

/** Action square for a step-level take-back. */
const STEP_ACTION: CSSProperties = {
  marginLeft: 'auto',
  width: 26,
  height: 26,
  borderRadius: 9,
  flex: '0 0 auto',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: PLATE,
  color: INK,
  border: 'none',
  cursor: cursors.clickable,
  boxShadow: 'none',
};

/** Expanded danger treatment for a step action asking for confirmation. */
const STEP_ASKING: CSSProperties = {
  width: 'auto',
  padding: '0 9px',
  gap: 5,
  background: colors.dangerBg,
  color: colors.dangerText,
  ...roleFont('small'),
  fontFamily: font.family,
  whiteSpace: 'nowrap',
};

/** Returns a non-blank plan-stage label or a localized checkpoint fallback. */
function stepName(
  job: JobView,
  checkpoint: Checkpoint,
  i: number,
  t: (k: string, p?: Record<string, string | number>) => string,
): string {
  const staged = checkpoint.stageIndex !== undefined
    ? job.plan?.stages[checkpoint.stageIndex]?.label?.trim()
    : undefined;
  if (staged !== undefined && staged !== '') return staged;
  return t(stepKey(checkpoint.label), { n: (checkpoint.stageIndex ?? i) + 1 });
}

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
  const [asking, setAsking] = useState(false);
  if (!onBack && !onClear) return null;
  return (
    <div data-testid="archive-foot" style={FOOT}>
      {onBack && (
        <span style={asking ? HUSHED : undefined}>
          <Pill variant="active" on="inset" data-testid="archive-back" onClick={onBack}>
            {t('agent3.ticket_back_to_history')}
          </Pill>
        </span>
      )}
      <span style={SPACER} />
      {onClear && (
        <InlineConfirm
          question={t('agent3.ticket_clear_record_q')}
          arm={CONFIRM_ARM}
          open={asking}
          onOpenChange={setAsking}
          onConfirm={() => onClear(orderSeq)}
          onCancel={() => setAsking(false)}
        >
          {(armed) => (
            <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="archive-clear">
              {t(armed ? 'agent3.ticket_clear_record_q' : 'agent3.ticket_clear_record')}
            </Pill>
          )}
        </InlineConfirm>
      )}
    </div>
  );
}

/* ── the flip family: done, done at the cap, the compact settle ── */

export function FlipTicket({
  job,
  score,
  thumb,
  postcard,
  compact = false,
  archiveStamp,
  rolledBack = false,
  undoDepth,
  onRewind,
  onRewindAll,
  onFileAway,
  onKeepGoing,
}: {
  job: JobView;
  /** The evaluator's reading, where the shell has one. */
  score?: number;
  /** A small rendered map thumbnail, where the shell has one. */
  thumb?: ReactNode;
  /** Full-width capture of the completed work. */
  postcard?: ReactNode;
  /** The two-line settle a standing question compresses the receipt to. */
  compact?: boolean;
  /** What the header seat says on a compact settle: the record's own provenance. */
  archiveStamp?: string;
  /** Whether the job's edits are absent from the map. */
  rolledBack?: boolean;
  /** Live undo depth used to calculate rewind cost; absence produces unnumbered confirmation copy. */
  undoDepth?: number;
  /** Rewinds to the selected checkpoint watermark. */
  onRewind?: (checkpoint: Checkpoint) => void;
  /** Rewinds the whole job after confirmation. */
  onRewindAll?: () => void;
  /** Files the record into history. */
  onFileAway?: (orderSeq: number) => void;
  /** Resubmits a capped job for continuation. */
  onKeepGoing?: () => void;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const [flipped, setFlipped] = useState(false);
  const [askingAll, setAskingAll] = useState(false);
  /** Prevents a second continuation press before the first job event arrives. */
  const [sent, setSent] = useState(false);
  /** Checkpoint index awaiting confirmation, used to preview every discarded later row. */
  const [askingStep, setAskingStep] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const capped = job.outcome === 'capped';
  const stats = statsOf(job);
  const thoughtTotal = thoughtLine(job, t);
  const canRewind = Boolean(onRewind) && !rolledBack;
  /** Whole-job rewind cost for confirmation copy. */
  const wholeCost = job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null;
  const wholeCopy = rewindConfirmCopy(t, wholeCost);
  /** Read-only jobs with no checkpoint retain a single face. */
  const hasBack = job.checkpoints.length > 0;
  /** Capped ledger reports plan stages rather than low-level checkpoints. */
  const ledger = capped ? job.plan?.stages ?? [] : [];
  /** A plan ledger leads capped cards; otherwise completed work remains primary. */
  const leadsWithStages = ledger.length > 0;
  /** Completed plan fraction for capped jobs only. */
  const planFraction = capped && job.plan && job.plan.stages.length > 0
    ? Math.max(0, Math.min(1, job.plan.doneCount / job.plan.stages.length))
    : undefined;
  /** Rewound opacity applied to each face without flattening the perspective context. */
  const dimmed: CSSProperties = rolledBack ? { opacity: 0.55 } : {};
  /** Back-face heading reflects whether the steps built or removed the recorded work. */
  const storyKey = rolledBack ? 'agent3.ticket_what_taken_back' : 'agent3.ticket_how_built';

  // Flipping does not require remeasurement because the container already fits the taller face.
  useFaceHeight(
    innerRef,
    compact ? COMPACT_FLOOR : CARD_FLOOR,
    `${job.orderSeq}:${job.checkpoints.length}:${job.summary ?? ''}:${String(rolledBack)}:${String(postcard !== undefined)}`,
  );

  /** Flips the card and returns its top to the start of the scrollable reading area. */
  const flip = (): void => {
    setFlipped((f) => !f);
    const el = innerRef.current;
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  /** Shared face toggle with direction-specific copy and `aria-pressed` state. */
  const flipButton = (side: 'front' | 'back', small: boolean) => (
    <button
      type="button"
      data-testid={side === 'front' ? 'flip-button' : 'flip-button-back'}
      aria-pressed={flipped}
      onClick={flip}
      style={{
        ...windowPill('quiet', false, 'inset'),
        ...(small ? { padding: '5px 10px', ...roleFont('small') } : {}),
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        boxShadow: 'none',
      }}
    >
      <Icon id="pw-rotate" size={13} />
      {t(side === 'back' ? 'agent3.ticket_back' : storyKey)}
    </button>
  );

  const fileAway = onFileAway && (
    <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
      {t('agent3.action_file_away')}
    </Pill>
  );

  /** Header seat contains one of the story toggle, score or compact provenance stamp. */
  const headSeat = capped && hasBack
    ? <span style={{ marginLeft: 'auto' }}>{flipButton('front', true)}</span>
    : !capped && !rolledBack && score !== undefined
      ? (
        <span
          title={t('agent3.ticket_score')}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            background: PLATE,
            borderRadius: 999,
            padding: '5px 11px',
            color: INK,
            ...roleFont('small'),
            fontFamily: font.family,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Icon id="pw-evaluate" size={13} />
          <span data-testid="ticket-score">{score}</span>
        </span>
      )
      : compact && archiveStamp !== undefined
        ? <span data-testid="ticket-head-stamp" style={HEAD_STAMP}>{archiveStamp}</span>
        : null;

  return (
    <div
      data-testid="flip-ticket"
      data-face={flipped ? 'back' : 'front'}
      data-shape={capped ? 'capped' : compact ? 'compact' : 'full'}
      /* Keep grouping properties off the perspective element so backface visibility works. A bottom
         origin directs projected overflow upward, outside the scroller's reachable overflow area. */
      style={{ perspective: 1100, perspectiveOrigin: '50% 100%', flex: '0 0 auto' }}
    >
      <div
        ref={innerRef}
        data-testid="flip-inner"
        data-reduced={reduced}
        style={{
          position: 'relative',
          minHeight: compact ? COMPACT_FLOOR : CARD_FLOOR,
          transformStyle: 'preserve-3d',
          transform: flipped ? 'rotateY(180deg)' : undefined,
          transition: cssMotion('panel.ticket.flip', ['transform'], reduced),
        }}
      >
        <div data-testid="flip-face-front" data-face-body aria-hidden={flipped} style={{ ...FACE, ...dimmed }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {job.outcome && <Stamp outcome={job.outcome} rewound={rolledBack} />}
            {headSeat}
          </div>

          <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

          {planFraction !== undefined && <TapeBar mode={{ fraction: planFraction }} />}

          {/* Capped plan ledger marks completed and unreached stages. */}
          {ledger.length > 0 && (
            <StepList
              testId="ticket-ledger"
              rows={ledger.map((stage, i) => {
                const done = i < (job.plan?.doneCount ?? 0);
                const figure = done ? stageFigure(job, i, t) : undefined;
                return {
                  name: stage.label,
                  ...(done
                    ? {
                      ...(figure !== undefined ? { stat: figure } : {}),
                      trailing: <span data-testid="ticket-ledger-tick" style={{ marginLeft: 'auto', flex: '0 0 auto', color: INK, display: 'inline-flex' }}><Icon id="pw-check" size={13} /></span>,
                    }
                    : { unreached: true, stat: t('agent3.ticket_stage_not_reached') }),
                };
              })}
            />
          )}

          {!leadsWithStages && !compact && !rolledBack && postcard !== undefined && (
            <div
              data-testid="ticket-postcard"
              style={{
                display: 'block',
                width: '100%',
                height: POSTCARD.height,
                borderRadius: 12,
                overflow: 'hidden',
                border: edge,
                flex: '0 0 auto',
              }}
            >
              {postcard}
            </div>
          )}

          {/* Optional compact thumbnail for callers without room for the full postcard. */}
          {thumb !== undefined && (
            <div
              data-testid="ticket-thumb"
              style={{ flex: '0 0 auto', width: 104, height: 78, borderRadius: 12, border: edge, overflow: 'hidden' }}
            >
              {thumb}
            </div>
          )}

          {!leadsWithStages && !compact && !rolledBack && stats.length > 0 && <StatRow job={job} />}

          {thoughtTotal !== null && (
            <div data-testid="ticket-thoughts" style={THOUGHT_TOTAL}>{thoughtTotal}</div>
          )}

          {/* Rewound records replace model-authored completion copy with current map state. */}
          {rolledBack ? (
            <div data-testid="ticket-summary" style={ON_MAP}>{t('agent3.ticket_rewound_sum')}</div>
          ) : job.summary ? (
            <ModelProse testId="ticket-summary" text={job.summary} style={compact ? ON_MAP : SUMMARY} />
          ) : null}

          {/* Footer actions vary by capped, full receipt and compact-settle state. */}
          {capped ? (
            <div data-testid="ticket-actions" style={FOOT}>
              {/* Disable continuation immediately so a second press cannot become steering. */}
              {onKeepGoing && (
                <AskPrimary
                  testId="ticket-keep-going"
                  disabled={sent}
                  onClick={() => { setSent(true); onKeepGoing(); }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7 }}>
                    <Icon id="pw-resume" size={15} />
                    {t('agent3.ticket_keep_going')}
                  </span>
                </AskPrimary>
              )}
              {fileAway}
            </div>
          ) : (
            (hasBack || fileAway) && (
              <div style={FOOT}>
                {hasBack && flipButton('front', compact)}
                {!compact && fileAway}
              </div>
            )
          )}
        </div>

        {hasBack && (
        <div
          data-testid="flip-face-back"
          data-face-body
          aria-hidden={!flipped}
          style={{ ...FACE, ...dimmed, transform: 'rotateY(180deg)' }}
        >
          <div data-testid="ticket-back-head" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...roleFont('action'), fontFamily: font.family, color: INK }}>
              {t(storyKey)}
            </span>
            {/* Omit a zero-step count. */}
            {job.ops.length > 0 && (
              <span data-testid="ticket-back-stamp" style={HEAD_STAMP}>
                {t(job.ops.length === 1 ? 'agent3.steps_count_one' : 'agent3.steps_count', { n: job.ops.length })}
              </span>
            )}
          </div>

          {/* Preview all later rows discarded by a per-step rewind; confirmation expands in place. */}
          <StepList
            testId="ticket-step"
            rows={job.checkpoints.map((checkpoint, i) => {
              const asking = askingStep === i;
              const stepCopy = rewindConfirmCopy(
                t, rollbackCost(checkpoint.undoIndex, undoDepth, job.endUndoIndex),
              );
              const offers = canRewind && rollbackReaches(checkpoint.undoIndex, undoDepth);
              return {
                name: stepName(job, checkpoint, i, t),
                ...(askingStep !== null && i >= askingStep && !rolledBack ? { preview: true } : {}),
                ...(rolledBack ? { rewound: true, stat: t('agent3.ticket_step_rewound') } : {}),
                ...(offers
                  ? {
                    trailing: (
                      <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 5, alignItems: 'center' }}>
                        <InlineConfirm
                          question={stepCopy.question}
                          arm={CONFIRM_ARM}
                          open={asking}
                          onOpenChange={(open) => setAskingStep(open ? i : null)}
                          onConfirm={() => { setAskingStep(null); onRewind?.(checkpoint); }}
                          onCancel={() => setAskingStep(null)}
                        >
                          {/* The armed action expands to state the rewind cost. */}
                          {(armed) => (
                            <button
                              type="button"
                              data-testid="ticket-step-rewind"
                              title={t('agent3.ticket_rewind')}
                              aria-label={armed ? stepCopy.confirmLabel : t('agent3.ticket_rewind')}
                              style={armed
                                ? { ...STEP_ACTION, ...STEP_ASKING, marginLeft: 0 }
                                : { ...STEP_ACTION, marginLeft: 0 }}
                            >
                              <Icon id="pw-rewind" size={13} />
                              {armed ? <span>{stepCopy.confirmLabel}</span> : null}
                            </button>
                          )}
                        </InlineConfirm>
                      </span>
                    ),
                  }
                  : {}),
              };
            })}
          />

          {/* Whole-job rewind confirms at the far edge while the return action dims in place. */}
          <div style={FOOT}>
            <span style={askingAll ? HUSHED : undefined}>{flipButton('back', compact)}</span>
            <span style={SPACER} />
            {canRewind && onRewindAll && (
              <InlineConfirm
                question={wholeCopy.question}
                arm={CONFIRM_ARM}
                open={askingAll}
                onOpenChange={setAskingAll}
                onConfirm={onRewindAll}
                onCancel={() => setAskingAll(false)}
              >
                {(armed) => (
                  <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="ticket-rewind-all">
                    <Icon id="pw-undo-arrow" size={12} />
                    {armed ? wholeCopy.confirmLabel : t('agent3.ticket_rewind_all')}
                  </Pill>
                )}
              </InlineConfirm>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

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
  /** Elapsed job time using the dock's clock format. */
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
  const [asking, setAsking] = useState(false);
  const edits = editCount(job);
  const canRewind = Boolean(onRewindAll) && !rolledBack && job.checkpoints.length > 0;
  const copy = rewindConfirmCopy(t, job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null);

  return (
    <div data-testid="stop-card" style={{ ...TICKET, opacity: rolledBack ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Stamp outcome="aborted" rewound={rolledBack} />
        {clock !== undefined && <span data-testid="stop-clock" style={HEAD_STAMP}>{clock}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {/* State retained edits only while a non-zero count remains on the map. */}
      {!rolledBack && edits > 0 && (
        <div data-testid="stop-fact" style={HEADLINE}>
          {t(edits === 1 ? 'agent3.ticket_edits_kept_one' : 'agent3.ticket_edits_kept', { n: edits })}
        </div>
      )}

      {rolledBack && (
        <div data-testid="stop-fact" style={HEADLINE}>{t('agent3.ticket_rewound_sum')}</div>
      )}

      {unanswered && (
        <div data-testid="stop-lapsed" style={SUMMARY}>{t('agent3.ticket_question_lapsed')}</div>
      )}

      {canRewind && <div data-testid="stop-note" style={SUMMARY}>{t('agent3.ticket_ctrlz_note')}</div>}

      <div style={FOOT}>
        {canRewind && onRewindAll && (
          <InlineConfirm
            question={copy.question}
            arm={CONFIRM_ARM}
            open={asking}
            onOpenChange={setAsking}
            onConfirm={onRewindAll}
            onCancel={() => setAsking(false)}
          >
            {(armed) => (
              <Pill variant={armed ? 'danger' : 'quiet'} on="inset" data-testid="stop-rewind">
                <Icon id="pw-undo-arrow" size={13} />
                {armed ? copy.confirmLabel : t('agent3.ticket_rewind_all')}
              </Pill>
            )}
          </InlineConfirm>
        )}
        <span style={SPACER} />
        {onFileAway && (
          <span style={asking ? HUSHED : undefined}>
            <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
              {t('agent3.action_file_away')}
            </Pill>
          </span>
        )}
      </div>
    </div>
  );
}

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
  return (
    <div data-testid="archive-card" style={{ ...TICKET, opacity: rolledBack ? 0.55 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {job.outcome && <Stamp outcome={job.outcome} rewound={rolledBack} />}
        {stamp !== undefined && <span data-testid="archive-stamp" style={HEAD_STAMP}>{stamp}</span>}
      </div>

      <div data-testid="ticket-order" style={HEADLINE}>{job.orderText}</div>

      {job.summary && <ModelProse testId="ticket-summary" text={job.summary} style={ON_MAP} />}

      {job.checkpoints.length > 0 && (
        <StepList
          testId="archive-step"
          rows={job.checkpoints.map((checkpoint, i) => ({
            name: stepName(job, checkpoint, i, t),
            ...(rolledBack ? { rewound: true, stat: t('agent3.ticket_step_rewound') } : {}),
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
