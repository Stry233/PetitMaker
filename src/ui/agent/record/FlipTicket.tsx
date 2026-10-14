/* The receipt of a finished or capped build: the built thing on its front, the steps that built it on its back. */
import { Pill } from '../../primitives/Pill';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotionConfig } from 'framer-motion';
import { TapeBar } from '../parts/panel-parts';
import { AskPrimary } from './GateBlock';
import { Icon } from '../parts/sprite';
import { ModelProse } from '../parts/model-prose';
import { OpsList } from './OpRow';
import { buildHistory } from '../derive/build-history';
import { useHeightTransition } from '../../primitives/use-height-transition';
import { useViewportEpoch } from '../../primitives/use-viewport-epoch';
import { edge, POSTCARD } from '../panel-skin';
import { font, radii } from '../../design/styles';
import { cssMotion } from '../../design/motion';
import { rewindConfirmCopy, rollbackCost, rollbackReaches } from '../derive/rollback';
import { ConfirmPill } from '../parts/ConfirmPill';
import { RewindSquare } from '../parts/RewindSquare';
import { INK } from '../../design/tokens';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { JobView } from '../../../agent/panel';
import type { Translate } from '../../../i18n/keys';
import {
  CARD_FLOOR, COMPACT_FLOOR, FACE, FOOT, HEAD_STAMP, HEADLINE, ON_MAP, OutcomeStamp, SPACER, StatRow, StepList,
  stageFigure, statsOf, stepName, SUMMARY, THOUGHT_TOTAL, thoughtLine, type Checkpoint, type StepRow,
} from './ticket-parts';

/* ── the flip family: done, done at the cap, the compact settle ── */

export function FlipTicket({
  job,
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
  /** Prevents a second continuation press before the first job event arrives. */
  const [sent, setSent] = useState(false);
  /** Checkpoint index awaiting confirmation, used to preview every discarded later row. */
  const [askingStep, setAskingStep] = useState<number | null>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const frontFlipRef = useRef<HTMLButtonElement>(null);
  const backFlipRef = useRef<HTMLButtonElement>(null);
  const transferFocus = useRef(false);
  const capped = job.outcome === 'capped';
  const stats = statsOf(job);
  const history = buildHistory(job);
  const thoughtTotal = thoughtLine(job, t);
  const canRewind = Boolean(onRewind) && !rolledBack;
  /** Whole-job rewind cost for confirmation copy. */
  const wholeCopy = rewindConfirmCopy(t, job.checkpoints[0]
    ? rollbackCost(job.checkpoints[0].undoIndex, undoDepth, job.endUndoIndex)
    : null);
  /** Read-only jobs with no checkpoint retain a single face. */
  const hasBack = job.checkpoints.length > 0 || job.ops.some(op => !op.isRead);
  /** Capped ledger reports plan stages rather than low-level checkpoints. */
  const ledger = capped ? job.plan?.stages ?? [] : [];
  /** A plan ledger leads capped cards; otherwise completed work remains primary. */
  const leadsWithStages = ledger.length > 0;
  /** Completed plan fraction for capped jobs only. */
  const planFraction = capped && job.plan && job.plan.stages.length > 0
    ? Math.max(0, Math.min(1, job.plan.doneCount / job.plan.stages.length))
    : undefined;
  /** Back-face heading reflects whether the steps built or removed the recorded work. */
  const storyKey = rolledBack ? 'agent.ticket_what_taken_back' : 'agent.ticket_how_built';

  const viewport = useViewportEpoch();
  useHeightTransition(innerRef, { motionId: 'panel.height', resetKey: viewport });

  useLayoutEffect(() => {
    if (!transferFocus.current) return;
    transferFocus.current = false;
    (flipped ? backFlipRef : frontFlipRef).current?.focus({ preventScroll: true });
  }, [flipped]);

  /** Flips the card and returns its top to the start of the scrollable reading area. */
  const flip = (): void => {
    const focused = innerRef.current?.ownerDocument.activeElement;
    transferFocus.current = false;
    // Release focus before aria-hidden changes; the destination becomes focusable after commit.
    if (focused instanceof HTMLElement && innerRef.current?.contains(focused)) {
      focused.blur();
      transferFocus.current = true;
    }
    setAskingStep(null);
    setFlipped((f) => !f);
    const el = innerRef.current;
    if (typeof el?.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' });
  };

  /** Shared face toggle with direction-specific copy and `aria-pressed` state. */
  const flipButton = (side: 'front' | 'back') => (
    <Pill
      ref={side === 'front' ? frontFlipRef : backFlipRef}
      variant="quiet"
      on="inset"
      data-testid={side === 'front' ? 'flip-button' : 'flip-button-back'}
      aria-pressed={flipped}
      onClick={flip}
    >
      <Icon id="pw-rotate" size={13} />
      {t(side === 'back' ? 'agent.ticket_back' : storyKey)}
    </Pill>
  );

  const fileAway = onFileAway && (
    <Pill variant="quiet" on="inset" data-testid="ticket-file-away" onClick={() => onFileAway(job.orderSeq)}>
      {t('agent.action_file_away')}
    </Pill>
  );

  /** Header seat holds the story toggle on a capped card, or the compact settle's provenance stamp. */
  const headSeat = capped && hasBack
    ? <span style={{ marginLeft: 'auto' }}>{flipButton('front')}</span>
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
        <div data-testid="flip-face-front" data-face-body aria-hidden={flipped} {...(flipped ? { inert: '' } : {})} style={{ ...FACE, ...(!flipped ? { position: 'relative', minHeight: 'inherit' } : {}) }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {job.outcome && <OutcomeStamp outcome={job.outcome} rewound={rolledBack} />}
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
                    : { unreached: true, stat: t('agent.ticket_stage_not_reached') }),
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
                borderRadius: radii.md,
                overflow: 'hidden',
                border: edge,
                flex: '0 0 auto',
              }}
            >
              {postcard}
            </div>
          )}


          {!leadsWithStages && !compact && !rolledBack && stats.length > 0 && <StatRow job={job} />}

          {thoughtTotal !== null && (
            <div data-testid="ticket-thoughts" style={THOUGHT_TOTAL}>{thoughtTotal}</div>
          )}

          {/* Rewound records replace model-authored completion copy with current map state. */}
          {rolledBack ? (
            <div data-testid="ticket-summary" style={ON_MAP}>{t('agent.ticket_rewound_sum')}</div>
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
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Icon id="pw-resume" size={15} />
                    {t('agent.ticket_keep_going')}
                  </span>
                </AskPrimary>
              )}
              {fileAway}
            </div>
          ) : (
            (hasBack || fileAway) && (
              <div style={FOOT}>
                {hasBack && flipButton('front')}
                {fileAway}
              </div>
            )
          )}
        </div>

        {hasBack && (
        <div
          data-testid="flip-face-back"
          data-face-body
          aria-hidden={!flipped}
          {...(!flipped ? { inert: '' } : {})}
          style={{ ...FACE, transform: 'rotateY(180deg)', ...(flipped ? { position: 'relative', minHeight: 'inherit' } : {}) }}
        >
          <div data-testid="ticket-back-head" style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ ...roleFont('action'), fontFamily: font.family, color: INK }}>
              {t(storyKey)}
            </span>
            {/* Omit a zero-step count. */}
            {history.count > 0 && (
              <span data-testid="ticket-back-stamp" style={HEAD_STAMP}>
                {t('units.steps', { n: history.count })}
              </span>
            )}
          </div>

          {history.before.length > 0 && <OpsList ops={history.before} />}

          {/* Preview all later rows discarded by a per-step rewind; confirmation expands in place. */}
          <StepList
            key={`steps-${String(flipped)}`}
            testId="ticket-step"
            rows={stepRows({
              job, t, history, canRewind, rolledBack, askingStep, ...(undoDepth !== undefined ? { undoDepth } : {}), onAsk: setAskingStep,
              ...(onRewind ? { onRewind } : {})
            })}
          />

          <div style={FOOT}>
            {flipButton('back')}
            <span style={SPACER} />
            {canRewind && onRewindAll && (
              <ConfirmPill
                key={`rewind-all-${String(flipped)}`}
                testId="ticket-rewind-all"
                title={wholeCopy.confirmLabel}
                {...(wholeCopy.question !== wholeCopy.confirmLabel ? { message: wholeCopy.question } : {})}
                actLabel={t('agent.ticket_rewind_all')}
                help="agent-undo"
                onConfirm={onRewindAll}
              >
                <Icon id="pw-undo-arrow" size={12} />
                {t('agent.ticket_rewind_all')}
              </ConfirmPill>
            )}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}

