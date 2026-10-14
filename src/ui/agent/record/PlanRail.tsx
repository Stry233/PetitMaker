/*
 * Renders plan stages with their recorded operations. Active stages start open; completed stages
 * can be reopened independently. Completed stages expose recorded
 * checkpoints when a rewind handler is available; checkpoint flags remain visible throughout the
 * run. The final active stage extends its spine beside nested operations.
 */
import { Disclosure } from '../../primitives/Disclosure';
import { ActionButton } from '../../primitives/ActionButton';
import { useReadingIntent } from '../parts/scroll-intent';
import { displayAgentText, type JobView, type OpRow as OpRowData } from '../../../agent/panel';
import { useState, type CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotionConfig } from 'framer-motion';
import { amplitude, cssMotion, framerMotion } from '../../design/motion';
import { Icon } from '../parts/sprite';
import { OpsList } from './OpRow';
import { rollbackCost } from '../derive/rollback';
import { RewindSquare } from '../parts/RewindSquare';
import type { LaneView } from './Lane';
import type { Checkpoint } from './ticket-parts';
import { ACTIVE, INK, INSET, MUTED, PLATE, PLATE_INK, TRACK } from '../../design/tokens';
import { cursors, font, radii } from '../../design/styles';
import { roleFont } from '../../design/text-weight';
import { useT } from '../../../i18n/context';
import type { Translate } from '../../../i18n/keys';
import { recede } from '../panel-skin';

type StagePlan = NonNullable<JobView['plan']>;

/** Muted reverted-operation count aligned with the active stage label. */
const ROLLUP_STYLE: CSSProperties = {
  flex: '0 0 auto',
  alignSelf: 'center',
  ...roleFont('small'),
  fontFamily: font.family,
  color: MUTED,
  background: INSET,
  borderRadius: radii.pill,
  padding: '2px 8px',
};
type StageState = 'done' | 'now' | 'todo';

function stateFor(index: number, activeIndex: number): StageState {
  if (index < activeIndex) return 'done';
  if (index === activeIndex) return 'now';
  return 'todo';
}

/** How far short of its size a landing check starts, per its declaration. */
const CHECK_GROWTH = amplitude('panel.plan.check') ?? 0;

