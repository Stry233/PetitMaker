/*
 * PlanGate.tsx — the plan as the thing being approved (normative prototype `.plangate`).
 *
 * A PLAN ASK IS AN ASK CARD LIKE ANY OTHER, on the panel's plate under the same retiring spine
 * (`GateBlock.tsx:AskCard`), with no plan tint of its own: a proposed plan reads as a question the
 * record is holding rather than as a surface of its own.
 *
 * IT LISTS THE STAGES IT IS ASKING ABOUT, which the gate's own sentence cannot: the describer folds
 * a plan down to "4 stages: a, b, c +1" for the dock, and a checkpoint flag survives neither the
 * count nor the ellipsis. The list comes off `AskRecord.stages`, which the projection reads from the
 * `update_plan` call the gate is holding — the `plan` event lands only once the ask is approved, so
 * at ask time the call's arguments are the only place the plan exists.
 *
 * The two notes are the panel's own voice, not the model's: they explain what approving DOES (a plan
 * is filed, and the flagged steps will come back to the user), which is the one thing the stage list
 * cannot say for itself.
 */
import { AskActions, AskCard, HeldNote, VerdictChip, markFor } from './GateBlock';
import { Icon } from './icons';
import { inkTint } from './tokens';
import { INK, PLATE_INK } from '../design/tokens';
import { colors, font } from '../design/styles';
import { roleFont } from '../design/text-weight';
import { useT } from '../../i18n/context';
import type { AskRecord } from '../../agent/core/project-view';
import type { PlanStage } from '../../agent/core/types';

/** The bead's box, in px: a stage number reads as a place in a sequence rather than as a bullet. */
const BEAD = 18;

function Bead({ n }: { n: number }) {
  return (
    <span
      data-testid="plan-bead"
      style={{
        width: BEAD,
        height: BEAD,
        borderRadius: '50%',
        background: inkTint.chip,
        color: INK,
        ...roleFont('small'),
        fontFamily: font.family,
        fontWeight: 800,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: '0 0 auto',
      }}
    >
      {n}
    </span>
  );
}

function Note({ children }: { children: string }) {
  return (
    <p
      data-testid="plan-note"
      style={{
        ...roleFont('note'),
        fontFamily: font.family,
        color: colors.brownText,
        lineHeight: 1.4,
        padding: '0 2px',
      }}
    >
      {children}
    </p>
  );
}

export function PlanGate({
  ask,
  stages,
  demoted = false,
  answerable = true,
  onAnswer,
}: {
  ask: AskRecord | undefined;
  /** Overrides `ask.stages`, for a caller that holds the plan elsewhere (the harness, a test). */
  stages?: readonly PlanStage[];
  demoted?: boolean;
  /** See `GateBlock`: a held session keeps its question and offers no button behind it. */
  answerable?: boolean;
  onAnswer(answer: 'allow' | 'skip'): void;
}) {
  const t = useT();
  if (!ask) return null;
  const list = stages ?? ask.stages ?? [];
  const flags = list.filter((s) => s.checkpoint).length;
  const mark = markFor(ask);
  const settled = mark !== undefined;

  const stat = [
    t(list.length === 1 ? 'agent3.plan_gate_stages_one' : 'agent3.plan_gate_stages', { n: list.length }),
    flags === 0
      ? ''
      : t(flags === 1 ? 'agent3.plan_gate_flags_one' : 'agent3.plan_gate_flags', { n: flags }),
  ].filter((part) => part !== '').join(', ');

  return (
    <AskCard settled={settled} testId="plan-gate">
      <div
        data-testid="plan-head"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 7,
          ...roleFont('label'),
          fontFamily: font.family,
          fontWeight: 800,
          color: INK,
        }}
      >
        <span style={{ display: 'inline-flex', flex: '0 0 auto' }}><Icon id="pw-plan" size={15} /></span>
        {t('agent3.plan_gate_title')}
        <span
          data-testid="plan-stat"
          style={{
            // The gap is the STAT's own padding rather than the head's `gap`: `marginLeft: auto`
            // pushes it to the edge, and at a long translation (ru measures nearly the whole line at
            // shell zoom 1.25) it would otherwise sit against the title with nothing between them.
            marginLeft: 'auto',
            paddingLeft: 8,
            ...roleFont('small'),
            color: colors.brownText,
            fontVariantNumeric: 'tabular-nums',
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {stat}
        </span>
      </div>

      <Note>{t('agent3.plan_gate_note')}</Note>

      {list.map((stage, i) => (
        <div
          key={`${i}-${stage.label}`}
          data-testid="plan-stage"
          data-checkpoint={stage.checkpoint === true ? 'true' : 'false'}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            ...roleFont('label'),
            fontFamily: font.family,
            fontWeight: 700,
            color: PLATE_INK,
          }}
        >
          <Bead n={i + 1} />
          <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {stage.label}
          </span>
          {stage.checkpoint === true && (
            <span
              data-testid="plan-flag"
              style={{ marginLeft: 'auto', flex: '0 0 auto', color: INK, display: 'inline-flex' }}
            >
              <Icon id="pw-flag" size={13} />
            </span>
          )}
        </div>
      ))}

      {flags > 0 && <Note>{t('agent3.plan_gate_flagnote')}</Note>}

      {!settled && answerable && (
        <AskActions
          demoted={demoted}
          approveKey="agent3.gate_approve"
          skipKey="agent3.plan_gate_skip"
          onApprove={() => onAnswer('allow')}
          onSkip={() => onAnswer('skip')}
        />
      )}
      {!settled && !answerable && <HeldNote />}
      {mark && <VerdictChip verdict={mark} {...(ask.words !== undefined ? { word: ask.words } : {})} />}
    </AskCard>
  );
}