/** The back face's steps: each checkpoint, its ops, and a take-back where one would pop something. */
function stepRows({ job, t, history, canRewind, rolledBack, askingStep, undoDepth, onAsk, onRewind }: {
  job: JobView;
  t: Translate;
  history: ReturnType<typeof buildHistory>;
  canRewind: boolean;
  rolledBack: boolean;
  /** The step whose take-back is asking; it and every later step preview as discarded. */
  askingStep: number | null;
  undoDepth?: number;
  onAsk(step: number | null): void;
  onRewind?(checkpoint: Checkpoint): void;
}): StepRow[] {
  return job.checkpoints.map((checkpoint, i) => {
    const offers = canRewind && rollbackReaches(checkpoint.undoIndex, undoDepth);
    return {
      name: stepName(job, checkpoint, i, t),
      ...(history.steps[i]?.length ? { details: <OpsList ops={history.steps[i]!} /> } : {}),
      ...(askingStep !== null && i >= askingStep && !rolledBack ? { preview: true } : {}),
      ...(rolledBack ? { rewound: true, stat: t('agent.ticket_step_rewound') } : {}),
      ...(offers ? {
        trailing: (
          <span style={{ marginLeft: 'auto', display: 'inline-flex' }}>
            <RewindSquare
              testId="ticket-step-rewind"
              label={t('agent.ticket_rewind')}
              actLabel={t('agent.ticket_rewind')}
              cost={rollbackCost(checkpoint.undoIndex, undoDepth, job.endUndoIndex)}
              onAskChange={(asking) => onAsk(asking ? i : null)}
              onConfirm={() => onRewind?.(checkpoint)}
            />
          </span>
        ),
      } : {}),
    };
  });
}
