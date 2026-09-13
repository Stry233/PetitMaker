import { displayAgentText } from '../../agent/tool-labels';
/*
 * Renders completed, active and pending plan stages as a connected rail. The active stage owns the
 * job's flat operation list and its reverted-operation rollup. Completed stages expose recorded
 * checkpoints when a rewind handler is available; checkpoint flags remain visible throughout the
 * run. The final active stage extends its spine beside nested operations.
 */
import type { CSSProperties } from 'react';
import { motion } from 'framer-motion';
import { amplitude, framerMotion } from './motion';
import { Icon } from './icons';
import { OpsList } from './OpRow';
import type { LaneView } from './Lane';
import type { Checkpoint } from './FlipTicket';
import { ACTIVE, INK, INSET, PLATE, PLATE_INK, TRACK } from '../design/tokens';
import { colors, cursors, font, UNAVAILABLE } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { Spinner } from '../primitives/Spinner';
import { useT } from '../../i18n/context';
import type { JobView, OpRow as OpRowData } from '../../agent/core/project-view';

type StagePlan = NonNullable<JobView['plan']>;

/** Muted reverted-operation count aligned with the active stage label. */
const ROLLUP_STYLE: CSSProperties = {
  flex: '0 0 auto',
  alignSelf: 'center',
  ...roleFont('small'),
  fontFamily: font.family,
  color: colors.brownText,
  background: INSET,
  borderRadius: 999,
  padding: '1px 8px',
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
    borderRadius: 6,
    marginTop: 1,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
  } as const;
  if (state === 'done') {
    return (
      <span data-testid="stage-box" data-state={state} style={{ ...base, background: INK, color: PLATE }}>
        {/* The mark LANDS rather than pulsing (`panel.plan.check`): the box held no check a moment
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
    // The armed yellow with the house tight-space loader turning in it: the stage being worked is
    // the one place on the rail where something is happening, and the tape band above already
    // carries the plan's own progress.
    return (
      <span data-testid="stage-box" data-state={state} style={{ ...base, background: ACTIVE }}>
        <Spinner size={11} color={INK} />
      </span>
    );
  }
  return <span data-testid="stage-box" data-state={state} style={{ ...base, background: INSET }} />;
}

/** How much of the active stage's work did not stick, as the rollup pill's text — or null where all
 *  of it did, which needs no pill of its own. */
function rollupOf(ops: readonly OpRowData[], t: (key: string, params?: Record<string, string | number>) => string): string | null {
  const reverted = ops.filter((op) => op.status === 'revert').length;
  return reverted > 0
    ? t(reverted === 1 ? 'agent3.rollup_put_back_one' : 'agent3.rollup_put_back', { n: reverted })
    : null;
}

export function PlanRail({
  plan,
  ops,
  checkpoints,
  lane,
  busy = false,
  onRewind,
}: {
  plan: StagePlan;
  ops: readonly OpRowData[];
  checkpoints?: JobView['checkpoints'];
  /** The live helper lane, for the delegate row nested under the active stage. */
  lane?: LaneView;
  /** A job is IN FLIGHT, so a stage take-back would pop a stack the loop is still writing to. The
   *  control stands where it is, disabled, saying why: the hold lifts the moment the job does. */
  busy?: boolean;
  onRewind?: (checkpoint: Checkpoint) => void;
}) {
  const t = useT();
  return (
    <div data-testid="plan-rail" style={{ display: 'flex', flexDirection: 'column' }}>
      {plan.stages.map((stage, i) => {
        const state = stateFor(i, plan.currentIndex);
        const checkpoint = checkpoints?.find((c) => c.stageIndex === i);
        const canRewind = state === 'done' && checkpoint !== undefined && Boolean(onRewind);
        // Model-authored, so it can arrive blank OR ABSENT: a nameless stage reads as a rail with a
        // hole in it, and a missing one would throw here and take the whole panel down with it. The
        // loop's own parser coerces the field, but a log restored from an older build need not have.
        const label = (stage.label ?? '').trim() === '' ? t('agent3.ticket_step_stage', { n: i + 1 }) : stage.label;
        const nests = state === 'now' && ops.length > 0;
        const rollup = state === 'now' ? rollupOf(ops, t) : null;
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
                  borderRadius: 1,
                }}
              />
            )}
            <StageBox state={state} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div
                  data-testid="plan-stage-label"
                  style={{
                    ...roleFont(state === 'now' ? 'menu' : 'label'),
                    fontFamily: font.family,
                    color: state === 'todo' ? colors.brownText : PLATE_INK,
                    opacity: state === 'todo' ? 0.6 : 1,
                    minWidth: 0,
                  }}
                >
                  {displayAgentText(label, t)}
                </div>
                {rollup !== null && (
                  <span data-testid="stage-rollup" style={ROLLUP_STYLE}>{rollup}</span>
                )}
                {/* The stage the approved plan said the assistant would stop at keeps saying so. */}
                {stage.checkpoint === true && (
                  <span
                    data-testid="stage-flag"
                    title={t('agent3.plan_checkpoint_here')}
                    style={{ flex: '0 0 auto', display: 'inline-flex', color: colors.brownText }}
                  >
                    <Icon id="pw-flag" size={12} />
                  </span>
                )}
              </div>
              {nests && (
                <div style={{ margin: '4px 0 2px' }}>
                  <OpsList ops={ops} {...(lane ? { lane } : {})} />
                </div>
              )}
            </div>
            {canRewind && (
              <button
                type="button"
                data-testid="plan-rewind"
                aria-label={busy ? `${t('agent3.ticket_rewind')} (${t('agent3.rollback_busy')})` : t('agent3.ticket_rewind')}
                title={busy ? t('agent3.rollback_busy') : t('agent3.ticket_rewind')}
                disabled={busy}
                {...(busy ? { 'aria-disabled': true } : {})}
                onClick={() => checkpoint && onRewind?.(checkpoint)}
                style={{
                  ...(busy ? { opacity: UNAVAILABLE } : {}),
                  flex: '0 0 auto',
                  width: 24,
                  height: 24,
                  borderRadius: 8,
                  border: 'none',
                  background: 'transparent',
                  color: colors.brownText,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  cursor: busy ? cursors.blocked : cursors.clickable,
                  boxShadow: 'none',
                }}
              >
                <Icon id="pw-rewind" size={14} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