function StageBox({ state }: { state: StageState }) {
  const base = {
    flex: '0 0 auto',
    width: 18,
    height: 18,
    borderRadius: radii.chip,
    marginTop: 2,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  if (state === 'done') {
    return (
      <span data-testid="stage-box" data-state={state} style={{ ...base, background: INK, color: PLATE }}>
        {/* The mark lands rather than pulsing (`panel.plan.check`): the box held no check a moment
            ago, so this is a new object arriving, not an existing one reacting. Keyed on the state
            so it plays once, when the stage crosses over, and not on every re-render of the rail. */}
        <motion.span
          key="done"
          style={{ display: 'inline-flex' }}
          initial={{ scale: 1 - CHECK_GROWTH, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={framerMotion('panel.plan.check')}
        >
          <Icon id="pw-check" size={12} />
        </motion.span>
      </span>
    );
  }
  if (state === 'now') {
    // The armed yellow marks the stage being worked; the tape above carries the progress.
    return <span data-testid="stage-box" data-state={state} style={{ ...base, background: ACTIVE }} />;
  }
  return <span data-testid="stage-box" data-state={state} style={{ ...base, background: INSET }} />;
}

/** How much of the active stage's work did not stick, as the rollup pill's text — or null where all
 *  of it did, which needs no pill of its own. */
function rollupOf(ops: readonly OpRowData[], t: Translate): string | null {
  const reverted = ops.filter((op) => op.status === 'revert').length;
  return reverted > 0
    ? t('agent.rollup_put_back', { n: reverted })
    : null;
}

export function PlanRail({
  plan,
  ops,
  checkpoints,
  lane,
  busy = false,
  undoDepth,
  onRewind,
}: {
  plan: StagePlan;
  ops: readonly OpRowData[];
  checkpoints?: JobView['checkpoints'];
  /** The live helper lane, for the delegate row nested under the active stage. */
  lane?: LaneView;
  /** A job is in flight, so a stage take-back would pop a stack the loop is still writing to. The
   *  control stands where it is, disabled, saying why: the hold lifts the moment the job does. */
  busy?: boolean;
  /** The live undo depth, so a stage's take-back can name what it would pop. */
  undoDepth?: number;
  onRewind?: (checkpoint: Checkpoint) => void;
}) {
  const t = useT();
  const reduced = useReducedMotionConfig() === true;
  const preserveReading = useReadingIntent();
  const [expanded, setExpanded] = useState<ReadonlyMap<number, boolean>>(new Map());
  const fallbackStage = Math.min(plan.currentIndex, plan.stages.length - 1);
  return (
    <div data-testid="plan-rail" style={{ display: 'flex', flexDirection: 'column' }}>
      {plan.stages.map((stage, i) => {
        const state = stateFor(i, plan.currentIndex);
        const checkpoint = checkpoints?.find((c) => c.stageIndex === i);
        const canRewind = state === 'done' && checkpoint !== undefined && Boolean(onRewind);
        // Model-authored, so it can arrive blank or absent: a nameless stage reads as a rail with a
        // hole in it, and a missing one would throw here and take the whole panel down with it. The
        // loop's own parser coerces the field, but a log restored from an older build need not have.
        const label = (stage.label ?? '').trim() === '' ? t('agent.ticket_step_stage', { n: i + 1 }) : stage.label;
        // Older records have no stage index; keep their work accessible on the current or final stage.
        const stageOps = ops.filter(op => (op.stageIndex ?? fallbackStage) === i);
        const open = expanded.get(i) ?? state === 'now';
        const nests = open && stageOps.length > 0;
        const rollup = rollupOf(stageOps, t);
        return (
          <div
            key={i}
            data-testid="plan-stage"
            data-state={state}
            style={{ display: 'flex', gap: 10, padding: '4px 0', alignItems: 'flex-start', position: 'relative' }}
          >
            {(i < plan.stages.length - 1 || nests) && (
              <span
                data-testid="stage-connector"
                style={{
                  position: 'absolute',
                  left: 8,
                  top: 24,
                  bottom: -6,
                  width: 2,
                  background: TRACK,
                  borderRadius: radii.hair,
                }}
              />
            )}
            <StageBox state={state} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <ActionButton
                  data-testid="plan-stage-label"
                  aria-expanded={stageOps.length > 0 ? open : undefined}
                  disabled={stageOps.length === 0}
                  onClick={() => { preserveReading(); setExpanded(values => new Map(values).set(i, !open)); }}
                  style={{
                    ...roleFont(state === 'now' ? 'menu' : 'label'),
                    fontFamily: font.family,
                    color: state === 'todo' ? MUTED : PLATE_INK,
                    opacity: state === 'todo' ? recede.apart : 1,
                    minWidth: 0,
                    display: 'flex', alignItems: 'center', gap: 6,
                    border: 'none', background: 'none', padding: 0, textAlign: 'left',
                    // A stage with nothing to open is a label: it keeps its ink and the plain cursor.
                    ...(stageOps.length === 0 ? { cursor: cursors.default } : {}),
                    transition: cssMotion('panel.detail.unfold', ['color', 'opacity'], reduced),
                  }}
                >
                  {displayAgentText(label, t)}
                  {stageOps.length > 0 && <span style={{ display: 'inline-flex', flex: '0 0 auto', transform: open ? 'rotate(180deg)' : undefined, transition: cssMotion('panel.detail.unfold', ['transform'], reduced) }}><Icon id="pw-chevron" size={12} /></span>}
                </ActionButton>
                {rollup !== null && (
                  <span data-testid="stage-rollup" style={ROLLUP_STYLE}>{rollup}</span>
                )}
                {/* The stage the approved plan said the assistant would stop at keeps saying so. */}
                {stage.checkpoint === true && (
                  <span
                    data-testid="stage-flag"
                    title={t('agent.plan_checkpoint_here')}
                    style={{ flex: '0 0 auto', display: 'inline-flex', color: MUTED }}
                  >
                    <Icon id="pw-flag" size={12} />
                  </span>
                )}
              </div>
              <AnimatePresence initial={false}>
                {nests && (
                  <Disclosure key="operations" testId="stage-operations">
                    <div style={{ padding: '4px 0 2px' }}>
                      <OpsList ops={stageOps} {...(lane && state === 'now' ? { lane } : {})} />
                    </div>
                  </Disclosure>
                )}
              </AnimatePresence>
            </div>
            {canRewind && (
              <RewindSquare
                testId="plan-rewind"
                label={t('agent.ticket_rewind')}
                actLabel={t('agent.ticket_rewind')}
                cost={rollbackCost(checkpoint.undoIndex, undoDepth)}
                busy={busy}
                onConfirm={() => onRewind?.(checkpoint)}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
